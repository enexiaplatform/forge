/**
 * The observation ledger on Postgres (ADR-0027): Forge's real migrations on PGlite, written as the service role (a
 * surface's connector), read by members under Helm's clearance. Kept once; never written by a client.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { unwrap } from '@forge/kernel';
import { createSqlTableClient } from '@forge/kernel/postgres';
import { createInMemoryObservationLedger, createTableObservationLedger } from '@forge/fabric';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ORG = '10000000-0000-4000-8000-0000000000c1';
const CLEARED = '00000000-0000-4000-8000-0000000000c1';
const MEMBER = '00000000-0000-4000-8000-0000000000c2';
let pg;

const runnerAs = (role, uid) => async (sql, params) => {
  await pg.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ''}', false); SET ROLE ${role};`);
  try {
    return await pg.query(sql, params);
  } finally {
    await pg.exec('RESET ROLE');
  }
};
const scope = { orgId: ORG, actor: { kind: 'SYSTEM', id: 'erp-connector', label: 'erp connector' }, role: 'member', actsAs: [] };
const obs = (id, over = {}) => ({ id, system: 'erp', eventType: 'shipment.posted', objectRef: `SH-${id}`, entityRef: null, occurredAt: `2026-09-2${id.length % 9}T02:00:00.000Z`, payload: { quantity: 12 }, summary: `Shipment ${id}`, url: null, ...over });

before(async () => {
  pg = await PGlite.create();
  await pg.exec(readFileSync(`${root}packages/kernel/test/fixtures/supabase-and-helm-stub.sql`, 'utf8'));
  for (const m of readdirSync(`${root}supabase/migrations`).filter((f) => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(`${root}supabase/migrations/${m}`, 'utf8'));
  await pg.exec(`
    INSERT INTO auth.users (id) VALUES ('${CLEARED}'), ('${MEMBER}');
    INSERT INTO public.organizations (id, name, created_by) VALUES ('${ORG}', 'Synthetic', '${CLEARED}');
    INSERT INTO public.organization_memberships (org_id, user_id, role) VALUES ('${ORG}', '${CLEARED}', 'member'), ('${ORG}', '${MEMBER}', 'member');
    INSERT INTO helm_private.stub_clearances (org_id, user_id, sensitivity) VALUES ('${ORG}', '${CLEARED}', 'FINANCIAL_SENSITIVE');`);
});

for (const [name, make] of [
  ['in memory', () => createInMemoryObservationLedger()],
  ['on Postgres, as the service role', () => createTableObservationLedger(createSqlTableClient(runnerAs('service_role', null)))],
]) {
  test(`${name}: an observation is kept once, and listed oldest first`, async () => {
    const ledger = make();
    const tag = `${name.length}${Date.now().toString(36)}`;
    const first = unwrap(await ledger.record(scope, [obs(`${tag}-a`), obs(`${tag}-bb`)]));
    assert.equal(first.fresh.length, 2);
    const again = unwrap(await ledger.record(scope, [obs(`${tag}-a`), obs(`${tag}-ccc`)]));
    assert.deepEqual(again.fresh.map((o) => o.id), [`${tag}-ccc`]);
    assert.equal(again.duplicates, 1);
    const listed = unwrap(await ledger.list(scope, { system: 'erp' })).filter((o) => o.id.startsWith(tag));
    assert.equal(listed.length, 3);
    for (let i = 1; i < listed.length; i += 1) assert.ok(listed[i - 1].occurredAt <= listed[i].occurredAt);
    assert.deepEqual(listed.find((o) => o.id === `${tag}-a`).payload, { quantity: 12 });
  });
}

test('on Postgres: no client writes the ledger, and a protected fact is read only under Helm’s clearance', async () => {
  const asMember = createTableObservationLedger(createSqlTableClient(runnerAs('authenticated', MEMBER)));
  const refused = await asMember.record(scope, [obs('client-wrote-this')]);
  assert.equal(refused.ok, false, 'a client cannot report a system’s record');
  const service = createTableObservationLedger(createSqlTableClient(runnerAs('service_role', null)));
  unwrap(await service.record(scope, [obs('margin-1', { summary: 'Posted at 31.4% margin', protection: ['FINANCIAL_SENSITIVE'] }), obs('plain-1')]));
  const seenBy = async (uid) => unwrap(await createTableObservationLedger(createSqlTableClient(runnerAs('authenticated', uid))).list(scope, { system: 'erp' })).map((o) => o.id);
  assert.ok((await seenBy(CLEARED)).includes('margin-1'));
  assert.ok(!(await seenBy(MEMBER)).includes('margin-1'), 'read whole or not at all');
  assert.ok((await seenBy(MEMBER)).includes('plain-1'));
  const back = unwrap(await createTableObservationLedger(createSqlTableClient(runnerAs('authenticated', CLEARED))).list(scope, { system: 'erp' })).find((o) => o.id === 'margin-1');
  assert.deepEqual(back.protection, ['FINANCIAL_SENSITIVE']);
});
