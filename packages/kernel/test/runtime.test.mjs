import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lensAt, unwrap } from '../src/index.ts';
import {
  FIN, GM, SCM, agent, connector, fin, gm, helmOrigin, outsider, party, proposedTransfer, scm, setup, systemFact, transferTerms,
} from './helpers.mjs';

describe('proposing and accepting — ownership is not assignment', () => {
  test('a proposed commitment binds nobody and asks its owner, not its proposer', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    assert.equal(v.phase, 'PROPOSED');
    assert.equal(v.capture.statement, 'INHERITED');
    assert.equal(v.capture.owner, 'MANUAL', 'anything not stated was typed by a person');
    const asks = unwrap(await env.runtime.asks(scm));
    assert.equal(asks.length, 1);
    assert.equal(asks[0].code, 'AWAITING_ACCEPTANCE');
    assert.match(asks[0].ask.question, /Forge inferred what proves it/);
    assert.deepEqual(unwrap(await env.runtime.asks(gm)), [], 'the principal is not asked to accept for the owner');
  });

  test('only the owner can accept, and accepting confirms what Forge inferred', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    const refused = await env.runtime.accept(gm, v.record.id);
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, 'authority.refused');
    const accepted = unwrap(await env.runtime.accept(scm, v.record.id));
    assert.equal(accepted.phase, 'ACTIVE');
    assert.equal(accepted.capture.evidence, 'CONFIRMED');
    assert.equal(accepted.history.at(-1).authority.rule, 'owner-accepts');
  });

  test('changing the inferred evidence while accepting records it as the owner’s own entry', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    const evidence = [{ key: 'goods-in', level: 'OUTPUT', description: 'Goods-in note signed at HCMC', required: true, matcher: null }];
    const accepted = unwrap(await env.runtime.accept(scm, v.record.id, { evidence }));
    assert.equal(accepted.capture.evidence, 'MANUAL');
    assert.equal(accepted.terms.evidence[0].key, 'goods-in');
  });

  test('a commitment cannot be accepted until something says what proves it', async () => {
    const env = setup();
    const v = unwrap(await env.runtime.propose(gm, { origin: helmOrigin, terms: transferTerms({ evidence: [] }) }));
    const r = await env.runtime.accept(scm, v.record.id);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'commitment.evidence_required');
  });

  test('declining needs a reason and puts the question back to the principal', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    assert.equal((await env.runtime.decline(scm, v.record.id, '  ')).ok, false);
    unwrap(await env.runtime.decline(scm, v.record.id, 'The consignment agreement needs ten days, not five.'));
    const asks = unwrap(await env.runtime.asks(gm));
    assert.equal(asks[0].code, 'DECLINED');
    assert.equal(asks[0].severity, 'CANNOT_WAIT');
  });

  test('handing a commitment over sends it back for the new owner to accept', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    const r = unwrap(await env.runtime.change(gm, v.record.id, { kind: 'REASSIGN', owner: FIN }, 'Finance holds the consignment contract.'));
    assert.equal(r.applied, true);
    assert.equal(r.view.phase, 'PROPOSED');
    assert.equal(r.view.acceptance, null);
    assert.equal(r.view.reassignments.length, 1);
  });
});

describe('changing a promise needs the party it was made to', () => {
  test('an owner’s redate waits for the principal, and the original date is never lost', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    env.clock.set('2026-10-01T08:00:00.000Z');
    const asked = unwrap(await env.runtime.change(scm, v.record.id, { kind: 'REDATE', dueBy: '2026-10-06' }, 'Distributor D released late.'));
    assert.equal(asked.applied, false);
    assert.equal(asked.view.terms.dueBy, '2026-10-02');
    const gmAsks = unwrap(await env.runtime.asks(gm));
    assert.equal(gmAsks[0].code, 'CHANGE_AWAITING_DECISION');

    assert.equal((await env.runtime.decideChange(scm, v.record.id, asked.requestId, 'APPROVED', null)).ok, false, 'the requester cannot approve their own change');
    const approved = unwrap(await env.runtime.decideChange(gm, v.record.id, asked.requestId, 'APPROVED', 'The Rohto date still holds with a 6 Oct arrival.'));
    assert.equal(approved.terms.dueBy, '2026-10-06');
    assert.equal(approved.originalDueBy, '2026-10-02');
    assert.equal(approved.redates[0].reason, 'Distributor D released late.');
    const applied = approved.history.at(-1);
    assert.equal(applied.type, 'TERMS_CHANGED');
    assert.equal(applied.authority.approvalRequestId, asked.requestId);
  });

  test('a rejection needs a reason; the terms stay as promised', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    const asked = unwrap(await env.runtime.change(scm, v.record.id, { kind: 'REDATE', dueBy: '2026-10-20' }, 'Busy.'));
    assert.equal((await env.runtime.decideChange(gm, v.record.id, asked.requestId, 'REJECTED', '')).ok, false);
    const rejected = unwrap(await env.runtime.decideChange(gm, v.record.id, asked.requestId, 'REJECTED', 'Rohto’s date is firm.'));
    assert.equal(rejected.terms.dueBy, '2026-10-02');
    assert.equal(rejected.changeRequests[0].decided.decision, 'REJECTED');
  });

  test('someone outside the commitment cannot ask to change it', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    const r = await env.runtime.change(outsider, v.record.id, { kind: 'REDATE', dueBy: '2026-10-09' }, 'Because.');
    assert.equal(r.error.code, 'authority.refused');
  });
});

describe('evidence over status reporting', () => {
  test('a system record proves a requirement; a person’s word is shown as only that', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    const after = unwrap(await env.runtime.recordEvidence(connector('scm'), v.record.id, systemFact('transfer-received', 'TR-0412', '8 units received at HCMC', '2026-10-06T07:00:00.000Z')));
    assert.equal(after.requirements[0].status, 'EVIDENCED');
    assert.equal(after.requirements[0].basis, 'SYSTEM');
    assert.equal(unwrap(await env.runtime.asks(scm))[0].code, 'EVIDENCE_COMPLETE');
  });

  test('facts that disagree are a conflict a person settles by disputing one — which stays on the record', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    unwrap(await env.runtime.recordEvidence(connector('scm'), v.record.id, systemFact('transfer-received', 'TR-0412', '8 units received', '2026-10-06T07:00:00.000Z')));
    const conflicted = unwrap(await env.runtime.recordEvidence(connector('wms'), v.record.id,
      systemFact('transfer-received', 'GRN-88', 'Goods-in note shows 6 units', '2026-10-06T08:00:00.000Z', 'CONTRADICTS', 'wms')));
    assert.equal(conflicted.requirements[0].status, 'CONFLICTED');
    const asks = unwrap(await env.runtime.asks(scm));
    assert.equal(asks[0].code, 'EVIDENCE_CONFLICT');
    assert.match(asks[0].statement.text, /the scm record supports it, the wms record contradicts it/);

    const closing = await env.runtime.close(scm, v.record.id, { resolution: 'FULFILLED', confirmedWithoutEvidence: true }, 'Done.');
    assert.equal(closing.error.code, 'commitment.evidence_disputed', 'a conflict cannot be confirmed away');

    const wrong = conflicted.evidence.find((e) => e.item.source.system === 'wms').item.id;
    const settled = unwrap(await env.runtime.disputeEvidence(scm, v.record.id, wrong, 'GRN-88 was a partial scan; the recount is 8.'));
    assert.equal(settled.requirements[0].status, 'EVIDENCED');
    assert.equal(settled.evidence.length, 2, 'disputed evidence is kept, not deleted');
  });

  test('a later record of the same object from the same system replaces the earlier one', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    unwrap(await env.runtime.recordEvidence(connector('scm'), v.record.id,
      systemFact('transfer-received', 'TR-0412', '6 of 8 units received', '2026-10-05T07:00:00.000Z', 'CONTRADICTS')));
    const later = unwrap(await env.runtime.recordEvidence(connector('scm'), v.record.id,
      systemFact('transfer-received', 'TR-0412', '8 of 8 units received', '2026-10-06T07:00:00.000Z')));
    assert.equal(later.requirements[0].status, 'EVIDENCED');
    assert.ok(later.evidence.find((e) => e.item.statement.startsWith('6 of 8')).supersededBy);
  });

  test('closing as fulfilled without evidence needs the owner to say so, and the record shows it', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    const refused = await env.runtime.close(scm, v.record.id, { resolution: 'FULFILLED' }, 'Done.');
    assert.equal(refused.error.code, 'commitment.evidence_missing');
    const closed = unwrap(await env.runtime.close(scm, v.record.id, { resolution: 'FULFILLED', confirmedWithoutEvidence: true }, 'Counted the units myself.'));
    assert.equal(closed.view.resolution.confirmedWithoutEvidence, true);
  });
});

describe('epistemic and authority boundaries for agents and connectors', () => {
  test('an agent may infer, never accept, close or approve', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    assert.equal((await env.runtime.accept(agent, v.record.id)).error.code, 'authority.refused');
    unwrap(await env.runtime.accept(scm, v.record.id));
    const inferred = unwrap(await env.runtime.recordEvidence(agent, v.record.id, {
      requirementKey: 'transfer-received', stance: 'SUPPORTS', epistemic: 'INFERENCE', channel: 'INFERENCE',
      source: { system: 'forge', ref: null, url: null }, statement: 'The carrier marked the truck delivered.', observedAt: '2026-10-06T06:00:00.000Z',
      confidence: 0.6, observationId: null,
    }));
    assert.equal(inferred.requirements[0].status, 'INFERRED', 'an inference never satisfies a requirement');
    assert.equal(unwrap(await env.runtime.asks(scm))[0].code, 'INFERENCE_UNCONFIRMED');
    assert.equal((await env.runtime.close(agent, v.record.id, { resolution: 'FULFILLED', confirmedWithoutEvidence: true }, 'x')).error.code, 'authority.refused');
  });

  test('a person cannot file an inference, and a connector cannot file a confirmation', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    const personInference = await env.runtime.recordEvidence(scm, v.record.id, {
      requirementKey: null, stance: 'CONTEXT', epistemic: 'INFERENCE', channel: 'INFERENCE', source: { system: 'manual', ref: null, url: null },
      statement: 'Probably fine', observedAt: '2026-10-01T00:00:00.000Z', confidence: 0.5, observationId: null,
    });
    assert.equal(personInference.error.code, 'authority.refused');
    const systemConfirmation = await env.runtime.recordEvidence(connector('scm'), v.record.id, {
      requirementKey: null, stance: 'CONTEXT', epistemic: 'FACT', channel: 'HUMAN_CONFIRMATION', source: { system: 'scm', ref: 'x', url: null },
      statement: 'Confirmed', observedAt: '2026-10-01T00:00:00.000Z', confidence: null, observationId: null,
    });
    assert.equal(systemConfirmation.error.code, 'authority.refused');
  });

  test('a fact never carries a confidence score; an inference always does', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    const r = await env.runtime.recordEvidence(connector('scm'), v.record.id, { ...systemFact(null, 'TR-0412', 'x', '2026-10-01T00:00:00.000Z', 'CONTEXT'), confidence: 0.9 });
    assert.equal(r.error.code, 'evidence.fact_with_confidence');
  });
});

describe('time — a reading reproduces what was known', () => {
  test('a lens before an event does not see it', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    env.clock.set('2026-09-26T10:00:00.000Z');
    unwrap(await env.runtime.accept(scm, v.record.id));
    const before = unwrap(await env.runtime.view(gm, v.record.id, lensAt('2026-09-25T12:00:00.000Z')));
    const after = unwrap(await env.runtime.view(gm, v.record.id, lensAt('2026-09-26T12:00:00.000Z')));
    assert.equal(before.phase, 'PROPOSED');
    assert.equal(after.phase, 'ACTIVE');
    const notYet = await env.runtime.view(gm, v.record.id, lensAt('2026-09-24T00:00:00.000Z'));
    assert.equal(notYet.error.code, 'commitment.not_known_at_lens');
  });

  test('past due is judged at the lens, not today', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    const onTime = unwrap(await env.runtime.conditions(gm, lensAt('2026-10-02T23:00:00.000Z')));
    const late = unwrap(await env.runtime.conditions(gm, lensAt('2026-10-04T09:00:00.000Z')));
    assert.ok(!onTime.some((c) => c.code === 'PAST_DUE'));
    const pastDue = late.find((c) => c.code === 'PAST_DUE');
    assert.match(pastDue.statement.text, /still open 2 days later/);
  });
});

describe('idempotency and the tenant wall', () => {
  test('re-delivering the same observation records it once', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    const e = systemFact('transfer-received', 'TR-0412', '8 units received', '2026-10-06T07:00:00.000Z');
    unwrap(await env.runtime.recordEvidence(connector('scm'), v.record.id, e, { idempotencyKey: 'obs-1' }));
    const again = unwrap(await env.runtime.recordEvidence(connector('scm'), v.record.id, e, { idempotencyKey: 'obs-1' }));
    assert.equal(again.evidence.length, 1);
  });

  test('another organization sees nothing', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    const stranger = { ...gm, orgId: 'org-other' };
    assert.equal((await env.runtime.view(stranger, v.record.id)).error.code, 'commitment.not_found');
    assert.deepEqual(unwrap(await env.runtime.list(stranger)), []);
  });
});

describe('context and endings — commitment is not binary', () => {
  test('a material change in the world asks the principal whether the promise still stands', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    assert.equal((await env.runtime.close(gm, v.record.id, { resolution: 'INVALIDATED' }, 'Order cancelled.')).error.code, 'commitment.no_context_change');
    const changed = unwrap(await env.runtime.recordContextChange(connector('memoire'), v.record.id, {
      source: { system: 'memoire', ref: 'memoire:opportunity:rohto-q4-tender', url: null }, statement: 'Rohto Q4 tender marked lost.', material: true,
    }));
    const gmAsks = unwrap(await env.runtime.asks(gm));
    assert.equal(gmAsks[0].code, 'CONTEXT_CHANGED');
    const closed = unwrap(await env.runtime.close(gm, v.record.id, { resolution: 'INVALIDATED' }, 'The order it served no longer exists.'));
    assert.equal(closed.view.resolution.resolution, 'INVALIDATED');
    assert.equal(changed.contextChanges.length, 1);
  });

  test('an owner may report a miss directly, but withdrawing the promise is the principal’s call', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    unwrap(await env.runtime.accept(scm, v.record.id));
    const cancel = unwrap(await env.runtime.close(scm, v.record.id, { resolution: 'CANCELLED' }, 'Not needed.'));
    assert.equal(cancel.applied, false);
    const env2 = setup();
    const v2 = await proposedTransfer(env2);
    unwrap(await env2.runtime.accept(scm, v2.record.id));
    const missed = unwrap(await env2.runtime.close(scm, v2.record.id, { resolution: 'MISSED' }, 'Distributor never released the units.'));
    assert.equal(missed.applied, true);
    assert.equal(unwrap(await env2.runtime.asks(gm))[0].code, 'LEARNING_OPEN');
  });

  test('superseding names the commitment that replaces it', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    const other = unwrap(await env.runtime.propose(gm, { origin: helmOrigin, terms: transferTerms({ owner: FIN, statement: 'Air-freight eight units' }) }));
    assert.equal((await env.runtime.close(gm, v.record.id, { resolution: 'SUPERSEDED' }, 'Plan changed.')).error.code, 'commitment.superseded_by_required');
    const r = unwrap(await env.runtime.close(gm, v.record.id, { resolution: 'SUPERSEDED', supersededBy: other.record.id }, 'Plan changed.'));
    assert.equal(r.view.resolution.supersededBy, other.record.id);
  });
});

describe('false precision is refused', () => {
  test('an unquantified value carries no number', async () => {
    const env = setup();
    const r = await env.runtime.propose(gm, {
      origin: helmOrigin,
      terms: transferTerms({ value: [{ dimension: 'CUSTOMER', intent: 'PROTECT', statement: 'Rohto relationship', precision: 'UNQUANTIFIED', low: '100', high: null, unit: null, source: { system: 'manual', ref: null, url: null } }] }),
    });
    assert.equal(r.error.code, 'value.false_precision');
  });

  test('a commitment that answers to something must reference it', async () => {
    const env = setup();
    const r = await env.runtime.propose(gm, { origin: { ...helmOrigin, ref: null }, terms: transferTerms() });
    assert.equal(r.error.code, 'commitment.origin_unreferenced');
  });

  test('roles, not people, can be parties; labels match case-insensitively without refs', async () => {
    const env = setup();
    const v = await proposedTransfer(env);
    const sameRole = { ...scm, actsAs: [party('supply chain director vietnam')] };
    assert.equal(unwrap(await env.runtime.accept(sameRole, v.record.id)).phase, 'ACTIVE');
    assert.equal(SCM.label, 'Supply Chain Director Vietnam');
    assert.ok(GM && FIN && fin);
  });
});
