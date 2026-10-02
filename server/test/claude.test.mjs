/**
 * The Claude extractor, without the network: an injected client records the
 * request and answers as the API would. What is checked is what Forge asks
 * for, and that every way a model can fail is said plainly — never turned into
 * an empty reading.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EXTRACTION_SCHEMA, extractCandidates, extractionInstructions } from '@forge/fabric';
import { QC_REVIEW_NOTES } from '@forge/demo';
import { CLAUDE_EXTRACTOR_MODEL, createClaudeExtractor, extractionPrompt } from '../extraction/claude.ts';
import { handleExtract } from '../extraction/http.ts';

const answer = (over = {}) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: CLAUDE_EXTRACTOR_MODEL,
  stop_reason: 'end_turn',
  stop_details: null,
  content: [{ type: 'text', text: JSON.stringify({ findings: [] }) }],
  usage: { input_tokens: 1, output_tokens: 1 },
  ...over,
});

function fakeClient(reply) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        stream(params) {
          calls.push(params);
          return { finalMessage: async () => (typeof reply === 'function' ? reply(params) : reply) };
        },
      },
    },
  };
}

const findingFor = (quote, over = {}) => ({
  quote, class: 'COMMITMENT', speaker: 'Minh', statement: 'Revise the transfer SOP', proposedOutcome: null, owner: 'Minh',
  dueText: 'by 30 October', dueDate: '2026-10-30', dependencies: [], entities: [], confidence: 0.82, rationale: 'An undertaking with a date.', ...over,
});

describe('the Claude extractor', () => {
  test('asks Opus 5.5 for the extraction schema, with Forge’s instructions, effort high and Anthropic’s default fallback', async () => {
    const client = fakeClient(answer());
    const r = await createClaudeExtractor({ client }).extract(QC_REVIEW_NOTES);
    assert.ok(r.ok);
    const p = client.calls[0];
    assert.equal(p.model, 'claude-opus-5-5');
    assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(p.fallbacks, 'default');
    assert.deepEqual(p.output_config, { effort: 'high', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } });
    assert.equal(p.system, extractionInstructions(QC_REVIEW_NOTES));
    assert.equal(p.messages[0].content, extractionPrompt(QC_REVIEW_NOTES));
    assert.equal('thinking' in p, false, 'Opus 5.5 thinks adaptively by default; depth is set by effort');
    assert.equal('temperature' in p, false);
  });

  test('what the model returns is governed like any other reading: an invented quote is removed', async () => {
    const real = 'Minh: I will revise the transfer SOP to add a QC re-release step by 30 October.';
    const client = fakeClient(answer({ content: [{ type: 'text', text: JSON.stringify({ findings: [findingFor(real), findingFor('Minh: I will also fix the ERP by Monday.')] }) }] }));
    const read = await extractCandidates(createClaudeExtractor({ client }), QC_REVIEW_NOTES);
    assert.ok(read.ok);
    assert.equal(read.value.candidates.length, 1);
    assert.equal(read.value.removed.length, 1);
    assert.deepEqual(read.value.candidates[0].extractor, { name: 'forge-claude-extractor@1', model: 'claude-opus-5-5' });
  });

  test('a refusal, a truncated answer and malformed JSON are failures, said plainly', async () => {
    const refused = await createClaudeExtractor({ client: fakeClient(answer({ stop_reason: 'refusal', stop_details: { category: 'cyber', explanation: null } })) }).extract(QC_REVIEW_NOTES);
    assert.equal(refused.error.code, 'extraction.refused');
    assert.match(refused.error.message, /cyber/);
    const cut = await createClaudeExtractor({ client: fakeClient(answer({ stop_reason: 'max_tokens' })) }).extract(QC_REVIEW_NOTES);
    assert.equal(cut.error.code, 'extraction.truncated');
    const junk = await createClaudeExtractor({ client: fakeClient(answer({ content: [{ type: 'text', text: '{"findings": "none"}' }] })) }).extract(QC_REVIEW_NOTES);
    assert.equal(junk.error.code, 'extraction.malformed');
  });

  test('an unreachable model is a failure, not an empty reading', async () => {
    const client = { beta: { messages: { stream() { return { finalMessage: async () => { throw new Error('socket hang up'); } }; } } } };
    const r = await createClaudeExtractor({ client }).extract(QC_REVIEW_NOTES);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'extraction.failed');
  });

  test('without a key it is unavailable, and says the reference extractor reads instead', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await createClaudeExtractor().extract(QC_REVIEW_NOTES);
      assert.equal(r.error.code, 'extraction.unavailable');
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe('/api/extract', () => {
  const call = async (method, body, env = {}) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
    req.method = method;
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
    await handleExtract(req, res, env);
    return res;
  };

  test('the probe says whether a model is available, without erroring', async () => {
    assert.deepEqual((await call('GET', undefined, {})).body.available, false);
    const on = await call('GET', undefined, { ANTHROPIC_API_KEY: 'sk-test' });
    assert.equal(on.statusCode, 200);
    assert.equal(on.body.model, 'claude-opus-5-5');
  });

  test('anything but an extraction input is refused before a model is asked', async () => {
    assert.equal((await call('POST', '{not json', {})).statusCode, 400);
    assert.equal((await call('POST', { text: 'hello' }, {})).statusCode, 400);
    assert.equal((await call('DELETE', undefined, {})).statusCode, 405);
  });

  test('without a key, a reading request is 503 with the reason', async () => {
    const r = await call('POST', QC_REVIEW_NOTES, {});
    assert.equal(r.statusCode, 503);
    assert.equal(r.body.error.code, 'extraction.unavailable');
  });
});
