/**
 * Reading explanations and lessons out of a review (§20 "helping explain outcomes", §9 "capture once"; ADR-0030).
 *
 * When a commitment has ended, the people who were there usually said what explains it and what to do differently —
 * in a review meeting, in its notes. Forge reads those notes and proposes, for the person recording the learning,
 * which sentences explain the outcome and which state a lesson, quoting them verbatim. Nothing is recorded by reading:
 * the proposals live only in the dialog, labelled INFERENCE, and a learning exists only when a person records it —
 * attributed to them, and remembering the notes and line it was drawn from.
 *
 * The model proposes; Forge governs; a person decides — the same discipline as reading commitments (ADR-0012):
 *
 *   - Grounding: a quote that is not in the notes is removed, and the result says so.
 *   - Only EXPLANATION and LESSON become proposals; anything else is listed as not taken, with why.
 *   - "Where it applies next time" is kept only when its words are in the notes; otherwise the person says it.
 */

import { fail, ok, type Result } from '@forge/kernel';

export const learningClasses = ['EXPLANATION', 'LESSON', 'OTHER'] as const;
export type LearningClass = (typeof learningClasses)[number];

export type LearningExtractionInput = {
  readonly source: { readonly kind: 'MEETING_NOTES' | 'TRANSCRIPT'; readonly system: string; readonly ref: string; readonly label: string; readonly heldOn: string };
  readonly text: string;
  /** What ended, so the reader knows what the review is about. Nothing Forge concluded about why. */
  readonly commitment: { readonly statement: string; readonly ended: string | null };
};

export type RawLearningFinding = {
  readonly quote: string;
  readonly class: LearningClass;
  readonly speaker: string | null;
  /** The explanation or lesson as one sentence — the quote, tidied, never a new claim. */
  readonly statement: string | null;
  readonly appliesTo: string | null;
  readonly confidence: number;
  readonly rationale: string;
};

export interface LearningExtractionModel {
  readonly name: string;
  readonly model: string | null;
  extract(input: LearningExtractionInput): Promise<Result<{ readonly findings: readonly RawLearningFinding[] }>>;
}

/** Where a recorded learning was drawn from — kept on it, so a reader can go back to the words. */
export type DrawnFrom = { readonly ref: string; readonly label: string; readonly quote: string; readonly locator: string | null };

export type LearningProposal = {
  readonly kind: 'EXPLANATION' | 'LESSON';
  readonly statement: string;
  readonly appliesTo: string | null;
  readonly speaker: string | null;
  readonly confidence: number;
  readonly rationale: string;
  readonly epistemic: 'INFERENCE';
  readonly extractor: { readonly name: string; readonly model: string | null };
  readonly drawnFrom: DrawnFrom;
};

export type GovernedLearnings = {
  readonly extractor: { readonly name: string; readonly model: string | null };
  readonly proposals: readonly LearningProposal[];
  readonly notTaken: readonly { readonly quote: string; readonly why: string }[];
  readonly removed: readonly { readonly quote: string; readonly reason: string }[];
};

export const LEARNING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quote', 'class', 'speaker', 'statement', 'appliesTo', 'confidence', 'rationale'],
        properties: {
          quote: { type: 'string', description: 'The exact words from the notes, copied verbatim.' },
          class: { type: 'string', enum: [...learningClasses] },
          speaker: { type: ['string', 'null'] },
          statement: { type: ['string', 'null'], description: 'For EXPLANATION or LESSON: the quote as one clear sentence, adding nothing it does not say.' },
          appliesTo: { type: ['string', 'null'], description: 'For a LESSON: the kind of work it applies to next time, in words from the notes. Null if the notes do not say.' },
          confidence: { type: 'number', description: 'How sure you are of the class, 0 to 1.' },
          rationale: { type: 'string', description: 'One sentence: which words make it this class.' },
        },
      },
    },
  },
} as const;

export function learningInstructions(input: LearningExtractionInput): string {
  return [
    'You read the notes of a review held after a piece of committed work ended, and find what people said explains the outcome and what they said should be done differently.',
    `The work: "${input.commitment.statement}"${input.commitment.ended ? `, which ended ${input.commitment.ended}` : ''}.`,
    'Classes:',
    '- EXPLANATION: a sentence saying why the outcome differed from what was promised — a cause the people in the room stated.',
    '- LESSON: a sentence saying what to do differently next time, or what the enterprise should keep doing.',
    '- OTHER: anything else — status, small talk, blame, speculation nobody stood behind, new promises.',
    'Report only what the notes say. Never infer a cause the notes do not state; never turn a complaint about a person into a lesson.',
    'Quote every finding verbatim — copy the exact characters. Do not paraphrase in the quote.',
    'Leave out sentences that are clearly OTHER unless they look like an explanation or a lesson and are not.',
  ].join('\n');
}

const normalize = (s: string): string => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

function locate(text: string, quote: string): string | null {
  const q = normalize(quote);
  const i = text.split(/\r?\n/).findIndex((l) => normalize(l).includes(q));
  return i < 0 ? null : `line ${i + 1}`;
}

const stripSpeaker = (s: string): string => s.replace(/^\s*(?:[-*]\s*)?[A-Z][\w .'-]{0,40}?:\s+/, '').trim();

export function governLearnings(raw: { readonly findings: readonly RawLearningFinding[] }, input: LearningExtractionInput, extractor: { name: string; model: string | null }): GovernedLearnings {
  const proposals: LearningProposal[] = [];
  const notTaken: { quote: string; why: string }[] = [];
  const removed: { quote: string; reason: string }[] = [];
  const text = normalize(input.text);
  const seen = new Set<string>();
  for (const f of raw.findings) {
    const quote = f.quote?.trim() ?? '';
    if (!quote || !text.includes(normalize(quote))) {
      removed.push({ quote, reason: 'The quote does not appear in the notes.' });
      continue;
    }
    if (!(learningClasses as readonly string[]).includes(f.class)) {
      removed.push({ quote, reason: `“${String(f.class)}” is not a class Forge knows.` });
      continue;
    }
    const key = normalize(quote);
    if (seen.has(key)) continue;
    seen.add(key);
    if (f.class === 'OTHER') {
      notTaken.push({ quote, why: 'It neither explains the outcome nor says what to do differently.' });
      continue;
    }
    const statement = (f.statement?.trim() || stripSpeaker(quote)).replace(/\s+/g, ' ');
    // Where a lesson applies is kept only in words the notes use; otherwise the person says it.
    const appliesTo = f.class === 'LESSON' && f.appliesTo && text.includes(normalize(f.appliesTo)) ? f.appliesTo.trim() : null;
    proposals.push({
      kind: f.class,
      statement,
      appliesTo,
      speaker: f.speaker,
      confidence: Math.min(1, Math.max(0, Number.isFinite(f.confidence) ? f.confidence : 0)),
      rationale: f.rationale,
      epistemic: 'INFERENCE',
      extractor,
      drawnFrom: { ref: input.source.ref, label: input.source.label, quote, locator: locate(input.text, quote) },
    });
  }
  return { extractor, proposals, notTaken, removed };
}

export async function extractLearnings(model: LearningExtractionModel, input: LearningExtractionInput): Promise<Result<GovernedLearnings>> {
  if (!input.text.trim()) return fail('extraction.empty', 'There is nothing to read.');
  const raw = await model.extract(input);
  if (!raw.ok) return raw;
  return ok(governLearnings(raw.value, input, { name: model.name, model: model.model }));
}

/**
 * Deterministic, offline, and honest about it: cue phrases, not understanding — so the demo and the tests run without
 * a model, and the governance above is exercised identically.
 */
export const referenceLearningExtractor: LearningExtractionModel = {
  name: 'forge-reference-learning-extractor@1',
  model: null,
  async extract(input) {
    const findings: RawLearningFinding[] = [];
    for (const line of input.text.split(/\r?\n/)) {
      const m = /^\s*(?:[-*]\s*)?([A-Z][\w .'-]{0,40}?):\s+(.+)$/.exec(line);
      const speaker = m ? m[1].trim() : null;
      const said = (m ? m[2] : line).trim();
      if (said.length < 16) continue;
      const lower = said.toLowerCase();
      let cls: LearningClass | null = null;
      if (/\b(next time|in future|going forward|from now on|lesson|we should always|we should never|always plan|should have)\b/.test(lower)) cls = 'LESSON';
      else if (/\b(because|caused by|the reason|root cause|due to|that is why|which is why|we didn't|we did not|nobody)\b/.test(lower)) cls = 'EXPLANATION';
      if (cls === null) continue;
      const scope = /\b(?:for|in|on)\s+((?:every|any|all)\s+[a-z][a-z -]{3,60}?)(?:[.,;]|$)/.exec(said)?.[1] ?? null;
      findings.push({ quote: said, class: cls, speaker, statement: null, appliesTo: cls === 'LESSON' ? scope : null, confidence: 0.6, rationale: `Cue phrase for ${cls.toLowerCase()} (forge-reference-learning-extractor@1).` });
    }
    return ok({ findings });
  },
};
