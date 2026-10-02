/**
 * Reading for commitments: the governance every extractor's output passes
 * through. A model proposes; these rules decide what may even be offered to a
 * person as a candidate — and everything offered is inference.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFixtureCommercialApi,
  EXTRACTION_SCHEMA,
  extractCandidates,
  extractionInstructions,
  governExtraction,
  listAllPromises,
  referenceExtractor,
} from '../src/index.ts';
import { QC_REVIEW_NOTES, ROLES } from '@forge/demo';

const finding = (over = {}) => ({
  quote: 'Minh: I will revise the transfer SOP to add a QC re-release step by 30 October.',
  class: 'COMMITMENT',
  speaker: 'Minh',
  statement: 'Revise the transfer SOP to add a QC re-release step',
  proposedOutcome: null,
  owner: 'Minh',
  dueText: 'by 30 October',
  dueDate: '2026-10-30',
  dependencies: [],
  entities: [],
  confidence: 0.8,
  rationale: 'An undertaking with a date.',
  ...over,
});
const govern = (findings) => governExtraction({ findings }, QC_REVIEW_NOTES, { name: 'test', model: 'test-model' });

describe('the reference extractor, governed', () => {
  test('what was promised is proposed; discussion, requests and intentions are kept as what they were', async () => {
    const read = (await extractCandidates(referenceExtractor, QC_REVIEW_NOTES));
    assert.ok(read.ok);
    const { findings, candidates } = read.value;
    assert.deepEqual(candidates.map((c) => c.proposal.statement), ['Revise the transfer SOP to add a QC re-release step', 'Re-inspect the two held units and release them']);
    assert.deepEqual(findings.filter((f) => f.candidate === null).map((f) => f.class).sort(), ['DISCUSSION', 'INTENTION', 'REQUEST']);
    const sop = candidates[0];
    assert.equal(sop.proposal.owner.label, ROLES.SCM.label, 'the speaker matched someone Forge knows');
    assert.equal(sop.proposal.dueBy, '2026-10-30');
    assert.equal(sop.source.locator, 'line 6');
    assert.equal(sop.source.kind, 'MEETING_NOTES');
    assert.ok(QC_REVIEW_NOTES.text.includes(sop.source.quote), 'the quote is verbatim');
  });

  test('reading the same notes twice proposes the same keys, so nothing is proposed twice', async () => {
    const a = (await extractCandidates(referenceExtractor, QC_REVIEW_NOTES)).value.candidates.map((c) => c.dedupeKey);
    const b = (await extractCandidates(referenceExtractor, QC_REVIEW_NOTES)).value.candidates.map((c) => c.dedupeKey);
    assert.deepEqual(a, b);
    assert.equal(new Set(a).size, a.length);
  });

  test('empty notes are refused, not read as nothing', async () => {
    const r = await extractCandidates(referenceExtractor, { ...QC_REVIEW_NOTES, text: '   ' });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'extraction.empty');
  });
});

describe('governance of whatever a model returns', () => {
  test('a quote that is not in the notes is removed, and listed as removed', () => {
    const g = govern([finding({ quote: 'Minh: I will rebuild the whole warehouse by Friday.' })]);
    assert.equal(g.candidates.length, 0);
    assert.match(g.removed[0].reason, /does not appear/);
  });

  test('a class Forge does not know is removed, never guessed at', () => {
    const g = govern([finding({ class: 'PROMISE' })]);
    assert.equal(g.candidates.length, 0);
    assert.equal(g.removed.length, 1);
  });

  test('a model that upgrades a request to a commitment is still bound by the words: the class is the model’s, the quote is checked', () => {
    const g = govern([finding({ quote: 'Linh: Could you check whether the seal failures are batch-related?', class: 'REQUEST', statement: 'Check the seal failures' })]);
    assert.equal(g.candidates.length, 0);
    assert.match(g.findings[0].notConverted, /request is not a promise/);
  });

  test('a commitment nobody stands behind is not a candidate', () => {
    const g = govern([finding({ owner: null, speaker: null })]);
    assert.equal(g.candidates.length, 0);
    assert.match(g.findings[0].notConverted, /Nobody/);
  });

  test('a date counts only if its words are in the quote and it is not before the meeting', () => {
    assert.equal(govern([finding({ dueText: 'by 3 November', dueDate: '2026-11-03' })]).candidates[0].proposal.dueBy, null, 'words not in the quote');
    assert.equal(govern([finding({ dueDate: '2026-10-01' })]).candidates[0].proposal.dueBy, null, 'before the meeting');
    assert.equal(govern([finding({ dueDate: '30/10/2026' })]).candidates[0].proposal.dueBy, null, 'not a date');
    assert.equal(govern([finding()]).candidates[0].proposal.dueBy, '2026-10-30');
  });

  test('an owner Forge does not know stays as the words, never a guessed person', () => {
    const c = govern([finding({ owner: 'Someone from Distributor D' })]).candidates[0];
    assert.equal(c.proposal.owner, null);
    assert.equal(c.proposal.ownerText, 'Someone from Distributor D');
  });

  test('confidence is clamped and the extractor is named on every candidate', () => {
    const c = govern([finding({ confidence: 7 })]).candidates[0];
    assert.equal(c.confidence, 1);
    assert.deepEqual(c.extractor, { name: 'test', model: 'test-model' });
  });

  test('the schema asks for every field, and the instructions name the meeting date', () => {
    assert.deepEqual([...EXTRACTION_SCHEMA.properties.findings.items.required].sort(), Object.keys(EXTRACTION_SCHEMA.properties.findings.items.properties).sort());
    assert.match(extractionInstructions(QC_REVIEW_NOTES), /2026-10-16/);
  });
});

describe('the Commercial API v1 fixture', () => {
  const versions = [
    { id: 'b', accountId: null, opportunityId: null, party: 'self', responsiblePerson: 'Hoa', promise: 'B', dueDate: null, status: 'open', updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'a', accountId: null, opportunityId: null, party: 'self', responsiblePerson: 'Hoa', promise: 'A', dueDate: null, status: 'open', updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'c', accountId: null, opportunityId: null, party: 'self', responsiblePerson: 'Hoa', promise: 'C', dueDate: null, status: 'open', updatedAt: '2026-09-02T00:00:00.000Z' },
    { id: 'a', accountId: null, opportunityId: null, party: 'self', responsiblePerson: 'Hoa', promise: 'A', dueDate: null, status: 'completed', updatedAt: '2026-09-03T00:00:00.000Z' },
  ];

  test('serves each promise as it stood at the moment, ordered by id, with Memoire’s cursor', async () => {
    let now = '2026-09-02T12:00:00.000Z';
    const api = createFixtureCommercialApi(versions, () => now);
    const first = await api.listCommitments({ limit: 2 });
    assert.deepEqual(first.items.map((p) => p.id), ['a', 'b']);
    assert.equal(first.nextCursor, 'b');
    const second = await api.listCommitments({ limit: 2, after: first.nextCursor });
    assert.deepEqual(second.items.map((p) => p.id), ['c']);
    assert.equal(second.nextCursor, null);
    assert.equal((await listAllPromises(api, 1)).find((p) => p.id === 'a').status, 'open');
    now = '2026-09-04T00:00:00.000Z';
    assert.equal((await listAllPromises(api, 1)).find((p) => p.id === 'a').status, 'completed');
  });
});
