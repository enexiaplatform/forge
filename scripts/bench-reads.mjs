#!/usr/bin/env node
/**
 * bench:reads — how Forge's reads behave at organization scale (development plan 2.4).
 *
 * SYNTHETIC: one organization with N commitments (default 10 000) under 200 decisions, each commitment carrying
 * about twenty events — accepted, linked, activity observed, evidence, some closed with a reason and a lesson. Written
 * straight into the in-memory store (the runtime's own writes are proven elsewhere), then read the way the console
 * reads: the ledger (every commitment), conditions and asks, one commitment, one trace, and the ledger again after a
 * write. Prints a table; nothing is asserted — the numbers go in docs/product/development-plan.md.
 *
 *   node scripts/bench-reads.mjs [commitments=10000] [--postgres] [--cached]
 *
 * With --postgres the same ledger is written into PGlite (Forge's real migrations over the Supabase/Helm stub) by the
 * database owner, and read by a signed-in member under row-level security through the Postgres store. With --cached
 * the reader reads through a ledger cache (`createLedgerCache`): the first reading reads whole, later ones catch up.
 */
import { performance } from 'node:perf_hooks';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createForgeRuntime, createInMemoryStore, createLedgerCache, latestAt } from '../packages/kernel/src/index.ts';
import { createPostgresStore, createSqlTableClient } from '../packages/kernel/src/postgres.ts';

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 10_000);
const POSTGRES = process.argv.includes('--postgres');
const CACHED = process.argv.includes('--cached');
const ORG = POSTGRES ? '10000000-0000-4000-8000-00000000000a' : 'org-synthetic';
const USER = '00000000-0000-4000-8000-00000000000a';
let t = Date.parse('2026-01-01T00:00:00.000Z');
const clock = { now: () => new Date((t += 1000)).toISOString() };
let n = 0;
const ids = { next: (p) => `${p}-${(n += 1).toString(36)}` };
let backdate = async () => {};
async function postgresStores() {
  const { PGlite } = await import('@electric-sql/pglite');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const pg = await PGlite.create();
  await pg.exec(readFileSync(`${root}packages/kernel/test/fixtures/supabase-and-helm-stub.sql`, 'utf8'));
  for (const m of readdirSync(`${root}supabase/migrations`).filter((f) => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(`${root}supabase/migrations/${m}`, 'utf8'));
  await pg.exec(`
    INSERT INTO auth.users (id) VALUES ('${USER}');
    INSERT INTO public.organizations (id, name, created_by) VALUES ('${ORG}', 'Synthetic', '${USER}');
    INSERT INTO public.organization_memberships (org_id, user_id, role) VALUES ('${ORG}', '${USER}', 'admin');`);
  const owner = async (sql, params) => pg.query(sql, params);
  const member = async (sql, params) => {
    await pg.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${USER}', false); SET ROLE authenticated;`);
    try {
      return await pg.query(sql, params);
    } finally {
      await pg.exec('RESET ROLE');
    }
  };
  backdate = () => pg.exec(`
    ALTER TABLE public.forge_commitment_events DISABLE TRIGGER USER; ALTER TABLE public.forge_commitments DISABLE TRIGGER USER;
    UPDATE public.forge_commitments SET recorded_at = recorded_at - (${N} - split_part(id, '-', 3)::int) * interval '1 minute';
    UPDATE public.forge_commitment_events SET recorded_at = recorded_at - (${N} - split_part(commitment_id, '-', 3)::int) * interval '1 minute';
    ALTER TABLE public.forge_commitment_events ENABLE TRIGGER USER; ALTER TABLE public.forge_commitments ENABLE TRIGGER USER;`);
  return { writeStore: createPostgresStore(createSqlTableClient(owner)), readStore: createPostgresStore(createSqlTableClient(member)) };
}
const memory = createInMemoryStore(clock);
const { writeStore: store, readStore } = POSTGRES ? await postgresStores() : { writeStore: memory, readStore: memory };
const runtime = createForgeRuntime({ store: CACHED ? createLedgerCache(readStore) : readStore, clock, ids });

const party = (label) => ({ kind: 'ROLE', label, ref: null });
const owners = Array.from({ length: 50 }, (_, i) => party(`Owner ${i + 1} (SYNTHETIC)`));
const gm = party('Country GM (SYNTHETIC)');
const writer = { orgId: ORG, actor: { kind: 'PERSON', id: USER, label: 'GM (SYNTHETIC)' }, role: 'admin', actsAs: [gm], clearances: 'ALL' };
const reader = { orgId: ORG, actor: { kind: 'PERSON', id: USER, label: 'Owner 1 (SYNTHETIC)' }, role: 'member', actsAs: [owners[0]] };
const connector = { kind: 'SYSTEM', id: 'scm-connector', label: 'scm connector' };

const terms = (i) => ({
  statement: `Deliver synthetic outcome ${i}`,
  intendedOutcome: `Outcome ${i} is in place`,
  why: 'A Helm decision (SYNTHETIC).',
  owner: owners[i % owners.length],
  principal: gm,
  dueBy: '2026-12-31',
  evidence: [{ key: 'done', level: 'OUTPUT', description: 'The system records it done', required: true, matcher: { system: 'scm', eventType: 'done', objectRef: `obj-${i}`, where: {} } }],
  measures: [],
  value: [],
});

console.log(`bench:reads — writing ${N.toLocaleString('en')} SYNTHETIC commitments ${POSTGRES ? 'into PGlite, read under RLS' : 'in memory'}${CACHED ? ', read through a ledger cache' : ''}…`);
let events = 0;
const write0 = performance.now();
for (let i = 0; i < N; i += 1) {
  const parentId = i % 5 === 0 ? null : `cmt-s-${i - (i % 5)}`;
  const rec = {
    id: `cmt-s-${i}`, orgId: ORG, parentId,
    // DIRECT, so the Postgres run needs no Helm decisions behind it; the tree and the reads are the same.
    origin: { kind: 'DIRECT', system: 'forge', ref: null, label: `Decision ${i % 200} (SYNTHETIC)`, fingerprint: null, snapshot: null },
    terms: terms(i), capture: Object.fromEntries(['statement', 'intendedOutcome', 'why', 'owner', 'principal', 'dueBy', 'evidence', 'measures', 'value'].map((f) => [f, 'INHERITED'])), context: [], proposedBy: writer.actor, proposedAt: clock.now(), fingerprint: `cfp_${i.toString(16).padStart(16, '0')}`,
  };
  const inserted = await store.insertCommitment(writer, rec);
  if (!inserted.ok) throw new Error(inserted.error.message);
  const ev = (type, payload, extra = {}) => ({ id: ids.next('evt'), orgId: ORG, commitmentId: rec.id, type, effectiveAt: clock.now(), actor: writer.actor, reason: null, authority: null, idempotencyKey: null, payload, ...extra });
  const batch = [
    ev('ACCEPTED', { party: rec.terms.owner, confirmed: [], evidence: null }),
    ev('EXECUTION_LINKED', { link: { id: `lnk-${i}`, system: 'tracker', kind: 'EPIC', ref: `EP-${i}`, label: `EP-${i}`, url: null } }),
  ];
  for (let k = 1; k <= 15; k += 1) batch.push(ev('ACTIVITY_OBSERVED', { linkId: `lnk-${i}`, done: k, total: 15, unit: 'issues', observationId: null }, { actor: connector }));
  batch.push(ev('EVIDENCE_RECORDED', { evidence: { id: `evd-${i}`, requirementKey: 'done', stance: 'SUPPORTS', epistemic: 'FACT', channel: 'SYSTEM_EVENT', source: { system: 'scm', ref: `obj-${i}`, url: null }, statement: 'Recorded done (SYNTHETIC)', observedAt: clock.now(), confidence: null, observationId: null } }, { actor: connector }));
  if (i % 3 === 0) {
    batch.push(ev('CLOSED', { resolution: 'FULFILLED', supersededBy: null, confirmedWithoutEvidence: false, requestId: null }, { reason: 'Delivered (SYNTHETIC).' }));
    batch.push(ev('LEARNING_RECORDED', { learning: { id: `lrn-${i}`, kind: 'LESSON', statement: 'Book the slot early (SYNTHETIC).', appliesTo: null } }));
  }
  const appended = await store.appendEvents(writer, batch);
  if (!appended.ok) throw new Error(appended.error.message);
  events += batch.length;
}
console.log(`  ${N.toLocaleString('en')} commitments, ${events.toLocaleString('en')} events, written in ${((performance.now() - write0) / 1000).toFixed(1)} s`);
if (POSTGRES) {
  // The database stamped everything in the last few seconds; a real ledger is recorded over months. Spread this
  // SYNTHETIC history back, a minute per commitment (as the owner, guards lifted for the move only), so a catch-up's
  // overlap window holds what it would in life — the last few minutes — not the whole ledger.
  await backdate();
  console.log(`  (PGlite: SYNTHETIC history spread over the last ${N.toLocaleString('en')} minutes, as if recorded over time)`);
}
console.log('');

async function time(label, fn, runs = 4) {
  const ms = [];
  let out;
  for (let r = 0; r < runs; r += 1) {
    const s = performance.now();
    out = await fn();
    ms.push(performance.now() - s);
    if (out && out.ok === false) throw new Error(`${label}: ${out.error.message}`);
  }
  const rest = ms.slice(1).sort((a, b) => a - b);
  console.log(`  ${label.padEnd(44)} first ${fmt(ms[0])}${rest.length ? `  then ${fmt(rest[Math.floor(rest.length / 2)])}` : ''}`);
  return out;
}
const fmt = (x) => `${x.toFixed(0).padStart(7)} ms`;

const lens = () => latestAt(clock.now());
const one = `cmt-s-${Math.floor(N / 2) - (Math.floor(N / 2) % 5)}`;
await time('the ledger — every commitment (list)', () => runtime.list(writer, { lens: lens() }));
await time('conditions across the organization', () => runtime.conditions(writer, lens()));
await time('asks for one owner', () => runtime.asks(reader, lens()));
await time('one commitment (view)', () => runtime.view(writer, one));
await time('one trace (root and its tree)', () => runtime.trace(writer, one, lens()));
const wrote = await createForgeRuntime({ store, clock, ids }).recordLearning(writer, one, { kind: 'LESSON', statement: 'One more lesson (SYNTHETIC).', appliesTo: null });
if (!wrote.ok) throw new Error(wrote.error.message);
await time('the ledger again, after one write', () => runtime.list(writer, { lens: lens() }), 1);
