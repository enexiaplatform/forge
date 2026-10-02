/**
 * One contract, two stores. Every CommitmentStore implementation must pass
 * this suite unchanged: the in-memory reference and the Postgres adapter.
 *
 * `setup()` returns { store, a, a2, b }: two scopes in organization A (people
 * who may write there) and one in organization B.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../src/index.ts';

let counter = 0;
const uid = (p) => `${p}_${process.pid}_${Date.now().toString(36)}_${(counter += 1)}`;

const terms = (owner = 'Supply Chain Director Vietnam') => ({
  statement: 'Transfer eight units to HCMC',
  intendedOutcome: 'Eight units are in HCMC',
  why: 'Rohto',
  owner: { kind: 'ROLE', label: owner, ref: null },
  principal: { kind: 'ROLE', label: 'Country GM Vietnam', ref: null },
  dueBy: '2026-10-02',
  evidence: [{ key: 'received', level: 'OUTPUT', description: 'Received', required: true, matcher: null }],
  measures: [],
  value: [],
});

export function newRecord(scope, over = {}) {
  const origin = { kind: 'DECISION', system: 'helm', ref: 'helm:decision-commitment:dcm-conf', label: 'Conformance decision', fingerprint: null, snapshot: null };
  const t = terms();
  return {
    id: uid('cmt'),
    orgId: scope.orgId,
    parentId: null,
    origin,
    terms: t,
    capture: { statement: 'INHERITED', intendedOutcome: 'MANUAL', why: 'INHERITED', owner: 'INHERITED', principal: 'INHERITED', dueBy: 'INHERITED', evidence: 'INFERRED', measures: 'MANUAL', value: 'MANUAL' },
    context: [],
    proposedBy: scope.actor,
    proposedAt: '2026-09-25T09:00:00.000Z',
    fingerprint: fingerprint('cfp', { origin, t }),
    ...over,
  };
}

export function newEvent(scope, commitmentId, over = {}) {
  return {
    id: uid('evt'),
    orgId: scope.orgId,
    commitmentId,
    type: 'ACCEPTED',
    effectiveAt: '2026-09-26T09:00:00.000Z',
    actor: scope.actor,
    reason: null,
    authority: null,
    idempotencyKey: null,
    payload: { party: { kind: 'ROLE', label: 'Supply Chain Director Vietnam', ref: null }, confirmed: [], evidence: null },
    ...over,
  };
}

/** Evidence resting on a value its source classifies financially sensitive (ADR-0017). */
export const protectedEvidence = (scope, commitmentId) =>
  newEvent(scope, commitmentId, {
    type: 'EVIDENCE_RECORDED',
    payload: {
      evidence: {
        id: uid('ev'),
        requirementKey: 'received',
        stance: 'SUPPORTS',
        epistemic: 'FACT',
        channel: 'DOCUMENT',
        source: { system: 'helm', ref: 'helm:value-node:node-margin@2026-10-01T00:00:00.000Z', url: null },
        statement: 'Gross margin %: actual 31.421 (finance source actual, recorded by Helm)',
        observedAt: '2026-10-05T00:00:00.000Z',
        confidence: null,
        observationId: null,
        protection: ['FINANCIAL_SENSITIVE'],
      },
    },
  });

export function storeConformance(name, setup) {
  describe(`${name} — store conformance`, () => {
    test('a protected fact is withheld from a reader without clearance — the event, its place and its stance stay; the value does not', async () => {
      const { store, a, a2, b } = await setup();
      const rec = (await store.insertCommitment(a, newRecord(a))).value;
      const e = protectedEvidence(a, rec.id);
      const written = await store.appendEvents(a, [e]);
      assert.equal(written.ok, true, JSON.stringify(written.error));
      assert.equal(written.value[0].payload.evidence.statement, e.payload.evidence.statement, 'the writer gets back what they wrote');

      const cleared = (await store.eventsFor(a, [rec.id])).value.find((x) => x.id === e.id);
      assert.equal(cleared.payload.evidence.statement, e.payload.evidence.statement);
      assert.equal(cleared.payload.evidence.withheld, undefined);

      const uncleared = (await store.eventsFor(a2, [rec.id])).value.find((x) => x.id === e.id);
      assert.ok(uncleared, 'the event itself is not hidden');
      assert.doesNotMatch(uncleared.payload.evidence.statement, /31\.421/);
      assert.match(uncleared.payload.evidence.statement, /^Withheld: .*financially sensitive/);
      assert.deepEqual(uncleared.payload.evidence.withheld, ['FINANCIAL_SENSITIVE'], 'never a silent absence');
      assert.equal(uncleared.payload.evidence.requirementKey, 'received');
      assert.equal(uncleared.payload.evidence.stance, 'SUPPORTS');

      const replay = await store.findByIdempotencyKey(a2, 'never-used');
      assert.equal(replay.value, null);
      assert.equal((await store.eventsFor(b, [rec.id])).value.length, 0);
    });

    test('a commitment round-trips exactly, and the store — not the caller — stamps its record time', async () => {
      const { store, a } = await setup();
      const rec = newRecord(a);
      const written = await store.insertCommitment(a, rec);
      assert.equal(written.ok, true, JSON.stringify(written.error));
      const { recordedAt, ...rest } = written.value;
      assert.deepEqual(rest, rec);
      assert.match(recordedAt, /^\d{4}-\d{2}-\d{2}T/);
      const read = await store.getCommitment(a, rec.id);
      assert.deepEqual(read.value, written.value);
    });

    test('events get a gap-free sequence per commitment, in recorded order', async () => {
      const { store, a } = await setup();
      const rec = (await store.insertCommitment(a, newRecord(a))).value;
      const first = await store.appendEvents(a, [newEvent(a, rec.id), newEvent(a, rec.id, { type: 'EXECUTION_LINKED', payload: { link: { id: 'l1', system: 'scm', kind: 'TO', ref: 'TR-1', label: 'TR-1', url: null } } })]);
      assert.equal(first.ok, true, JSON.stringify(first.error));
      const second = await store.appendEvents(a, [newEvent(a, rec.id, { type: 'DEPENDENCY_SETTLED', payload: { key: 'k', observationId: null } })]);
      assert.equal(second.ok, true, JSON.stringify(second.error));
      const all = (await store.eventsFor(a, [rec.id])).value;
      assert.deepEqual(all.map((e) => e.seq), [1, 2, 3]);
      assert.deepEqual(all.map((e) => e.type), ['ACCEPTED', 'EXECUTION_LINKED', 'DEPENDENCY_SETTLED']);
      assert.deepEqual(all[0].payload, newEvent(a, rec.id).payload);
    });

    test('a batch lands whole or not at all', async () => {
      const { store, a } = await setup();
      const rec = (await store.insertCommitment(a, newRecord(a))).value;
      const key = uid('key');
      const r = await store.appendEvents(a, [newEvent(a, rec.id, { idempotencyKey: key }), newEvent(a, rec.id, { idempotencyKey: key })]);
      assert.equal(r.ok, false);
      assert.equal(r.error.code, 'event.duplicate_idempotency_key');
      assert.deepEqual((await store.eventsFor(a, [rec.id])).value, []);
    });

    test('an idempotency key is recorded once per organization, and can be looked up', async () => {
      const { store, a } = await setup();
      const rec = (await store.insertCommitment(a, newRecord(a))).value;
      const key = uid('key');
      const ev = newEvent(a, rec.id, { idempotencyKey: key });
      assert.equal((await store.appendEvents(a, [ev])).ok, true);
      const again = await store.appendEvents(a, [newEvent(a, rec.id, { idempotencyKey: key })]);
      assert.equal(again.error.code, 'event.duplicate_idempotency_key');
      const found = await store.findByIdempotencyKey(a, key);
      assert.equal(found.value.id, ev.id);
      assert.equal((await store.findByIdempotencyKey(a, uid('none'))).value, null);
    });

    test('the tenant wall holds on every read and write', async () => {
      const { store, a, b } = await setup();
      const rec = (await store.insertCommitment(a, newRecord(a))).value;
      assert.equal((await store.getCommitment(b, rec.id)).value, null);
      assert.equal((await store.listCommitments(b)).value.some((r) => r.id === rec.id), false);
      assert.deepEqual((await store.eventsFor(b, [rec.id])).value, []);
      assert.equal((await store.insertCommitment(b, newRecord(a))).error.code, 'tenant.mismatch');
      assert.equal((await store.appendEvents(b, [newEvent(a, rec.id)])).error.code, 'tenant.mismatch');
    });

    test('a parent must exist in the same organization', async () => {
      const { store, a } = await setup();
      const orphan = await store.insertCommitment(a, newRecord(a, { parentId: uid('missing') }));
      assert.equal(orphan.error.code, 'commitment.parent_not_found');
      const parent = (await store.insertCommitment(a, newRecord(a))).value;
      const child = await store.insertCommitment(a, newRecord(a, { parentId: parent.id }));
      assert.equal(child.ok, true, JSON.stringify(child.error));
    });

    test('lists filter by parent and by origin', async () => {
      const { store, a } = await setup();
      const ref = `helm:decision-commitment:${uid('d')}`;
      const origin = { kind: 'DECISION', system: 'helm', ref, label: 'Filter', fingerprint: null, snapshot: null };
      const parent = (await store.insertCommitment(a, newRecord(a, { origin }))).value;
      const child = (await store.insertCommitment(a, newRecord(a, { origin, parentId: parent.id }))).value;
      assert.deepEqual((await store.listCommitments(a, { originRef: ref })).value.map((r) => r.id).sort(), [parent.id, child.id].sort());
      assert.deepEqual((await store.listCommitments(a, { parentId: parent.id })).value.map((r) => r.id), [child.id]);
      assert.ok((await store.listCommitments(a, { parentId: null })).value.some((r) => r.id === parent.id));
    });

    test('a second writer in the same organization extends the same history', async () => {
      const { store, a, a2 } = await setup();
      const rec = (await store.insertCommitment(a, newRecord(a))).value;
      assert.equal((await store.appendEvents(a2, [newEvent(a2, rec.id)])).ok, true);
      const all = (await store.eventsFor(a, [rec.id])).value;
      assert.equal(all[0].actor.id, a2.actor.id);
    });
  });
}

export function newCandidate(scope, over = {}) {
  const id = uid('cnd');
  return {
    id,
    orgId: scope.orgId,
    source: { kind: 'MEETING_NOTES', system: 'notes', ref: `notes:${id}`, label: 'Logistics review', quote: 'I will have the units re-released by 24 October.', locator: 'line 4', observedAt: '2026-10-16T08:00:00.000Z', entityRef: null },
    utteranceClass: 'COMMITMENT',
    proposal: { statement: 'Re-release the held units', intendedOutcome: null, owner: null, ownerText: 'Quang', principal: null, dueBy: '2026-10-24', dueText: 'by 24 October', dependencies: [], entities: [], evidence: [] },
    confidence: 0.82,
    epistemic: 'INFERENCE',
    extractor: { name: 'test-extractor', model: null },
    suggestedBy: scope.actor,
    suggestedAt: '2026-10-16T08:05:00.000Z',
    dedupeKey: `notes:${id}#q`,
    fingerprint: fingerprint('cnd', { id }),
    ...over,
  };
}

export function candidateConformance(name, setup) {
  describe(`${name} — candidate store conformance`, () => {
    test('a candidate round-trips, stamped by the store, and is read once per source sentence', async () => {
      const { candidates, a } = await setup();
      const c = newCandidate(a);
      const written = await candidates.insertCandidates(a, [c]);
      assert.equal(written.ok, true, JSON.stringify(written.error));
      const { recordedAt, ...rest } = written.value[0];
      assert.deepEqual(rest, c);
      assert.match(recordedAt, /^\d{4}-/);
      const again = await candidates.insertCandidates(a, [{ ...newCandidate(a), dedupeKey: c.dedupeKey }]);
      assert.equal(again.error.code, 'candidate.duplicate');
    });

    test('one disposition per candidate, and the tenant wall holds', async () => {
      const { candidates, store, a, b } = await setup();
      const c = (await candidates.insertCandidates(a, [newCandidate(a)])).value[0];
      const rec = (await store.insertCommitment(a, newRecord(a))).value;
      const confirmed = await candidates.insertDisposition(a, { id: uid('dsp'), orgId: a.orgId, candidateId: c.id, kind: 'CONFIRMED', actor: a.actor, at: '2026-10-16T09:00:00.000Z', reason: null, commitmentId: rec.id, edited: ['intendedOutcome'] });
      assert.equal(confirmed.ok, true, JSON.stringify(confirmed.error));
      assert.deepEqual(confirmed.value.edited, ['intendedOutcome']);
      const twice = await candidates.insertDisposition(a, { id: uid('dsp'), orgId: a.orgId, candidateId: c.id, kind: 'DISMISSED', actor: a.actor, at: '2026-10-16T09:01:00.000Z', reason: 'Changed my mind', commitmentId: null, edited: [] });
      assert.equal(twice.error.code, 'candidate.already_disposed');
      assert.equal((await candidates.listCandidates(b)).value.some((x) => x.id === c.id), false);
      assert.equal((await candidates.listDispositions(b)).value.length, 0);
      assert.equal((await candidates.insertCandidates(b, [newCandidate(a)])).error.code, 'tenant.mismatch');
    });
  });
}
