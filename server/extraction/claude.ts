/**
 * The Claude extractor — Forge's first LLM responsibility (ADR 0012), on the
 * server only. The API key never reaches a browser.
 *
 * Claude reads meeting notes and returns raw findings in Forge's extraction
 * schema (structured outputs). It does NOT produce candidates: Forge's own
 * `governExtraction` does that afterwards, on the caller's side, exactly as it
 * does for the offline reference extractor — removing any quote that is not in
 * the notes, refusing classes Forge does not know, matching owners only to
 * people Forge knows, and never treating discussion, a request or an intention
 * as a promise. What Claude returns is inference; a person confirms or not.
 *
 * Failures are typed and said plainly: no key, a refused key, rate limits, a
 * model that declined (after Anthropic's own fallback was tried), a truncated
 * answer. None of them is papered over with an empty result.
 */
import Anthropic from '@anthropic-ai/sdk';
import { fail, ok, type Result } from '@forge/kernel';
import {
  EXTRACTION_SCHEMA,
  type ExtractionInput,
  extractionInstructions,
  type ExtractionModel,
  LEARNING_SCHEMA,
  type LearningExtractionInput,
  type LearningExtractionModel,
  learningInstructions,
  type RawExtraction,
  type RawLearningFinding,
} from '@forge/fabric';

export const CLAUDE_EXTRACTOR_NAME = 'forge-claude-extractor@1';
export const CLAUDE_EXTRACTOR_MODEL = 'claude-opus-5-5';

export type ClaudeExtractorOptions = {
  /** An injected client (tests); otherwise one is made from `apiKey` or ANTHROPIC_API_KEY. */
  readonly client?: Anthropic;
  readonly apiKey?: string;
  readonly model?: string;
  readonly maxTokens?: number;
};

/** The notes, as the model is given them: what meeting, when, and the words — nothing Forge already concluded. */
export function extractionPrompt(input: ExtractionInput): string {
  return [`Meeting: ${input.source.label}, held on ${input.source.heldOn}.`, '', '<notes>', input.text, '</notes>'].join('\n');
}

const isFinding = (f: unknown): boolean => typeof f === 'object' && f !== null && typeof (f as { quote?: unknown }).quote === 'string' && typeof (f as { class?: unknown }).class === 'string';

/** Read a model's answer as RawExtraction, or say what was wrong with it. */
export function parseExtraction(text: string): Result<RawExtraction> {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return fail('extraction.malformed', 'The model’s answer was not JSON.');
  }
  const findings = (v as { findings?: unknown }).findings;
  if (!Array.isArray(findings) || !findings.every(isFinding)) return fail('extraction.malformed', 'The model’s answer did not follow the extraction schema.');
  return ok(v as RawExtraction);
}

/**
 * One structured reading: the model answers in `schema`, or the failure is said plainly — no key, a refused key, rate
 * limits, a decline (after Anthropic's server-side fallback was tried), a truncated answer. Shared by every reading
 * Forge asks of a model, so each is asked and failed the same way.
 */
async function readStructured(
  opts: ClaudeExtractorOptions,
  state: { client: Anthropic | null },
  model: string,
  schema: Record<string, unknown>,
  system: string,
  prompt: string,
  what: string,
): Promise<Result<string>> {
  if (state.client === null) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return fail('extraction.unavailable', 'No Anthropic API key is configured on the server; the reference extractor reads instead.');
    state.client = new Anthropic({ apiKey });
  }
  let message: Anthropic.Beta.BetaMessage;
  try {
    // Streamed and collected: transcripts can be long, and a long non-streaming request risks a timeout.
    const stream = state.client.beta.messages.stream({
      model,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    message = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fail('extraction.unauthorized', 'The server’s Anthropic API key was refused.');
    if (e instanceof Anthropic.RateLimitError) return fail('extraction.rate_limited', 'The model is rate-limited; try again shortly.');
    if (e instanceof Anthropic.BadRequestError) return fail('extraction.bad_request', `The model rejected the request: ${e.message}`);
    if (e instanceof Anthropic.APIError) return fail('extraction.unavailable', `The model is unavailable (${e.status ?? 'no status'}).`);
    return fail('extraction.failed', e instanceof Error ? e.message : 'The model could not be reached.');
  }
  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category ? ` (${message.stop_details.category})` : '';
    return fail('extraction.refused', `The model declined to read ${what}${category}. Nothing was proposed.`);
  }
  if (message.stop_reason === 'max_tokens') return fail('extraction.truncated', 'The answer was cut off before it finished; nothing was proposed from a partial reading.');
  return ok(message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''));
}

export function createClaudeExtractor(opts: ClaudeExtractorOptions = {}): ExtractionModel {
  const model = opts.model ?? CLAUDE_EXTRACTOR_MODEL;
  const state = { client: opts.client ?? null };
  return {
    name: CLAUDE_EXTRACTOR_NAME,
    model,
    async extract(input) {
      const text = await readStructured(opts, state, model, EXTRACTION_SCHEMA, extractionInstructions(input), extractionPrompt(input), 'these notes');
      return text.ok ? parseExtraction(text.value) : text;
    },
  };
}

// ------------------------------------------------------------- learnings

export const CLAUDE_LEARNING_EXTRACTOR_NAME = 'forge-claude-learning-extractor@1';

/** The review, as the model is given it: what ended, which meeting, and the words. */
export function learningPrompt(input: LearningExtractionInput): string {
  return [`Review: ${input.source.label}, held on ${input.source.heldOn}.`, '', '<notes>', input.text, '</notes>'].join('\n');
}

/** Read a model's answer as raw learning findings, or say what was wrong with it. */
export function parseLearnings(text: string): Result<{ findings: RawLearningFinding[] }> {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return fail('extraction.malformed', 'The model’s answer was not JSON.');
  }
  const findings = (v as { findings?: unknown }).findings;
  if (!Array.isArray(findings) || !findings.every(isFinding)) return fail('extraction.malformed', 'The model’s answer did not follow the learning schema.');
  return ok(v as { findings: RawLearningFinding[] });
}

/** Claude reads a review for explanations and lessons; Forge's `governLearnings` decides what is proposed (ADR-0030). */
export function createClaudeLearningExtractor(opts: ClaudeExtractorOptions = {}): LearningExtractionModel {
  const model = opts.model ?? CLAUDE_EXTRACTOR_MODEL;
  const state = { client: opts.client ?? null };
  return {
    name: CLAUDE_LEARNING_EXTRACTOR_NAME,
    model,
    async extract(input) {
      const text = await readStructured(opts, state, model, LEARNING_SCHEMA, learningInstructions(input), learningPrompt(input), 'this review');
      return text.ok ? parseLearnings(text.value) : text;
    },
  };
}
