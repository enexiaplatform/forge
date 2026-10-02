/**
 * Forge's Memoire webhook host (server/memoire/webhookHost.ts): what each request gets back, and what Memoire's
 * worker does with it. The integration suite runs it behind Memoire's own worker; this pins the statuses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createForgeRuntime, createInMemoryStore, manualClock, sequentialIds } from '../../packages/kernel/src/index.ts';
import { createFixtureCommercialApi, createInMemoryInbox } from '../../packages/fabric/src/index.ts';
import { handleMemoireWebhook } from '../memoire/webhookHost.ts';

const SECRET = 'synthetic-webhook-secret-0123456789abcdef';
const ORG = 'org-synthetic';
const NOW = 1_790_000_000;
const sign = (ts, body, secret = SECRET) => `v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;

function host(over = {}) {
  const clock = manualClock('2026-10-02T09:00:00.000Z');
  const runtime = createForgeRuntime({ store: createInMemoryStore(clock), clock, ids: sequentialIds() });
  const api = createFixtureCommercialApi(
    [{ id: 'cmt-1', accountId: 'acct-1', opportunityId: null, party: 'self', responsiblePerson: 'Lan Nguyen (SYNTHETIC)', promise: 'Deliver twelve analyzers (SYNTHETIC)', dueDate: '2026-10-24', status: 'completed', updatedAt: '2026-10-01T00:00:00.000Z' }],
    () => clock.now(),
  );
  return { secret: SECRET, inbox: createInMemoryInbox(), api, runtime, orgId: ORG, nowSeconds: () => NOW, ...over };
}

const notification = (id, kind = 'commitment', subject = 'cmt-1') =>
  JSON.stringify({ version: 1, id, type: 'commercial.state.changed', recordedAt: '2026-10-02T08:59:00.000Z', subject: { kind, id: subject, revision: 2 }, operation: 'update' });
const request = (body, id, ts = String(NOW), secret = SECRET) => ({ headers: { 'Memoire-Notification-Id': id, 'Memoire-Timestamp': ts, 'Memoire-Signature': sign(ts, body, secret) }, rawBody: body });

test('a signed notification is read through Commercial API v1 and recorded; a replay is recognized, not re-read', async () => {
  const deps = host();
  const id = 'memoire.change.v1:6b0f2c1e-8a8e-4b0a-9a51-3f1d2a9c0101';
  const body = notification(id);
  const first = await handleMemoireWebhook(deps, request(body, id));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.observations, 1);
  const again = await handleMemoireWebhook(deps, request(body, id));
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
});

test('a wrong secret or a stale timestamp is 401 — Memoire does not retry a body that will never verify', async () => {
  const id = 'memoire.change.v1:6b0f2c1e-8a8e-4b0a-9a51-3f1d2a9c0102';
  const body = notification(id);
  assert.equal((await handleMemoireWebhook(host(), request(body, id, String(NOW), 'another-secret-entirely-0123456789abcdef'))).status, 401);
  assert.equal((await handleMemoireWebhook(host(), request(body, id, String(NOW - 600)))).status, 401);
});

test('a signed but mismatched envelope is 400; a subject Commercial API v1 cannot read is acknowledged and said so', async () => {
  const id = 'memoire.change.v1:6b0f2c1e-8a8e-4b0a-9a51-3f1d2a9c0103';
  const body = notification(id);
  const mismatched = { ...request(body, id), headers: { ...request(body, id).headers, 'Memoire-Notification-Id': 'memoire.change.v1:00000000-0000-4000-8000-000000000000' } };
  assert.equal((await handleMemoireWebhook(host(), mismatched)).status, 400);
  const wsId = 'memoire.change.v1:6b0f2c1e-8a8e-4b0a-9a51-3f1d2a9c0104';
  const ws = await handleMemoireWebhook(host(), request(notification(wsId, 'shared-workspace', 'ws-1'), wsId));
  assert.equal(ws.status, 200);
  assert.match(ws.body.uninterpreted, /shared-workspace/);
});

test('when Forge cannot record what it read, it answers 503 so Memoire retries', async () => {
  const deps = host();
  const failing = { ...deps.runtime, list: async () => ({ ok: false, error: { code: 'store.unavailable', message: 'The database is not answering.' } }) };
  const id = 'memoire.change.v1:6b0f2c1e-8a8e-4b0a-9a51-3f1d2a9c0105';
  const res = await handleMemoireWebhook({ ...deps, runtime: failing }, request(notification(id), id));
  assert.equal(res.status, 503);
});
