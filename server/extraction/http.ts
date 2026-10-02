/**
 * `/api/extract` — the HTTP face of the Claude extractor, for the console.
 *
 *   GET  → 200 { available: true, extractor, model } when the server holds a key,
 *          200 { available: false, reason } when it does not — a capability probe, not an error.
 *   POST → ExtractionInput in; { ok: true, value: RawExtraction } or { ok: false, error } out.
 *
 * It returns the model's raw findings only. Governance — what may become a
 * candidate — runs where candidates are suggested, by Forge's own code.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ExtractionInput, LearningExtractionInput } from '@forge/fabric';
import { CLAUDE_EXTRACTOR_MODEL, CLAUDE_EXTRACTOR_NAME, CLAUDE_LEARNING_EXTRACTOR_NAME, createClaudeExtractor, createClaudeLearningExtractor } from './claude.ts';

const LIMIT = 256 * 1024;

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > LIMIT) throw new Error('too_large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const isInput = (v: unknown): v is ExtractionInput => {
  const i = v as ExtractionInput;
  return (
    typeof i === 'object' &&
    i !== null &&
    typeof i.text === 'string' &&
    typeof i.source?.label === 'string' &&
    typeof i.source?.heldOn === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(i.source.heldOn) &&
    Array.isArray(i.parties) &&
    Array.isArray(i.entities)
  );
};

export async function handleExtract(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (req.method === 'GET') {
    if (!env.ANTHROPIC_API_KEY) return send(res, 200, { available: false, reason: 'No ANTHROPIC_API_KEY on the server; the reference extractor reads instead.' });
    return send(res, 200, { available: true, extractor: CLAUDE_EXTRACTOR_NAME, model: CLAUDE_EXTRACTOR_MODEL });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'GET or POST.' } });
  }
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (e) {
    return send(res, (e as Error).message === 'too_large' ? 413 : 400, { ok: false, error: { code: 'extraction.bad_request', message: 'Send the notes as JSON, under 256 KB.' } });
  }
  if (!isInput(body)) return send(res, 400, { ok: false, error: { code: 'extraction.bad_request', message: 'That is not an extraction input.' } });
  const result = await createClaudeExtractor({ apiKey: env.ANTHROPIC_API_KEY }).extract(body);
  return send(res, result.ok ? 200 : result.error.code === 'extraction.unavailable' ? 503 : 502, result);
}

const isLearningInput = (v: unknown): v is LearningExtractionInput => {
  const i = v as LearningExtractionInput;
  return (
    typeof i === 'object' &&
    i !== null &&
    typeof i.text === 'string' &&
    typeof i.source?.label === 'string' &&
    typeof i.source?.heldOn === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(i.source.heldOn) &&
    typeof i.commitment?.statement === 'string'
  );
};

/**
 * `/api/extract-learnings` — the same face for reading a review (ADR-0030): a capability probe on GET; on POST, a
 * LearningExtractionInput in and the model's raw findings out. Forge's `governLearnings` decides what is proposed.
 */
export async function handleExtractLearnings(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (req.method === 'GET') {
    if (!env.ANTHROPIC_API_KEY) return send(res, 200, { available: false, reason: 'No ANTHROPIC_API_KEY on the server; the reference extractor reads instead.' });
    return send(res, 200, { available: true, extractor: CLAUDE_LEARNING_EXTRACTOR_NAME, model: CLAUDE_EXTRACTOR_MODEL });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'GET or POST.' } });
  }
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (e) {
    return send(res, (e as Error).message === 'too_large' ? 413 : 400, { ok: false, error: { code: 'extraction.bad_request', message: 'Send the review as JSON, under 256 KB.' } });
  }
  if (!isLearningInput(body)) return send(res, 400, { ok: false, error: { code: 'extraction.bad_request', message: 'That is not a review to read.' } });
  const result = await createClaudeLearningExtractor({ apiKey: env.ANTHROPIC_API_KEY }).extract(body);
  return send(res, result.ok ? 200 : result.error.code === 'extraction.unavailable' ? 503 : 502, result);
}
