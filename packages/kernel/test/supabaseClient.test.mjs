/**
 * The supabase-js path at organization scale (development plan 2.4). Hosted PostgREST answers at most `max_rows`
 * rows per request and says nothing when it cuts; a URL holds only so many ids. A fake PostgREST with both limits
 * shows the Postgres store reads a whole ledger anyway — every commitment, every event — in slices and pages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresStore, createSupabaseTableClient } from '../src/postgres.ts';

const MAX_ROWS = 400; // fewer than the client asks for, as a project may configure
const MAX_IN = 200; // ids per request before the URL is too long

/** Just enough PostgREST: filters, order, limit, range, a row cap and a URL limit. */
function fakePostgrest(tables) {
  let requests = 0;
  const from = (table) => ({
    select() {
      const filters = [];
      const orders = [];
      let limit = Infinity;
      let range = null;
      const q = {
        eq: (c, v) => (filters.push((r) => r[c] === v), q),
        is: (c) => (filters.push((r) => r[c] === null), q),
        in: (c, vs) => {
          if (vs.length > MAX_IN) throw new Error(`URI too long: ${vs.length} ids`);
          const set = new Set(vs);
          filters.push((r) => set.has(r[c]));
          return q;
        },
        gt: (c, v) => (filters.push((r) => r[c] > v), q),
        lte: (c, v) => (filters.push((r) => r[c] <= v), q),
        order: (c, { ascending }) => (orders.push([c, ascending]), q),
        limit: (n) => ((limit = n), q),
        range: (a, b) => ((range = [a, b]), q),
        then(resolve) {
          requests += 1;
          let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          rows.sort((a, b) => {
            for (const [c, asc] of orders) if (a[c] !== b[c]) return (a[c] < b[c] ? -1 : 1) * (asc ? 1 : -1);
            return 0;
          });
          if (range) rows = rows.slice(range[0], range[1] + 1);
          rows = rows.slice(0, Math.min(limit, MAX_ROWS));
          resolve({ data: rows, error: null });
        },
      };
      return q;
    },
    insert() {
      throw new Error('read-only fake');
    },
  });
  return { client: { from }, requests: () => requests };
}

const ORG = '10000000-0000-4000-8000-00000000000a';
const scope = { orgId: ORG, actor: { kind: 'PERSON', id: 'u1', label: 'Reader (SYNTHETIC)' }, role: 'member', actsAs: [] };
const iso = (i) => new Date(Date.parse('2026-10-01T00:00:00.000Z') + i * 1000).toISOString();

function seed(commitments, eventsEach) {
  const forge_commitments = [];
  const forge_commitment_events = [];
  for (let i = 0; i < commitments; i += 1) {
    const id = `cmt-${String(i).padStart(5, '0')}`;
    forge_commitments.push({
      id, org_id: ORG, parent_id: null, origin_kind: 'DIRECT', origin_system: 'forge', origin_ref: null,
      origin: { kind: 'DIRECT', system: 'forge', ref: null, label: 'SYNTHETIC', fingerprint: null, snapshot: null },
      terms: { statement: `Promise ${i}`, intendedOutcome: 'x', why: 'x', owner: { kind: 'ROLE', label: 'Owner', ref: null }, principal: { kind: 'ROLE', label: 'GM', ref: null }, dueBy: '2026-12-31', evidence: [], measures: [], value: [] },
      capture: {}, context: [], proposed_by: scope.actor, proposed_at: iso(i), recorded_at: iso(i), fingerprint: `cfp_${String(i).padStart(16, '0')}`,
    });
    for (let k = 1; k <= eventsEach; k += 1) {
      forge_commitment_events.push({
        id: `evt-${i}-${k}`, org_id: ORG, commitment_id: id, seq: k, event_type: 'ACTIVITY_OBSERVED', effective_at: iso(i * 100 + k), recorded_at: iso(i * 100 + k),
        actor: { kind: 'SYSTEM', id: 'scm', label: 'scm' }, reason: null, authority: null, idempotency_key: null,
        payload: { linkId: 'l', done: k, total: eventsEach, unit: 'issues', observationId: null }, protection: [], text_protection: [],
      });
    }
  }
  return { forge_commitments, forge_commitment_events, forge_sealed_values: [] };
}

test('a ledger larger than one response and one URL is read whole: every commitment, every event, in order', async () => {
  const fake = fakePostgrest(seed(1_050, 3));
  const store = createPostgresStore(createSupabaseTableClient(fake.client));
  const recs = await store.listCommitments(scope);
  assert.equal(recs.ok, true, JSON.stringify(recs.error));
  assert.equal(recs.value.length, 1_050, 'not cut at max_rows');
  const evs = await store.eventsFor(scope, recs.value.map((r) => r.id));
  assert.equal(evs.ok, true, JSON.stringify(evs.error));
  assert.equal(evs.value.length, 3_150, 'not cut at max_rows, and no URL too long');
  for (let i = 1; i < evs.value.length; i += 1) assert.ok(evs.value[i - 1].recordedAt <= evs.value[i].recordedAt, 'recorded order across slices');
  const one = evs.value.filter((e) => e.commitmentId === 'cmt-00700');
  assert.deepEqual(one.map((e) => e.seq), [1, 2, 3]);
});

test('a lookup by key asks once and does not page', async () => {
  const fake = fakePostgrest(seed(5, 1));
  const store = createPostgresStore(createSupabaseTableClient(fake.client));
  const before = fake.requests();
  const rec = await store.getCommitment(scope, 'cmt-00003');
  assert.equal(rec.value.id, 'cmt-00003');
  assert.equal(fake.requests() - before, 1);
});
