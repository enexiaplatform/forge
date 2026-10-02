/**
 * The Postgres adapter, proven on Postgres.
 *
 * PGlite runs a real Postgres in-process. It applies the Supabase/Helm stub and
 * then the actual Forge migration from supabase/migrations, and the store runs
 * as authenticated users under row-level security — not as the owner — so the
 * conformance suite here exercises the policies, guards and grants that the
 * shared database will enforce. Every refusal below is matched by a legal
 * control that must succeed, so a harness that swallowed errors would fail.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createForgeRuntime, sequentialIds, unwrap } from '../src/index.ts';
import { createPostgresCandidateStore, createPostgresStore, createSqlTableClient } from '../src/postgres.ts';
import { candidateConformance, storeConformance, newEvent, newRecord } from './conformance.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const stub = readFileSync(new URL('./fixtures/supabase-and-helm-stub.sql', import.meta.url), 'utf8');
const migrations = readdirSync(`${root}supabase/migrations`).filter((f) => f.endsWith('.sql')).sort();

const U = {
  a: '00000000-0000-4000-8000-00000000000a',
  a2: '00000000-0000-4000-8000-0000000000a2',
  viewer: '00000000-0000-4000-8000-0000000000a3',
  b: '00000000-0000-4000-8000-00000000000b',
};
const ORG_A = '10000000-0000-4000-8000-00000000000a';
const ORG_B = '10000000-0000-4000-8000-00000000000b';

let db;
async function database() {
  if (db) return db;
  db = await PGlite.create();
  await db.exec(stub);
  for (const m of migrations) await db.exec(readFileSync(`${root}supabase/migrations/${m}`, 'utf8'));
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${U.a}'), ('${U.a2}'), ('${U.viewer}'), ('${U.b}');
    INSERT INTO public.organizations (id, name, created_by) VALUES ('${ORG_A}', 'Meridian VN', '${U.a}'), ('${ORG_B}', 'Other Co', '${U.b}');
    INSERT INTO public.organization_memberships (org_id, user_id, role) VALUES
      ('${ORG_A}', '${U.a}', 'manager'), ('${ORG_A}', '${U.a2}', 'member'), ('${ORG_A}', '${U.viewer}', 'viewer'), ('${ORG_B}', '${U.b}', 'member');
    INSERT INTO helm_private.stub_clearances (org_id, user_id, sensitivity) VALUES ('${ORG_A}', '${U.a}', 'FINANCIAL_SENSITIVE');
  `);
  return db;
}

/** Run every query as `role`, carrying `uid` as the JWT subject — how Supabase presents a signed-in user. */
function runnerAs(pg, role, uid) {
  return async (sql, params) => {
    await pg.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ''}', false); SET ROLE ${role};`);
    try {
      return await pg.query(sql, params);
    } finally {
      await pg.exec('RESET ROLE');
    }
  };
}

const person = (orgId, uid, label = uid) => ({ orgId, actor: { kind: 'PERSON', id: uid, label }, role: 'member', actsAs: [] });

storeConformance('Postgres (PGlite, as authenticated users under RLS)', async () => {
  const pg = await database();
  // One store per person: each writes as themselves, as a browser session would.
  const stores = {
    [U.a]: createPostgresStore(createSqlTableClient(runnerAs(pg, 'authenticated', U.a))),
    [U.a2]: createPostgresStore(createSqlTableClient(runnerAs(pg, 'authenticated', U.a2))),
    [U.b]: createPostgresStore(createSqlTableClient(runnerAs(pg, 'authenticated', U.b))),
  };
  const routed = {
    insertCommitment: (s, r) => stores[s.actor.id].insertCommitment(s, r),
    appendEvents: (s, e) => stores[s.actor.id].appendEvents(s, e),
    getCommitment: (s, id) => stores[s.actor.id].getCommitment(s, id),
    listCommitments: (s, f) => stores[s.actor.id].listCommitments(s, f),
    eventsFor: (s, ids) => stores[s.actor.id].eventsFor(s, ids),
    findByIdempotencyKey: (s, k) => stores[s.actor.id].findByIdempotencyKey(s, k),
  };
  return { store: routed, a: person(ORG_A, U.a), a2: person(ORG_A, U.a2), b: person(ORG_B, U.b) };
});

candidateConformance('Postgres (PGlite, as authenticated users under RLS)', async () => {
  const pg = await database();
  const table = (uid) => createSqlTableClient(runnerAs(pg, 'authenticated', uid));
  const commitments = { [U.a]: createPostgresStore(table(U.a)), [U.b]: createPostgresStore(table(U.b)) };
  const candidates = { [U.a]: createPostgresCandidateStore(table(U.a)), [U.b]: createPostgresCandidateStore(table(U.b)) };
  const route = (stores) => new Proxy({}, { get: (_t, method) => (s, ...args) => stores[s.actor.id][method](s, ...args) });
  return { store: route(commitments), candidates: route(candidates), a: person(ORG_A, U.a), b: person(ORG_B, U.b) };
});

describe('Postgres — what the database itself refuses', () => {
  let pg;
  const as = (role, uid) => (sql, params = []) => runnerAs(pg, role, uid)(sql, params);
  const storeAs = (uid) => createPostgresStore(createSqlTableClient(runnerAs(pg, 'authenticated', uid)));
  const refuses = async (fn, pattern) => {
    await assert.rejects(fn, (e) => {
      assert.match(String(e.message), pattern);
      return true;
    });
  };

  before(async () => {
    pg = await database();
  });

  test('another organization’s member reads none of it, even without a filter', async () => {
    const a = person(ORG_A, U.a);
    unwrap(await storeAs(U.a).insertCommitment(a, newRecord(a)));
    const seenByB = await as('authenticated', U.b)('SELECT count(*)::int AS n FROM public.forge_commitments');
    assert.equal(seenByB.rows[0].n, 0);
    const seenByA = await as('authenticated', U.a)('SELECT count(*)::int AS n FROM public.forge_commitments');
    assert.ok(seenByA.rows[0].n > 0, 'control: a member reads their own organization');
  });

  test('nobody writes in another person’s name', async () => {
    const a = person(ORG_A, U.a);
    const rec = unwrap(await storeAs(U.a).insertCommitment(a, newRecord(a)));
    const forged = await storeAs(U.a2).appendEvents(person(ORG_A, U.a2), [newEvent(person(ORG_A, U.a), rec.id)]);
    assert.equal(forged.ok, false);
    assert.equal(forged.error.code, 'store.refused');
    assert.match(forged.error.details.sqlstate, /42501/, 'refused by row-level security');
    const own = await storeAs(U.a2).appendEvents(person(ORG_A, U.a2), [newEvent(person(ORG_A, U.a2), rec.id)]);
    assert.equal(own.ok, true, 'control: writing as yourself is allowed');
  });

  test('a client cannot record a connector’s system event or an agent’s inference', async () => {
    const a = person(ORG_A, U.a);
    const rec = unwrap(await storeAs(U.a).insertCommitment(a, newRecord(a)));
    const evidence = (channel, epistemic, confidence) => newEvent(a, rec.id, {
      type: 'EVIDENCE_RECORDED',
      payload: { evidence: { id: 'e1', requirementKey: 'received', stance: 'SUPPORTS', epistemic, channel, source: { system: 'scm', ref: 'TR-1', url: null }, statement: 's', observedAt: '2026-10-01T00:00:00.000Z', confidence, observationId: null } },
    });
    const systemEvent = await storeAs(U.a).appendEvents(a, [evidence('SYSTEM_EVENT', 'FACT', null)]);
    assert.match(systemEvent.error.message, /forge_events_evidence_channel_actor/);
    const factWithConfidence = await storeAs(U.a).appendEvents(a, [evidence('HUMAN_CONFIRMATION', 'FACT', 0.9)]);
    assert.match(factWithConfidence.error.message, /forge_events_evidence_epistemics/);
    const confirmation = await storeAs(U.a).appendEvents(a, [evidence('HUMAN_CONFIRMATION', 'FACT', null)]);
    assert.equal(confirmation.ok, true, 'control: a person’s confirmation is recordable');
  });

  test('a viewer cannot propose; anon cannot read', async () => {
    const v = person(ORG_A, U.viewer);
    const r = await storeAs(U.viewer).insertCommitment(v, newRecord(v));
    assert.equal(r.ok, false);
    await refuses(() => as('anon', null)('SELECT 1 FROM public.forge_commitments'), /permission denied/);
  });

  test('history cannot be rewritten — not by a client, not by the service role, not by the owner', async () => {
    const a = person(ORG_A, U.a);
    const rec = unwrap(await storeAs(U.a).insertCommitment(a, newRecord(a)));
    unwrap(await storeAs(U.a).appendEvents(a, [newEvent(a, rec.id)]));
    await refuses(() => as('authenticated', U.a)(`UPDATE public.forge_commitment_events SET reason = 'x' WHERE commitment_id = $1`, [rec.id]), /permission denied/);
    await refuses(() => as('authenticated', U.a)(`DELETE FROM public.forge_commitments WHERE id = $1`, [rec.id]), /permission denied/);
    await refuses(() => as('service_role', null)(`UPDATE public.forge_commitment_events SET reason = 'x' WHERE commitment_id = $1`, [rec.id]), /forge\.append_only/);
    await refuses(() => pg.query(`DELETE FROM public.forge_commitments WHERE id = $1`, [rec.id]), /forge\.append_only/);
  });

  test('observations are the connectors’ to write and nobody’s to rewrite', async () => {
    const insert = `INSERT INTO public.forge_observations (org_id, source_system, id, event_type, object_ref, occurred_at, summary)
      VALUES ($1, 'scm', $2, 'stock_transfer.received', 'TR-0412', '2026-10-06T06:30:00Z', '8 units received')`;
    const id = `scm-${Date.now()}`;
    await refuses(() => as('authenticated', U.a)(insert, [ORG_A, id]), /permission denied/);
    await as('service_role', null)(insert, [ORG_A, id]);
    const seen = await as('authenticated', U.a)('SELECT count(*)::int AS n FROM public.forge_observations WHERE id = $1', [id]);
    assert.equal(seen.rows[0].n, 1, 'control: members read what connectors recorded');
    await refuses(() => as('service_role', null)('DELETE FROM public.forge_observations WHERE id = $1', [id]), /forge\.append_only/);
    await refuses(() => as('service_role', null)(insert, [ORG_A, id]), /duplicate key/);
  });

  test('record time and sequence are the database’s, whatever the client sends', async () => {
    const a = person(ORG_A, U.a);
    const rec = unwrap(await storeAs(U.a).insertCommitment(a, newRecord(a)));
    const r = await as('authenticated', U.a)(
      `INSERT INTO public.forge_commitment_events (id, org_id, commitment_id, seq, event_type, effective_at, recorded_at, actor, payload)
       VALUES ($1, $2, $3, 99, 'ACCEPTED', '2026-09-26T00:00:00Z', '1999-01-01T00:00:00Z', $4, '{}') RETURNING seq, recorded_at`,
      [`evt_backdated_${Date.now()}`, ORG_A, rec.id, JSON.stringify({ kind: 'PERSON', id: U.a, label: 'a' })],
    );
    assert.equal(r.rows[0].seq, 1);
    assert.ok(new Date(r.rows[0].recorded_at).getUTCFullYear() > 2000);
  });

  test('the schema keeps the reasons: a close without one is refused even for the service role', async () => {
    const a = person(ORG_A, U.a);
    const rec = unwrap(await storeAs(U.a).insertCommitment(a, newRecord(a)));
    const svc = createPostgresStore(createSqlTableClient(runnerAs(pg, 'service_role', null)));
    const closeWithout = await svc.appendEvents(a, [newEvent(a, rec.id, { type: 'CLOSED', reason: ' ', payload: { resolution: 'FULFILLED', supersededBy: null, confirmedWithoutEvidence: false, requestId: null } })]);
    assert.match(closeWithout.error.message, /forge_events_reason_required/);
    const closeWith = await svc.appendEvents(a, [newEvent(a, rec.id, { type: 'CLOSED', reason: 'Received in full.', payload: { resolution: 'FULFILLED', supersededBy: null, confirmedWithoutEvidence: false, requestId: null } })]);
    assert.equal(closeWith.ok, true, 'control');
  });
});

describe('the runtime on Postgres — people and a connector, each as themselves', () => {
  test('propose, accept, observe and close across three writers; every reader derives the same commitment', async () => {
    const pg = await database();
    const clock = { now: () => new Date().toISOString() };
    const ids = sequentialIds();
    const prefix = `pg${Date.now().toString(36)}`;
    const idGen = { next: (p) => `${prefix}_${ids.next(p)}` };
    const runtimeAs = (role, uid) => createForgeRuntime({ store: createPostgresStore(createSqlTableClient(runnerAs(pg, role, uid))), clock, ids: idGen });

    const GM = { kind: 'ROLE', label: 'Country GM Vietnam', ref: null };
    const SCM = { kind: 'ROLE', label: 'Supply Chain Director Vietnam', ref: null };
    const gm = { orgId: ORG_A, actor: { kind: 'PERSON', id: U.a, label: 'Linh Tran' }, role: 'manager', actsAs: [GM] };
    const scm = { orgId: ORG_A, actor: { kind: 'PERSON', id: U.a2, label: 'Minh Pham' }, role: 'member', actsAs: [SCM] };
    const connector = { orgId: ORG_A, actor: { kind: 'SYSTEM', id: 'scm-connector', label: 'scm connector' }, role: 'member', actsAs: [] };

    const asGm = runtimeAs('authenticated', U.a);
    const asScm = runtimeAs('authenticated', U.a2);
    const asConnector = runtimeAs('service_role', null);

    const proposed = unwrap(await asGm.propose(gm, {
      origin: { kind: 'DECISION', system: 'helm', ref: 'helm:decision-commitment:dcm-pg', label: 'PG decision', fingerprint: null, snapshot: null },
      terms: {
        statement: 'Transfer eight units to HCMC', intendedOutcome: 'Eight units in HCMC', why: 'Rohto', owner: SCM, principal: GM, dueBy: '2026-10-02',
        evidence: [{ key: 'received', level: 'OUTPUT', description: 'TR-0412 received', required: true, matcher: { system: 'scm', eventType: 'stock_transfer.received', objectRef: 'TR-0412', where: { quantity: 8 } } }],
        measures: [], value: [],
      },
    }));
    assert.equal((await asGm.accept(gm, proposed.record.id)).error.code, 'authority.refused');
    unwrap(await asScm.accept(scm, proposed.record.id));
    unwrap(await asConnector.recordEvidence(connector, proposed.record.id, {
      requirementKey: 'received', stance: 'SUPPORTS', epistemic: 'FACT', channel: 'SYSTEM_EVENT', source: { system: 'scm', ref: 'TR-0412', url: null },
      statement: '8 units received', observedAt: '2026-10-06T06:30:00.000Z', confidence: null, observationId: 'scm-9188',
    }, { idempotencyKey: `${prefix}:scm-9188` }));
    const closed = unwrap(await asScm.close(scm, proposed.record.id, { resolution: 'FULFILLED' }, 'Received in full.'));
    assert.equal(closed.applied, true);

    const byGm = unwrap(await asGm.view(gm, proposed.record.id));
    const byScm = unwrap(await asScm.view(scm, proposed.record.id));
    assert.equal(byGm.phase, 'CLOSED');
    assert.equal(byGm.requirements[0].basis, 'SYSTEM');
    assert.deepEqual(byGm.history.map((h) => h.type), ['PROPOSED', 'ACCEPTED', 'EVIDENCE_RECORDED', 'CLOSED']);
    assert.deepEqual(byGm.history, byScm.history, 'two readers, one truth');
  });
});
