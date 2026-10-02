/**
 * The four product decisions of 2026-10-01, at the kernel:
 *   1. execution records are evidence, not judgment;
 *   2. consequential acts wait for trusted authority in shared production;
 *   3–4. candidates — from a Memoire promise or a meeting — bind nobody until a person confirms them;
 *   and the verified outcome Forge publishes for Helm's memory.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createForgeRuntime, createInMemoryCandidateStore, createInMemoryStore, executionRecords, manualClock, sequentialIds, unwrap, verifyOutcome } from '../src/index.ts';
import { FIN, GM, SCM, agent, connector, gm, helmOrigin, scm, transferTerms } from './helpers.mjs';

function setup(opts = {}) {
  const clock = manualClock('2026-09-25T09:00:00.000Z');
  const runtime = createForgeRuntime({ store: createInMemoryStore(clock), candidates: createInMemoryCandidateStore(clock), clock, ids: sequentialIds(), ...opts });
  return { clock, runtime };
}

const meetingCandidate = (over = {}) => ({
  source: { kind: 'MEETING_NOTES', system: 'notes', ref: 'notes:logistics-review-2026-10-16', label: 'Logistics review, 16 Oct', quote: 'Minh: I will update the transfer procedure to include a QC re-release step by 30 October.', locator: 'line 6', observedAt: '2026-10-16T08:00:00.000Z', entityRef: null },
  utteranceClass: 'COMMITMENT',
  proposal: { statement: 'Update the transfer procedure to include a QC re-release step', intendedOutcome: null, owner: SCM, ownerText: 'Minh', principal: null, dueBy: '2026-10-30', dueText: 'by 30 October', dependencies: [], entities: [], evidence: [] },
  confidence: 0.86,
  extractor: { name: 'test-extractor', model: null },
  dedupeKey: 'notes:logistics-review-2026-10-16#line-6',
  ...over,
});

const confirmTerms = (over = {}) => ({
  statement: 'Update the transfer procedure to include a QC re-release step',
  intendedOutcome: 'Every transfer from consignment includes a QC re-release before the customer date.',
  why: 'Two units failed seal inspection after the Rohto transfer.',
  owner: SCM,
  principal: GM,
  dueBy: '2026-10-30',
  evidence: [{ key: 'sop-published', level: 'OUTPUT', description: 'Revised transfer SOP published', required: true, matcher: null }],
  measures: [],
  value: [],
  ...over,
});

describe('candidates — the model proposes, a person disposes', () => {
  test('an agent may suggest; the candidate is an inference and binds nobody', async () => {
    const { runtime } = setup();
    const [c] = unwrap(await runtime.suggestCandidates(agent, [meetingCandidate()]));
    assert.equal(c.state, 'PENDING');
    assert.equal(c.record.epistemic, 'INFERENCE');
    assert.deepEqual(unwrap(await runtime.list(gm)), [], 'nothing reaches the ledger until a person confirms');
  });

  test('discussion, requests and intentions are never candidates', async () => {
    const { runtime } = setup();
    for (const cls of ['DISCUSSION', 'REQUEST', 'INTENTION']) {
      const r = await runtime.suggestCandidates(agent, [meetingCandidate({ utteranceClass: cls, dedupeKey: cls })]);
      assert.equal(r.error.code, 'candidate.not_a_commitment', cls);
    }
  });

  test('a candidate from a conversation must quote what it rests on', async () => {
    const { runtime } = setup();
    const r = await runtime.suggestCandidates(agent, [meetingCandidate({ source: { ...meetingCandidate().source, quote: '' } })]);
    assert.equal(r.error.code, 'candidate.unquoted');
  });

  test('reading the same notes twice suggests nothing new', async () => {
    const { runtime } = setup();
    unwrap(await runtime.suggestCandidates(agent, [meetingCandidate()]));
    unwrap(await runtime.suggestCandidates(agent, [meetingCandidate()]));
    assert.equal(unwrap(await runtime.listCandidates(gm)).length, 1);
  });

  test('an agent cannot confirm or dismiss; a person can', async () => {
    const { runtime } = setup();
    const [c] = unwrap(await runtime.suggestCandidates(agent, [meetingCandidate()]));
    assert.equal((await runtime.confirmCandidate(agent, c.record.id, { terms: confirmTerms() })).error.code, 'authority.refused');
    assert.equal((await runtime.dismissCandidate(agent, c.record.id, 'no')).error.code, 'authority.refused');
    assert.equal((await runtime.dismissCandidate(gm, c.record.id, '  ')).error.code, 'reason.required');
  });

  test('confirming proposes a commitment linked to the meeting — which its owner still has to accept', async () => {
    const { runtime } = setup();
    const [c] = unwrap(await runtime.suggestCandidates(agent, [meetingCandidate()]));
    const { candidate, commitment } = unwrap(await runtime.confirmCandidate(gm, c.record.id, { terms: confirmTerms() }));
    assert.equal(candidate.state, 'CONFIRMED');
    assert.equal(candidate.disposition.commitmentId, commitment.record.id);
    assert.deepEqual(candidate.disposition.edited, ['intendedOutcome', 'principal', 'evidence']);
    assert.equal(commitment.phase, 'PROPOSED');
    assert.equal(commitment.record.origin.kind, 'COMMUNICATION');
    assert.equal(commitment.record.origin.ref, 'notes:logistics-review-2026-10-16');
    assert.equal(commitment.capture.statement, 'EXTRACTED');
    assert.equal(commitment.capture.intendedOutcome, 'MANUAL');
    assert.ok(commitment.record.context.some((x) => x.key === 'context.source' && x.value.includes('QC re-release')));
    assert.equal((await runtime.confirmCandidate(gm, c.record.id, { terms: confirmTerms() })).error.code, 'candidate.already_disposed');
  });

  test('a Memoire promise confirmed becomes an obligation linked to the promise, not a copy of it', async () => {
    const { runtime } = setup();
    const [c] = unwrap(await runtime.suggestCandidates(connector('memoire'), [
      meetingCandidate({
        source: { kind: 'MEMOIRE_PROMISE', system: 'memoire', ref: 'memoire:commitment:p-1', label: 'Memoire promise', quote: 'Deliver 12 units to Rohto HCMC', locator: null, observedAt: '2026-09-26T08:00:00.000Z', entityRef: 'memoire:opportunity:rohto-q4-tender' },
        dedupeKey: 'memoire:commitment:p-1',
      }),
    ]));
    const { commitment } = unwrap(await runtime.confirmCandidate(gm, c.record.id, { terms: confirmTerms({ statement: 'Update the transfer procedure to include a QC re-release step' }) }));
    assert.equal(commitment.record.origin.kind, 'OBLIGATION');
    assert.equal(commitment.record.origin.ref, 'memoire:commitment:p-1');
    assert.equal(commitment.capture.statement, 'INHERITED');
  });
});

describe('trusted authority for consequential acts', () => {
  test('in shared production, an interim verdict cannot accept, approve, change or close', async () => {
    const { runtime } = setup({ requireTrustedAuthority: true });
    const v = unwrap(await runtime.propose(gm, { origin: helmOrigin, terms: transferTerms() }));
    const accepted = await runtime.accept(scm, v.record.id);
    assert.equal(accepted.error.code, 'authority.untrusted');
    unwrap(await runtime.recordContextChange(gm, v.record.id, { source: { system: 'manual', ref: null, url: null }, statement: 'note', material: false }));
  });

  test('a trusted authority answers the same port', async () => {
    const trustedHelm = {
      policy: 'helm-authority@test',
      evaluate: () => ({ outcome: 'ALLOWED', policy: 'helm-authority@test', rule: 'delegated', statement: 'Allowed by Helm.', trusted: true }),
    };
    const { runtime } = setup({ requireTrustedAuthority: true, authority: trustedHelm });
    const v = unwrap(await runtime.propose(gm, { origin: helmOrigin, terms: transferTerms() }));
    const accepted = unwrap(await runtime.accept(scm, v.record.id));
    assert.equal(accepted.history.at(-1).authority.trusted, true);
    assert.equal(accepted.history.at(-1).authority.policy, 'helm-authority@test');
  });
});

describe('verified outcomes for Helm', () => {
  async function closedWithOutcome(env, { outcome = true, systemEvidence = true } = {}) {
    const terms = transferTerms({
      measures: [{ key: 'Units', label: 'Units in HCMC', comparator: 'AT_LEAST', expected: '8', unit: 'units', statement: null, source: { system: 'helm', ref: 'helm:value-node:n-1@2026-10-01', url: null }, metricKey: 'AvailableInventory' }],
      evidence: [{ key: 'units-observed', level: 'OUTCOME', description: 'Helm observes the units', required: true, matcher: { system: 'helm', eventType: 'value.actual_observed', objectRef: 'helm:value-node:n-1@2026-10-01', where: {} } }],
    });
    const v = unwrap(await env.runtime.propose(gm, { origin: helmOrigin, terms }));
    unwrap(await env.runtime.accept(scm, v.record.id));
    if (systemEvidence) {
      unwrap(await env.runtime.recordEvidence(connector('helm'), v.record.id, {
        requirementKey: 'units-observed', stance: 'SUPPORTS', epistemic: 'FACT', channel: 'SYSTEM_EVENT', source: { system: 'helm', ref: 'helm:value-node:n-1@2026-10-01', url: null },
        statement: '8 units', observedAt: '2026-10-06T07:00:00.000Z', confidence: null, observationId: 'hv-1',
      }));
    }
    unwrap(await env.runtime.close(gm, v.record.id, { resolution: 'FULFILLED', confirmedWithoutEvidence: !systemEvidence }, 'Received.'));
    if (outcome) {
      unwrap(await env.runtime.recordOutcome(gm, v.record.id, { statement: 'Eight units arrived.', achievedOn: '2026-10-06', measures: [{ key: 'Units', actual: '8', note: null }], realizedValue: [], basis: [] }));
    }
    return v.record.id;
  }

  test('nothing is published until the outcome is recorded and the evidence holds', async () => {
    const env = setup();
    const id = await closedWithOutcome(env, { outcome: false });
    const r = await env.runtime.publishOutcome(gm, id);
    assert.equal(r.error.code, 'outcome.not_verifiable');
    assert.match(r.error.message, /Nobody has recorded what actually happened/);
  });

  test('a verified outcome asks the principal to publish; publishing twice changes nothing', async () => {
    const env = setup();
    const id = await closedWithOutcome(env);
    assert.ok(unwrap(await env.runtime.asks(gm)).some((c) => c.code === 'OUTCOME_UNPUBLISHED'));
    assert.equal((await env.runtime.publishOutcome(scm, id)).error.code, 'authority.refused', 'the principal publishes, not the owner');
    const { publication } = unwrap(await env.runtime.publishOutcome(gm, id));
    assert.equal(publication.measures[0].basis.kind, 'SYSTEM');
    assert.equal(publication.measures[0].metricKey, 'AvailableInventory');
    assert.match(publication.fingerprint, /^fop_[0-9a-f]{16}$/);
    unwrap(await env.runtime.publishOutcome(gm, id));
    const v = unwrap(await env.runtime.view(gm, id));
    assert.equal(v.publications.length, 1);
    assert.ok(!unwrap(await env.runtime.asks(gm)).some((c) => c.code === 'OUTCOME_UNPUBLISHED'));
  });

  test('an actual nobody’s system recorded is published as a person’s word, never dressed as a fact from a system', async () => {
    const env = setup();
    const id = await closedWithOutcome(env, { systemEvidence: false });
    const v = unwrap(await env.runtime.view(gm, id));
    const verified = verifyOutcome(v);
    assert.equal(verified.ok, false, 'an outcome requirement only a person confirmed is not proof of an outcome');
  });
});

describe('execution records — evidence, not judgment', () => {
  test('records count what happened, ordered by name, never by results, and say when the sample is too small', async () => {
    const env = setup();
    const a = unwrap(await env.runtime.propose(gm, { origin: helmOrigin, terms: transferTerms() }));
    unwrap(await env.runtime.accept(scm, a.record.id));
    unwrap(await env.runtime.close(scm, a.record.id, { resolution: 'MISSED' }, 'Never released.'));
    unwrap(await env.runtime.propose(gm, { origin: helmOrigin, terms: transferTerms({ owner: FIN, statement: 'Update the forecast' }) }));
    const records = executionRecords(unwrap(await env.runtime.list(gm)));
    assert.deepEqual(records.map((r) => r.party.label), ['Finance Director Vietnam', 'Supply Chain Director Vietnam']);
    const scmRecord = records[1];
    assert.equal(scmRecord.endings.MISSED, 1);
    assert.equal(scmRecord.sample.sufficient, false);
    assert.match(scmRecord.sample.caveat, /too few to read a pattern into/);
    const keys = JSON.stringify(records);
    assert.equal(/score|rating|rank|percent/i.test(keys), false, 'no score, rating, rank or percentage anywhere in a record');
  });
});
