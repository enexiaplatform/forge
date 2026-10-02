/**
 * Reading a review for explanations and lessons (ADR-0030): the Claude reader asks for Forge's learning schema and fails
 * plainly; whatever any reader returns is governed by Forge — not in the notes is removed, neither is not taken, a
 * stated scope is kept only in the notes' words — and nothing is recorded by reading.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { extractLearnings, governLearnings, LEARNING_SCHEMA, referenceLearningExtractor } from '../../packages/fabric/src/index.ts';
import { OUTCOME_REVIEW_NOTES } from '../../packages/demo/src/index.ts';
import { CLAUDE_EXTRACTOR_MODEL, createClaudeLearningExtractor, learningPrompt } from '../extraction/claude.ts';
import { handleExtractLearnings } from '../extraction/http.ts';

const input = { source: OUTCOME_REVIEW_NOTES.source, text: OUTCOME_REVIEW_NOTES.text, commitment: { statement: 'Reallocate Distributor D’s consignment stock (DEMO)', ended: 'partly fulfilled' } };
const answer = (findings, over = {}) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: CLAUDE_EXTRACTOR_MODEL, stop_reason: 'end_turn', stop_details: null,
  content: [{ type: 'text', text: JSON.stringify({ findings }) }], usage: { input_tokens: 1, output_tokens: 1 }, ...over,
});
const fakeClient = (reply) => {
  const calls = [];
  return { calls, beta: { messages: { stream(params) { calls.push(params); return { finalMessage: async () => reply }; } } } };
};
const finding = (over) => ({ quote: '', class: 'LESSON', speaker: null, statement: null, appliesTo: null, confidence: 0.8, rationale: 'test', ...over });

describe('the Claude reader', () => {
  test('asks Opus 5.5 for the learning schema, with the review and what ended, effort high and the default fallback', async () => {
    const client = fakeClient(answer([]));
    const r = await createClaudeLearningExtractor({ client }).extract(input);
    assert.equal(r.ok, true);
    const p = client.calls[0];
    assert.equal(p.model, 'claude-opus-5-5');
    assert.deepEqual(p.output_config.format.schema, LEARNING_SCHEMA);
    assert.equal(p.output_config.effort, 'high');
    assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(p.fallbacks, 'default');
    assert.match(p.system, /Reallocate Distributor D/);
    assert.equal(p.messages[0].content, learningPrompt(input));
  });

  test('a refusal and a truncated answer are failures, said plainly — never an empty reading', async () => {
    const refused = await createClaudeLearningExtractor({ client: fakeClient(answer([], { stop_reason: 'refusal', stop_details: { category: 'cyber', explanation: null } })) }).extract(input);
    assert.equal(refused.error.code, 'extraction.refused');
    assert.match(refused.error.message, /this review \(cyber\)/);
    const cut = await createClaudeLearningExtractor({ client: fakeClient(answer([], { stop_reason: 'max_tokens' })) }).extract(input);
    assert.equal(cut.error.code, 'extraction.truncated');
  });
});

describe('governance — Forge decides what is proposed', () => {
  test('an invented quote is removed; neither is not taken; a scope not in the notes is dropped', () => {
    const g = governLearnings(
      {
        findings: [
          finding({ quote: 'Margin landed under the committed future because re-labelling and QC rework were not in the transfer cost Helm modelled.', class: 'EXPLANATION' }),
          finding({ quote: 'Distributor D is unreliable and should be replaced.', class: 'LESSON' }),
          finding({ quote: 'Thanks all for getting the twelve units there.', class: 'OTHER' }),
          finding({ quote: 'Next time we reallocate consignment stock, plan two to four working days of QC re-release before the customer date.', appliesTo: 'all supplier deliveries' }),
          finding({ quote: 'Going forward, quote re-labelling in the transfer cost for every reallocation of consignment stock.', appliesTo: 'every reallocation of consignment stock' }),
        ],
      },
      input,
      { name: 'test', model: null },
    );
    assert.deepEqual(g.removed.map((r) => r.quote), ['Distributor D is unreliable and should be replaced.']);
    assert.equal(g.notTaken.length, 1);
    assert.deepEqual(g.proposals.map((p) => p.kind), ['EXPLANATION', 'LESSON', 'LESSON']);
    assert.equal(g.proposals[1].appliesTo, null, 'a scope the notes do not state is the person’s to say');
    assert.equal(g.proposals[2].appliesTo, 'every reallocation of consignment stock');
    assert.equal(g.proposals[0].epistemic, 'INFERENCE');
    assert.equal(g.proposals[0].drawnFrom.locator, 'line 4');
    assert.equal(g.proposals[0].drawnFrom.ref, OUTCOME_REVIEW_NOTES.source.ref);
  });

  test('the offline reader finds the two explanations and the two lessons in the DEMO review, and nothing else', async () => {
    const r = await extractLearnings(referenceLearningExtractor, input);
    assert.deepEqual(r.value.proposals.map((p) => [p.kind, p.drawnFrom.locator]), [['EXPLANATION', 'line 4'], ['EXPLANATION', 'line 5'], ['LESSON', 'line 7'], ['LESSON', 'line 8']]);
  });
});

describe('/api/extract-learnings', () => {
  const call = async (method, body, env = {}) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
    req.method = method;
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
    await handleExtractLearnings(req, res, env);
    return res;
  };
  test('a probe, a refusal of anything but a review, and 503 without a key', async () => {
    assert.equal((await call('GET', undefined, {})).body.available, false);
    assert.equal((await call('POST', { text: 'x' }, {})).statusCode, 400);
    assert.equal((await call('POST', input, {})).statusCode, 503);
  });
});
