/**
 * forge.observation.v1 (ADR-0027): a surface Forge has no connector for reports its own records, signed; Forge keeps
 * each once and lets them prove what commitments said would prove them. Every refusal is matched by a delivery that
 * succeeds, so a host that refused everything would fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createForgeRuntime, createInMemoryStore, manualClock, sequentialIds, unwrap } from '../../packages/kernel/src/index.ts';
import { createInMemoryObservationLedger, OBSERVATION_CONTRACT } from '../../packages/fabric/src/index.ts';
import { handleObservationDelivery } from '../surfaces/observationHost.ts';

const ORG = 'org-synthetic';
const NOW = 1_790_000_000; // 2026-09-21T…
const SECRETS = { erp: 'erp-secret-0123456789abcdef0123456789', tracker: 'tracker-secret-0123456789abcdef01234567' };
const GM = { kind: 'ROLE', label: 'Country GM (SYNTHETIC)', ref: null };
const SCM = { kind: 'ROLE', label: 'Supply Chain Director (SYNTHETIC)', ref: null };
const gm = { orgId: ORG, actor: { kind: 'PERSON', id: 'u-gm', label: 'GM' }, role: 'manager', actsAs: [GM], clearances: 'ALL' };
const scm = { orgId: ORG, actor: { kind: 'PERSON', id: 'u-scm', label: 'SCM' }, role: 'member', actsAs: [SCM], clearances: [] };

async function world(runtimeOverride) {
  const clock = manualClock('2026-09-20T09:00:00.000Z');
  const runtime = createForgeRuntime({ store: createInMemoryStore(clock), clock, ids: sequentialIds() });
  const v = unwrap(await runtime.propose(gm, {
    origin: { kind: 'DIRECT', system: 'forge', ref: null, label: 'SYNTHETIC', fingerprint: null, snapshot: null },
    terms: {
      statement: 'Ship the Rohto order (SYNTHETIC)', intendedOutcome: 'Rohto has twelve units.', why: 'SYNTHETIC', owner: SCM, principal: GM, dueBy: '2026-10-24',
      evidence: [{ key: 'shipped', level: 'OUTPUT', description: 'The ERP posts the shipment', required: true, matcher: { system: 'erp', eventType: 'shipment.posted', objectRef: 'SH-0042', where: { quantity: 12 } } }],
      measures: [], value: [],
    },
  }));
  unwrap(await runtime.accept(scm, v.record.id));
  const ledger = createInMemoryObservationLedger();
  const deps = { secretFor: (s) => SECRETS[s] ?? null, ledger, runtime: runtimeOverride ?? runtime, orgId: ORG, nowSeconds: () => NOW };
  return { runtime, ledger, deps, id: v.record.id };
}

const shipment = (over = {}) => ({ id: 'erp-evt-1', eventType: 'shipment.posted', objectRef: 'SH-0042', occurredAt: '2026-09-21T02:00:00.000Z', summary: 'Shipment SH-0042 posted, 12 units', payload: { quantity: 12 }, ...over });
const batch = (observations, system = 'erp') => JSON.stringify({ contract: OBSERVATION_CONTRACT, system, observations });
const signed = (body, surface = 'erp', secret = SECRETS[surface], ts = String(NOW)) => ({
  headers: { 'Forge-Surface': surface, 'Forge-Timestamp': ts, 'Forge-Signature': `v1=${createHmac('sha256', secret ?? 'x'.repeat(32)).update(`${ts}.${body}`).digest('hex')}` },
  rawBody: body,
});

test('a signed shipment from an ERP Forge has no connector for proves the commitment that named it — once', async () => {
  const { runtime, deps, id } = await world();
  const res = await handleObservationDelivery(deps, signed(batch([shipment()])));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.received, 1);
  assert.deepEqual(res.body.effects.map((e) => e.kind), ['EVIDENCE_SUPPORTS']);
  const v = unwrap(await runtime.view(gm, id));
  assert.equal(v.requirements[0].status, 'EVIDENCED');
  assert.equal(v.evidence[0].item.source.system, 'erp');
  const again = await handleObservationDelivery(deps, signed(batch([shipment()])));
  assert.equal(again.body.received, 0);
  assert.equal(again.body.alreadyHeld, 1);
  assert.equal(unwrap(await runtime.view(gm, id)).evidence.length, 1, 're-delivery changes nothing');
});

test('an observation nothing waits for is kept on the ledger, attached to nothing', async () => {
  const { deps, ledger } = await world();
  const res = await handleObservationDelivery(deps, signed(batch([shipment({ id: 'erp-evt-9', objectRef: 'SH-0999' })])));
  assert.equal(res.body.unmatched, 1);
  assert.equal(unwrap(await ledger.list(gm, { system: 'erp' })).length, 1);
});

test('who may speak: an unknown surface, a wrong secret or a stale timestamp is 401; another system’s records or a reserved one is 403', async () => {
  const { deps } = await world();
  const body = batch([shipment()]);
  assert.equal((await handleObservationDelivery(deps, signed(body, 'jira'))).status, 401);
  assert.equal((await handleObservationDelivery(deps, signed(body, 'erp', SECRETS.tracker))).status, 401);
  assert.equal((await handleObservationDelivery(deps, signed(body, 'erp', SECRETS.erp, String(NOW - 600)))).status, 401);
  const asTracker = await handleObservationDelivery(deps, signed(body, 'tracker'));
  assert.equal(asTracker.status, 403);
  assert.equal(asTracker.body.error.code, 'observation.not_your_system');
  const memoire = batch([shipment()], 'memoire');
  const reserved = await handleObservationDelivery({ ...deps, secretFor: () => SECRETS.erp }, signed(memoire, 'memoire', SECRETS.erp));
  assert.equal(reserved.status, 403);
  assert.equal(reserved.body.error.code, 'observation.reserved_system');
});

test('a malformed batch is refused whole, and says what to fix; too many in one batch is 413', async () => {
  const { deps, ledger } = await world();
  const bad = batch([shipment(), shipment({ id: '', eventType: 'Shipment Posted', payload: { nested: { a: 1 } }, occurredAt: '2027-01-01T00:00:00.000Z' })]);
  const res = await handleObservationDelivery(deps, signed(bad));
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /observation 2 needs an id/);
  assert.match(res.body.error.message, /eventType/);
  assert.match(res.body.error.message, /nothing nested/);
  assert.match(res.body.error.message, /in the future/);
  assert.equal(unwrap(await ledger.list(gm)).length, 0, 'not even the good one is kept');
  const many = batch(Array.from({ length: 501 }, (_, i) => shipment({ id: `e-${i}` })));
  assert.equal((await handleObservationDelivery(deps, signed(many))).status, 413);
});

test('a delivery Forge could not finish is 503, and the retry finishes it rather than skipping it as already held', async () => {
  const { runtime, deps, id } = await world();
  const failing = { ...runtime, list: async () => ({ ok: false, error: { code: 'store.unavailable', message: 'The database is not answering.' } }) };
  const first = await handleObservationDelivery({ ...deps, runtime: failing }, signed(batch([shipment()])));
  assert.equal(first.status, 503);
  const retry = await handleObservationDelivery(deps, signed(batch([shipment()])));
  assert.equal(retry.status, 200);
  assert.equal(retry.body.alreadyHeld, 1);
  assert.equal(unwrap(await runtime.view(gm, id)).requirements[0].status, 'EVIDENCED');
});

test('a class the source gives a fact travels with it into the evidence, and is withheld from an uncleared reader', async () => {
  const { runtime, deps, id } = await world();
  const res = await handleObservationDelivery(deps, signed(batch([shipment({ summary: 'Shipment SH-0042 posted at 31.4% margin', protection: ['FINANCIAL_SENSITIVE'] })])));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(unwrap(await runtime.view(gm, id)).evidence[0].item.protection, ['FINANCIAL_SENSITIVE']);
  assert.doesNotMatch(unwrap(await runtime.view(scm, id)).evidence[0].item.statement, /31\.4/);
});
