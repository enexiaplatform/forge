/**
 * Loop 2 — MEMOIRE commercial reality → FORGE observation.
 *
 * Memoire runs as itself (see support/memoire.mjs): its migrations, its
 * Commercial API v1 handler under its own row-level security, its SDK, its
 * revision triggers, its delivery queue RPCs and its webhook worker. Forge reads
 * promises through the SDK as their owner, promotes the ones that look like
 * enterprise obligations to CANDIDATES (inference, never commitments), and a
 * person confirms one into a commitment that LINKS to the promise. When Memoire
 * records the promise kept, Memoire's worker signs a change notification; Forge
 * verifies it, reads what changed through the API, and records system evidence.
 * A cancelled promise changes the world an obligation rests on, and its
 * principal is asked.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createForgeRuntime, createInMemoryCandidateStore, createInMemoryStore, sequentialIds, unwrap } from '@forge/kernel';
import {
  connectorScope,
  createInMemoryInbox,
  interpretNotification,
  listAllPromises,
  memoireCommitmentRef,
  promotionCandidates,
  receiveMemoireNotification,
} from '@forge/fabric';
import { postgrestClient } from './support/postgrest.mjs';
import { runnerAs } from './support/database.mjs';
import { memoireCommercialApi, memoireDatabase, memoireUser, runMemoireWebhookWorker } from './support/memoire.mjs';
import { fromSibling, MEMOIRE, memoireSkip } from './support/siblings.mjs';
import { handleMemoireWebhook } from '../server/memoire/webhookHost.ts';

const ORG = '10000000-0000-4000-8000-0000000000aa';
const OWNER = '50000000-0000-4000-8000-0000000000c1'; // the Commercial Director's Memoire account
const OTHER_OWNER = '50000000-0000-4000-8000-0000000000c2';
const TOKEN = 'access-token-commercial-director';
const OTHER_TOKEN = 'access-token-someone-else';
const SECRET = 'forge-memoire-webhook-secret-0123456789abcdef';
const clock = { now: () => new Date().toISOString() };
const role = (label) => ({ kind: 'ROLE', label, ref: null });
const GM = { orgId: ORG, actor: { kind: 'PERSON', id: 'u-gm', label: 'Country GM' }, role: 'admin', actsAs: [role('Country GM Vietnam')] };
const CD = { orgId: ORG, actor: { kind: 'PERSON', id: 'u-cd', label: 'Lan Nguyen' }, role: 'member', actsAs: [role('Commercial Director Vietnam')] };
const FINANCE = { orgId: ORG, actor: { kind: 'PERSON', id: 'u-fd', label: 'Minh Tran' }, role: 'member', actsAs: [role('Finance Director Vietnam')] };
const DIRECTORY = [
  { matches: 'Lan Nguyen', party: role('Commercial Director Vietnam') },
  { matches: 'Minh Tran', party: role('Finance Director Vietnam') },
];

describe('Loop 2 — Memoire’s commercial reality becomes Forge observation, through Memoire’s own API and webhooks', { skip: memoireSkip }, () => {
  let mdb;
  let api; // the SDK client, as the owner
  let codec;
  let forge;
  const inbox = createInMemoryInbox();
  const deliveries = [];
  const interpreted = [];
  const P = {};
  let since;

  const ownerRest = (uid) => postgrestClient(runnerAs(mdb, 'authenticated', uid));
  const writePromise = async (uid, fields) => {
    const record = codec.sanitize({ ...fields, createdAt: clock.now(), updatedAt: clock.now() });
    const { error } = await ownerRest(uid).from('commercial_commitments').insert(codec.toRow(record, uid));
    assert.equal(error, null, error?.message);
    return record.id;
  };
  const changePromise = async (uid, id, patch) => {
    const { data, error } = await ownerRest(uid).from('commercial_commitments').select('*').eq('user_id', uid).eq('id', id).single();
    assert.equal(error, null, error?.message);
    const record = codec.sanitize({ ...codec.fromRow(data), ...patch, updatedAt: clock.now() });
    const row = codec.toRow(record, uid);
    const update = await ownerRest(uid).from('commercial_commitments').update({ status: row.status, completed_at: row.completed_at, cancelled_at: row.cancelled_at, completion_evidence: row.completion_evidence, updated_at: row.updated_at }).eq('user_id', uid).eq('id', id);
    assert.equal(update.error, null, update.error?.message);
  };

  /** Forge's receiving endpoint, as Memoire's worker reaches it: the host Forge deploys (server/memoire/webhookHost.ts). */
  const forgeEndpoint = async (_url, rawBody, headers) => {
    deliveries.push({ rawBody, headers });
    const res = await handleMemoireWebhook(
      { secret: SECRET, inbox, api, runtime: forge, orgId: ORG, nowSeconds: () => Math.floor(Date.now() / 1000) },
      { headers, rawBody },
    );
    if (res.status === 200 && res.body.duplicate === false) {
      interpreted.push({ notification: JSON.parse(rawBody), observations: Array.from({ length: res.body.observations }), uninterpreted: res.body.uninterpreted });
    }
    return res.status;
  };

  before(async () => {
    mdb = await memoireDatabase();
    await memoireUser(mdb, OWNER);
    await memoireUser(mdb, OTHER_OWNER);
    ({ commitmentCodec: codec } = await fromSibling(MEMOIRE, 'src/services/commercialKernel/commitmentStore.ts'));
    const memoire = await memoireCommercialApi(mdb, new Map([[TOKEN, OWNER], [OTHER_TOKEN, OTHER_OWNER]]));
    api = memoire.clientFor(TOKEN);
    since = new Date(Date.now() - 1000).toISOString();

    P.delivery = await writePromise(OWNER, { id: 'cmt-rohto-delivery', accountId: 'acct-rohto', accountName: 'Rohto Vietnam', opportunityId: 'opp-rohto-q4', commitmentParty: 'self', ownerLabel: 'Lan Nguyen', commitmentText: 'Deliver all twelve analyzers to Rohto HCMC', currentDueDate: '2026-10-24', impactType: 'delivery' });
    P.siteReady = await writePromise(OWNER, { id: 'cmt-rohto-site', accountId: 'acct-rohto', accountName: 'Rohto Vietnam', commitmentParty: 'customer', ownerLabel: 'Rohto procurement', commitmentText: 'Rohto confirms the HCMC site is ready for installation', currentDueDate: '2026-10-20' });
    P.schedule = await writePromise(OWNER, { id: 'cmt-rohto-schedule', accountId: 'acct-rohto', accountName: 'Rohto Vietnam', commitmentParty: 'self', ownerLabel: 'Lan Nguyen', commitmentText: 'Send Rohto the revised service schedule' });
    P.credit = await writePromise(OWNER, { id: 'cmt-distributor-credit', accountId: 'acct-distributor-d', accountName: 'Distributor D', commitmentParty: 'internal', ownerLabel: 'Minh Tran', commitmentText: 'Release the consignment credit note to Distributor D', currentDueDate: '2026-10-10' });
    P.elsewhere = await writePromise(OTHER_OWNER, { id: 'cmt-elsewhere', commitmentParty: 'self', ownerLabel: 'Someone else', commitmentText: 'A promise in another person’s Memoire', currentDueDate: '2026-11-01' });

    const ids = sequentialIds();
    forge = createForgeRuntime({ store: createInMemoryStore(clock), candidates: createInMemoryCandidateStore(clock), clock, ids });
  });

  test('Forge reads promises through Memoire’s own SDK and API, as their owner, following every cursor', async () => {
    const promises = await listAllPromises(api, 2);
    assert.deepEqual(promises.map((p) => p.id).sort(), [P.credit, P.delivery, P.schedule, P.siteReady].sort());
    assert.equal(promises.find((p) => p.id === P.delivery).dueDate, '2026-10-24');
    const theirs = await listAllPromises((await memoireCommercialApi(mdb, new Map([[OTHER_TOKEN, OTHER_OWNER]]))).clientFor(OTHER_TOKEN));
    assert.deepEqual(theirs.map((p) => p.id), [P.elsewhere], 'Memoire’s row-level security, not Forge, keeps owners apart');
    const stranger = (await memoireCommercialApi(mdb, new Map())).clientFor('not-a-token');
    await assert.rejects(() => listAllPromises(stranger), (e) => e.code === 'unauthorized');
  });

  describe('promotion: a candidate, then a person', () => {
    let deliveryCommitment;
    let creditCommitment;

    before(async () => {
      const candidates = promotionCandidates(await listAllPromises(api), DIRECTORY);
      unwrap(await forge.suggestCandidates(connectorScope(ORG, 'memoire'), candidates));
    });

    test('only what the enterprise owes, with a named person and a date, is proposed — and only as inference', async () => {
      const pending = unwrap(await forge.listCandidates(GM));
      assert.deepEqual(pending.map((c) => c.record.source.ref).sort(), [memoireCommitmentRef(P.credit), memoireCommitmentRef(P.delivery)].sort());
      for (const c of pending) {
        assert.equal(c.state, 'PENDING');
        assert.equal(c.record.epistemic, 'INFERENCE');
      }
      assert.equal(unwrap(await forge.list(GM)).length, 0, 'nothing became a commitment by being read');
    });

    test('a connector cannot confirm; a person can, and the commitment links to the promise rather than copying it', async () => {
      const pending = unwrap(await forge.listCandidates(GM));
      const candidateFor = (id) => pending.find((c) => c.record.source.ref === memoireCommitmentRef(id));
      const termsFrom = (c, outcome, why) => ({
        statement: c.record.proposal.statement,
        intendedOutcome: outcome,
        why,
        owner: c.record.proposal.owner,
        principal: role('Country GM Vietnam'),
        dueBy: c.record.proposal.dueBy,
        evidence: c.record.proposal.evidence,
        measures: [],
        value: [],
      });
      const refused = await forge.confirmCandidate(connectorScope(ORG, 'memoire'), candidateFor(P.delivery).record.id, { terms: termsFrom(candidateFor(P.delivery), 'x', 'y') });
      assert.equal(refused.ok, false);

      const confirmed = unwrap(await forge.confirmCandidate(GM, candidateFor(P.delivery).record.id, {
        terms: termsFrom(candidateFor(P.delivery), 'Rohto has all twelve analyzers installed in HCMC.', 'Rohto’s Q4 order was promised in Memoire and the decision to reallocate stock depends on it.'),
      }));
      deliveryCommitment = confirmed.commitment;
      assert.equal(deliveryCommitment.record.origin.kind, 'OBLIGATION');
      assert.equal(deliveryCommitment.record.origin.ref, memoireCommitmentRef(P.delivery));
      assert.equal(deliveryCommitment.capture.dueBy, 'INHERITED');
      assert.equal(deliveryCommitment.terms.owner.label, 'Commercial Director Vietnam');
      unwrap(await forge.accept(CD, deliveryCommitment.record.id));

      creditCommitment = unwrap(await forge.confirmCandidate(GM, candidateFor(P.credit).record.id, {
        terms: termsFrom(candidateFor(P.credit), 'Distributor D holds the credit note for the recalled units.', 'The reallocation recalled Distributor D’s consignment stock.'),
      })).commitment;
      unwrap(await forge.accept(FINANCE, creditCommitment.record.id));
    });

    describe('Memoire records what happened; its worker tells Forge', () => {
      let run;

      before(async () => {
        await changePromise(OWNER, P.delivery, { status: 'completed', completedAt: clock.now(), completionEvidence: 'Signed delivery note, HCMC' });
        await changePromise(OWNER, P.credit, { status: 'cancelled', cancelledAt: clock.now() });
        await changePromise(OTHER_OWNER, P.elsewhere, { status: 'completed', completedAt: clock.now() });
        run = await runMemoireWebhookWorker(mdb, { ownerId: OWNER, secret: SECRET, since, deliver: forgeEndpoint });
      });

      test('Memoire signs each change; Forge verifies every one and acknowledges it', () => {
        assert.ok(run.attempted >= 6, `four creates and two changes were announced (got ${run.attempted})`);
        assert.equal(run.acknowledged, run.attempted);
        assert.ok(deliveries.every((d) => /^v1=[a-f0-9]{64}$/.test(d.headers['Memoire-Signature'])));
        assert.ok(interpreted.every((i) => i.notification.subject.id !== P.elsewhere), 'another owner’s changes are not announced to this endpoint');
      });

      test('the promise kept in Memoire is system evidence on the commitment that links to it', async () => {
        const v = unwrap(await forge.view(GM, deliveryCommitment.record.id));
        const kept = v.requirements.find((r) => r.requirement.key === 'memoire-promise-kept');
        assert.equal(kept.status, 'EVIDENCED');
        assert.equal(kept.basis, 'SYSTEM');
        assert.equal(v.evidence.at(-1).actor.kind, 'SYSTEM');
        assert.match(v.evidence.at(-1).item.statement, /completed/);
      });

      test('a cancelled promise changes the world the obligation rests on, and its principal is asked', async () => {
        const v = unwrap(await forge.view(GM, creditCommitment.record.id));
        assert.equal(v.contextChanges.length, 1);
        const asks = unwrap(await forge.asks(GM)).filter((c) => c.commitmentId === creditCommitment.record.id);
        assert.ok(asks.some((c) => c.code === 'CONTEXT_CHANGED'), 'the GM is asked whether it still holds');
      });

      test('a promise the customer owes stays context: no candidate, no commitment', async () => {
        const all = unwrap(await forge.list(GM));
        assert.ok(all.every((v) => v.record.origin.ref !== memoireCommitmentRef(P.siteReady)));
      });

      test('a tampered body, a stale timestamp, a wrong secret and a mismatched id are refused; a replay is recognized', async () => {
        const { webhookSignature } = await fromSibling(MEMOIRE, 'api/_webhooks.js');
        const sample = deliveries.find((d) => JSON.parse(d.rawBody).subject.id === P.delivery);
        const now = Math.floor(Date.now() / 1000);
        const receive = (headers, rawBody, secret = SECRET) => receiveMemoireNotification({ headers, rawBody, secret, nowSeconds: now, inbox });

        const tampered = sample.rawBody.replace('"update"', '"delete"').replace('"create"', '"delete"');
        assert.equal((await receive(sample.headers, tampered)).error?.code, 'memoire.signature_invalid');
        const stale = String(now - 600);
        assert.equal((await receive({ ...sample.headers, 'Memoire-Timestamp': stale, 'Memoire-Signature': webhookSignature(SECRET, stale, sample.rawBody) }, sample.rawBody)).error?.code, 'memoire.signature_invalid');
        assert.equal((await receive(sample.headers, sample.rawBody, 'another-secret-entirely-0123456789abcdef')).error?.code, 'memoire.signature_invalid');
        assert.equal((await receive({ ...sample.headers, 'Memoire-Notification-Id': 'memoire.change.v1:00000000-0000-4000-8000-000000000000' }, sample.rawBody)).error?.code, 'memoire.notification_invalid');
        const replay = unwrap(await receive(sample.headers, sample.rawBody));
        assert.equal(replay.duplicate, true);
      });

      test('a subject Commercial API v1 cannot read is acknowledged and left uninterpreted, said so', async () => {
        const { webhookSignature } = await fromSibling(MEMOIRE, 'api/_webhooks.js');
        const body = JSON.stringify({ version: 1, id: 'memoire.change.v1:6b0f2c1e-8a8e-4b0a-9a51-3f1d2a9c0001', type: 'commercial.state.changed', recordedAt: clock.now(), subject: { kind: 'shared-workspace', id: 'ws-1', revision: 1 }, operation: 'create' });
        const ts = String(Math.floor(Date.now() / 1000));
        const received = unwrap(await receiveMemoireNotification({
          headers: { 'Memoire-Notification-Id': 'memoire.change.v1:6b0f2c1e-8a8e-4b0a-9a51-3f1d2a9c0001', 'Memoire-Timestamp': ts, 'Memoire-Signature': webhookSignature(SECRET, ts, body) },
          rawBody: body, secret: SECRET, nowSeconds: Number(ts), inbox,
        }));
        const read = await interpretNotification(api, received.notification);
        assert.equal(read.observations.length, 0);
        assert.match(read.uninterpreted, /shared-workspace/);
      });
    });
  });
});
