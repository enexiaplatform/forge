/**
 * Reading commitments out of conversation (decision 4 of 2026-10-01).
 *
 * The first job Forge gives a language model: read meeting notes or a
 * transcript and say, for each sentence that might matter, whether it is
 * DISCUSSION, a REQUEST, an INTENTION, a DECISION or a COMMITMENT — quoting it
 * verbatim, with who would own it, by when, and how sure it is.
 *
 * The model proposes; Forge governs; a person disposes.
 *
 *   - Grounding: a finding whose quote is not in the text is removed, and the
 *     result says so. A date must come from words in the quote.
 *   - Only a COMMITMENT or a DECISION with someone behind it becomes a
 *     candidate. Discussion, requests and intentions are reported as NOT
 *     converted, so a reader sees what was left as talk and why.
 *   - Owners are matched to parties the enterprise already knows, or left for
 *     the person to name. Entities likewise.
 *   - Every candidate is an INFERENCE, with the extractor and model named. It
 *     becomes a commitment only when a person confirms it (kernel/candidates.ts).
 *
 * `ExtractionModel` is the port. `referenceExtractor` is deterministic and
 * offline (cue phrases, for the demo and tests). The Claude adapter lives at the
 * server edge (server/extraction/claude.ts) and uses the schema and instructions
 * defined here, so both are governed identically.
 */

import { fail, ok, type Party, type Result, type SuggestCandidateInput, type UtteranceClass, utteranceClasses } from '@forge/kernel';

export type ExtractionInput = {
  readonly source: { readonly kind: 'MEETING_NOTES' | 'TRANSCRIPT'; readonly system: string; readonly ref: string; readonly label: string; readonly heldOn: string };
  readonly text: string;
  /** People and roles Forge knows, with the names they go by in conversation. */
  readonly parties: readonly { readonly names: readonly string[]; readonly party: Party }[];
  readonly entities: readonly { readonly names: readonly string[]; readonly entityRef: string }[];
};

/** What a model returns: one entry per sentence that might matter. */
export type RawFinding = {
  readonly quote: string;
  readonly class: UtteranceClass;
  readonly speaker: string | null;
  readonly statement: string | null;
  readonly proposedOutcome: string | null;
  readonly owner: string | null;
  readonly dueText: string | null;
  readonly dueDate: string | null;
  readonly dependencies: readonly string[];
  readonly entities: readonly string[];
  readonly confidence: number;
  readonly rationale: string;
};

export type RawExtraction = { readonly findings: readonly RawFinding[] };

export interface ExtractionModel {
  readonly name: string;
  readonly model: string | null;
  extract(input: ExtractionInput): Promise<Result<RawExtraction>>;
}

export type Finding = {
  readonly class: UtteranceClass;
  readonly quote: string;
  readonly locator: string | null;
  readonly speaker: string | null;
  readonly rationale: string;
  /** Why it did NOT become a candidate, when it did not. */
  readonly notConverted: string | null;
  readonly candidate: SuggestCandidateInput | null;
};

export type GovernedExtraction = {
  readonly extractor: { readonly name: string; readonly model: string | null };
  readonly findings: readonly Finding[];
  readonly candidates: readonly SuggestCandidateInput[];
  /** What the model said that the text does not support — removed, and listed. */
  readonly removed: readonly { readonly quote: string; readonly reason: string }[];
};

/** JSON schema for the model's output (structured outputs). Every property required; nulls explicit. */
export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quote', 'class', 'speaker', 'statement', 'proposedOutcome', 'owner', 'dueText', 'dueDate', 'dependencies', 'entities', 'confidence', 'rationale'],
        properties: {
          quote: { type: 'string', description: 'The exact words from the notes, copied verbatim.' },
          class: { type: 'string', enum: [...utteranceClasses] },
          speaker: { type: ['string', 'null'] },
          statement: { type: ['string', 'null'], description: 'For a COMMITMENT or DECISION: what would be promised, as one sentence in the imperative.' },
          proposedOutcome: { type: ['string', 'null'], description: 'What would be true in the world if it were kept. Null if the notes do not say.' },
          owner: { type: ['string', 'null'], description: 'Who would stand behind it, as named in the notes.' },
          dueText: { type: ['string', 'null'], description: 'The words in the quote that give a date, verbatim.' },
          dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD, only if the dueText makes it unambiguous given the meeting date.' },
          dependencies: { type: 'array', items: { type: 'string' } },
          entities: { type: 'array', items: { type: 'string' }, description: 'Customers, products, suppliers or orders named in the quote.' },
          confidence: { type: 'number', description: 'How sure you are of the class, 0 to 1.' },
          rationale: { type: 'string', description: 'One sentence: which words make it this class.' },
        },
      },
    },
  },
} as const;

/** The instructions any model is given. Kept here so every extractor is asked the same thing. */
export function extractionInstructions(input: ExtractionInput): string {
  return [
    'You read enterprise meeting notes and classify the sentences that might create accountability.',
    'Classes, from least to most binding:',
    '- DISCUSSION: ideas, opinions, options, analysis. Nobody is bound.',
    '- REQUEST: someone asks someone else to do something. Not yet accepted.',
    '- INTENTION: tentative or conditional language ("I\'ll try", "we might", "probably", "plan to look at"). Not a promise.',
    '- DECISION: the meeting settled something ("agreed", "decided", "we will go with"). It is a commitment only if the notes say who carries it out.',
    '- COMMITMENT: a person or team clearly undertakes to do something ("I will … by …", "we\'ll have it done by …").',
    'Be conservative: when in doubt between INTENTION and COMMITMENT, choose INTENTION. Never upgrade a request into a commitment because it sounds important.',
    'Quote every finding verbatim — copy the exact characters. Do not paraphrase in the quote.',
    `The meeting was held on ${input.source.heldOn}. Give dueDate only when the words make the date unambiguous; otherwise null, keeping dueText.`,
    'Leave out small talk and sentences that create no accountability at all.',
  ].join('\n');
}

const normalize = (s: string): string => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

function locate(text: string, quote: string): string | null {
  const lines = text.split(/\r?\n/);
  const q = normalize(quote);
  const i = lines.findIndex((l) => normalize(l).includes(q));
  return i < 0 ? null : `line ${i + 1}`;
}

const isIso = (s: string | null): s is string => s !== null && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

function matchParty(name: string | null, input: ExtractionInput): Party | null {
  if (!name) return null;
  const n = normalize(name);
  return input.parties.find((p) => p.names.some((x) => n.includes(normalize(x)) || normalize(x).includes(n)))?.party ?? null;
}

const shortHash = (s: string): string => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
};

export function governExtraction(raw: RawExtraction, input: ExtractionInput, extractor: { name: string; model: string | null }): GovernedExtraction {
  const findings: Finding[] = [];
  const removed: { quote: string; reason: string }[] = [];
  const candidates: SuggestCandidateInput[] = [];
  const seen = new Set<string>();
  const text = normalize(input.text);

  for (const f of raw.findings) {
    const quote = f.quote?.trim() ?? '';
    if (!quote || !text.includes(normalize(quote))) {
      removed.push({ quote, reason: 'The quote does not appear in the notes.' });
      continue;
    }
    if (!(utteranceClasses as readonly string[]).includes(f.class)) {
      removed.push({ quote, reason: `“${String(f.class)}” is not a class Forge knows.` });
      continue;
    }
    const key = normalize(quote);
    if (seen.has(key)) continue;
    seen.add(key);

    const locator = locate(input.text, quote);
    const base = { class: f.class, quote, locator, speaker: f.speaker, rationale: f.rationale };
    if (f.class === 'DISCUSSION' || f.class === 'REQUEST' || f.class === 'INTENTION') {
      const why =
        f.class === 'DISCUSSION' ? 'Discussion binds nobody.' : f.class === 'REQUEST' ? 'A request is not a promise until someone accepts it.' : 'Tentative language is an intention, not a promise.';
      findings.push({ ...base, notConverted: why, candidate: null });
      continue;
    }
    const ownerName = f.owner ?? (f.class === 'COMMITMENT' ? f.speaker : null);
    if (!ownerName) {
      findings.push({ ...base, notConverted: 'Nobody in the notes stands behind it.', candidate: null });
      continue;
    }
    if (!f.statement?.trim()) {
      findings.push({ ...base, notConverted: 'It does not say what would be done.', candidate: null });
      continue;
    }
    // A date counts only when its words are in the quote, it parses, and it is not before the meeting.
    const dueText = f.dueText && normalize(quote).includes(normalize(f.dueText)) ? f.dueText : null;
    const dueBy = dueText && isIso(f.dueDate) && f.dueDate >= input.source.heldOn ? f.dueDate : null;
    const candidate: SuggestCandidateInput = {
      source: {
        kind: input.source.kind,
        system: input.source.system,
        ref: input.source.ref,
        label: input.source.label,
        quote,
        locator,
        observedAt: `${input.source.heldOn}T00:00:00.000Z`,
        entityRef: null,
      },
      utteranceClass: f.class,
      proposal: {
        statement: f.statement.trim(),
        intendedOutcome: f.proposedOutcome?.trim() || null,
        owner: matchParty(ownerName, input),
        ownerText: ownerName,
        principal: null,
        dueBy,
        dueText,
        dependencies: [...f.dependencies],
        entities: f.entities.map((e) => ({ text: e, entityRef: input.entities.find((x) => x.names.some((n) => normalize(e).includes(normalize(n))))?.entityRef ?? null })),
        evidence: [],
      },
      confidence: Math.min(1, Math.max(0, Number.isFinite(f.confidence) ? f.confidence : 0)),
      extractor,
      dedupeKey: `${input.source.ref}#${shortHash(normalize(quote))}`,
    };
    candidates.push(candidate);
    findings.push({ ...base, notConverted: null, candidate });
  }
  return { extractor, findings, candidates, removed };
}

/** Run a model and govern what it returns. */
export async function extractCandidates(model: ExtractionModel, input: ExtractionInput): Promise<Result<GovernedExtraction>> {
  if (!input.text.trim()) return fail('extraction.empty', 'There is nothing to read.');
  const raw = await model.extract(input);
  if (!raw.ok) return raw;
  return ok(governExtraction(raw.value, input, { name: model.name, model: model.model }));
}

// ----------------------------------------------------- reference extractor

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function readDate(phrase: string, heldOn: string): { text: string; date: string | null } | null {
  const m = /\bby\s+((\d{1,2})\s+([A-Za-z]+)|([A-Za-z]+)\s+(\d{1,2}))\b/i.exec(phrase);
  if (!m) return null;
  const day = Number(m[2] ?? m[5]);
  const month = MONTHS.findIndex((x) => x.startsWith((m[3] ?? m[4]).toLowerCase().slice(0, 3)));
  if (month < 0 || day < 1 || day > 31) return { text: m[0], date: null };
  const year = Number(heldOn.slice(0, 4));
  const candidate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { text: m[0], date: candidate >= heldOn ? candidate : `${year + 1}${candidate.slice(4)}` };
}

/**
 * Deterministic, offline, and honest about it: cue phrases, not understanding. It exists so the demo and the
 * tests run without a model, and so the governance above is exercised identically by both.
 */
export const referenceExtractor: ExtractionModel = {
  name: 'forge-reference-extractor@1',
  model: null,
  async extract(input) {
    const findings: RawFinding[] = [];
    for (const line of input.text.split(/\r?\n/)) {
      const m = /^\s*(?:[-*]\s*)?([A-Z][\w .'-]{0,40}?):\s+(.+)$/.exec(line);
      // "Agreed: …" is how notes record a decision, not a person speaking.
      const lead = m !== null && /^(agreed|decided|decision)$/i.test(m[1].trim());
      const speaker = m && !lead ? m[1].trim() : null;
      const said = (m && !lead ? m[2] : m ? `${m[1].trim()}: ${m[2]}` : line).trim();
      if (said.length < 12) continue;
      const lower = said.toLowerCase();
      let cls: UtteranceClass | null = null;
      if (/^(agreed|decided|decision)\b[:,]?/i.test(said)) cls = 'DECISION';
      else if (/\b(i'll try|i will try|might|maybe|perhaps|probably|thinking about|hope to|plan to look)\b/.test(lower)) cls = 'INTENTION';
      else if (/\b(can you|could you|would you|asked whether|asked if|please)\b/.test(lower)) cls = 'REQUEST';
      else if (/\b(i will|i'll|we will|we'll|i commit|we commit)\b/.test(lower) && /\bby\b/.test(lower)) cls = 'COMMITMENT';
      else if (/\b(we should|we could|what if|i think|seems)\b/.test(lower)) cls = 'DISCUSSION';
      if (cls === null) continue;
      const due = readDate(said, input.source.heldOn);
      const owner = cls === 'DECISION' ? (/\b(?:[Oo]wner|[Ll]ed by|[Oo]wned by)\s*:?\s*([A-Z][\w .'-]+?)(?:[.,;]|$)/.exec(said)?.[1] ?? null) : speaker;
      const statement = cls === 'COMMITMENT' || cls === 'DECISION'
        ? said.replace(/^(agreed|decided|decision)\s*[:,]?\s*/i, '').replace(/^(i|we)\s*(will|'ll)\s*/i, '').replace(/\s*\bby\s+.+$/i, '').replace(/[.;]\s*$/, '')
        : null;
      findings.push({
        quote: said,
        class: cls,
        speaker,
        statement: statement ? statement.charAt(0).toUpperCase() + statement.slice(1) : null,
        proposedOutcome: null,
        owner,
        dueText: due?.text ?? null,
        dueDate: due?.date ?? null,
        dependencies: [],
        entities: input.entities.filter((e) => e.names.some((n) => lower.includes(n.toLowerCase()))).map((e) => e.names[0]),
        confidence: cls === 'COMMITMENT' ? 0.7 : cls === 'DECISION' ? 0.65 : 0.6,
        rationale: `Cue phrase for ${cls.toLowerCase()} (forge-reference-extractor@1).`,
      });
    }
    return ok({ findings });
  },
};
