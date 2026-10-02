import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryCandidateStore, createInMemoryStore, createLedgerCache, manualClock } from '../src/index.ts';
import { candidateConformance, storeConformance } from './conformance.mjs';

const scope = (orgId, id, clearances = []) => ({ orgId, actor: { kind: 'PERSON', id, label: id }, role: 'member', actsAs: [], clearances });

const setup = async () => {
  const clock = manualClock('2026-09-25T09:00:00.000Z');
  return {
    store: createInMemoryStore(clock),
    candidates: createInMemoryCandidateStore(clock),
    a: scope('org-a', 'user-a', ['FINANCIAL_SENSITIVE']),
    a2: scope('org-a', 'user-a2'),
    b: scope('org-b', 'user-b'),
  };
};

storeConformance('in-memory', setup);
candidateConformance('in-memory', setup);

// A warm reader answers exactly as a cold one (development plan 2.4).
storeConformance('in-memory, read through a ledger cache', async () => {
  const s = await setup();
  return { ...s, store: createLedgerCache(s.store) };
});

test('a ledger cache catches a write that lands with an older record time, within its overlap', async () => {
  const clock = manualClock('2026-10-01T10:00:00.000Z');
  const inner = createInMemoryStore(clock);
  const reader = scope('org-a', 'user-a');
  const record = (id) => ({
    id, orgId: 'org-a', parentId: null, origin: { kind: 'DIRECT', system: 'forge', ref: null, label: 'SYNTHETIC', fingerprint: null, snapshot: null },
    terms: { statement: id, intendedOutcome: 'x', why: 'x', owner: { kind: 'ROLE', label: 'O', ref: null }, principal: { kind: 'ROLE', label: 'P', ref: null }, dueBy: '2026-12-31', evidence: [], measures: [], value: [] },
    capture: {}, context: [], proposedBy: reader.actor, proposedAt: '2026-10-01T10:00:00.000Z', fingerprint: 'cfp_0000000000000000',
  });
  await inner.insertCommitment(reader, record('c1'));
  const warm = createLedgerCache(inner, { overlapMs: 60_000 });
  const cold = createLedgerCache(inner, { overlapMs: 0 });
  assert.equal((await warm.listCommitments(reader)).value.length, 1);
  assert.equal((await cold.listCommitments(reader)).value.length, 1);
  // A transaction that began 30 seconds earlier commits now: its record time is older than what both have read.
  clock.set('2026-10-01T09:59:30.000Z');
  await inner.insertCommitment(reader, record('c2'));
  assert.deepEqual((await warm.listCommitments(reader)).value.map((r) => r.id), ['c2', 'c1'], 'caught within the overlap, in recorded order');
  assert.equal((await cold.listCommitments(reader)).value.length, 1, 'without an overlap it would have been missed');
  cold.forget(reader);
  assert.equal((await cold.listCommitments(reader)).value.length, 2, 'forgetting reads whole again');
});
