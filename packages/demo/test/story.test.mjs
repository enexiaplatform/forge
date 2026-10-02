/**
 * The canonical acceptance test: the Meridian story, from Helm's commitment to
 * the lesson it leaves. If this passes, the loop in the source of truth —
 * Decision → Commitment → Execution → Evidence → Outcome → Learning — is real
 * in the kernel.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { lensAt, unwrap, varianceOf } from '@forge/kernel';
import { outboundEvents } from '@forge/fabric';
import { createMeridianDemo, MOMENTS } from '../src/index.ts';

describe('the Meridian story, moment by moment', () => {
  const demo = createMeridianDemo();
  const gm = demo.people.gm.scope;
  const snapshots = {};

  before(async () => {
    for (const m of MOMENTS) {
      await demo.advanceTo(m.key);
      snapshots[m.key] = {
        at: demo.clock.now(),
        views: unwrap(await demo.runtime.list(gm)),
        conditions: unwrap(await demo.runtime.conditions(gm)),
      };
    }
  });

  const at = (key, id) => snapshots[key].views.find((v) => v.record.id === id);
  const codes = (key, id) => snapshots[key].conditions.filter((c) => c.commitmentId === id).map((c) => c.code);

  test('every scripted act happened, in order, with nothing skipped', () => {
    const skipped = demo.log.filter((l) => l.result !== 'DONE');
    assert.deepEqual(skipped, []);
  });

  test('intake: five commitments in one tree, all answering to the Helm decision', () => {
    const views = snapshots.outcome.views.filter((v) => v.record.origin.system === 'helm');
    assert.equal(views.length, 5);
    const root = views.find((v) => v.record.parentId === null);
    assert.equal(root.record.origin.ref, 'helm:decision-commitment:dcm-rohto-q4');
    assert.ok(views.filter((v) => v !== root).every((v) => v.record.parentId === root.record.id));
    assert.ok(views.every((v) => v.record.origin.ref === root.record.origin.ref), 'context never lost on the way down');
  });

  test('Memoire: of three promises, the one the enterprise owes with a person and a date is proposed — and a person makes it an obligation', async () => {
    const proposed = unwrap(await demo.runtime.listCandidates(gm)).filter((c) => c.record.source.kind === 'MEMOIRE_PROMISE');
    assert.deepEqual(proposed.map((c) => c.record.source.ref), ['memoire:commitment:cmt-rohto-install-plan']);
    assert.equal(proposed[0].state, 'CONFIRMED');
    assert.equal(proposed[0].disposition.actor.id, 'demo-com');
    const plan = at('outcome', demo.refs.plan);
    assert.equal(plan.record.origin.kind, 'OBLIGATION');
    assert.equal(plan.record.origin.ref, 'memoire:commitment:cmt-rohto-install-plan', 'linked to the promise, not a copy of it');
    assert.equal(plan.resolution.resolution, 'FULFILLED');
    const kept = plan.requirements.find((r) => r.requirement.key === 'memoire-promise-kept');
    assert.equal(kept.status, 'EVIDENCED');
    assert.equal(kept.basis, 'SYSTEM', 'Memoire recorded it kept; nobody reported it');
    assert.equal(varianceOf(plan).time.daysAgainstOriginal <= 0, true);
  });

  test('meeting notes: what was promised is proposed, what was discussed, requested or hoped is not, and people decide', async () => {
    const read = unwrap(await demo.runtime.listCandidates(gm)).filter((c) => c.record.source.kind === 'MEETING_NOTES');
    assert.equal(read.length, 2, 'two promises in the notes; the discussion, the request and the “might” are not candidates');
    assert.ok(read.every((c) => c.record.epistemic === 'INFERENCE'));
    const sop = read.find((c) => c.record.source.quote.includes('SOP'));
    assert.equal(sop.state, 'CONFIRMED');
    assert.equal(sop.record.proposal.dueBy, '2026-10-30');
    assert.equal(sop.record.proposal.owner.label, 'Supply Chain Director Vietnam');
    assert.deepEqual(sop.disposition.edited, ['intendedOutcome', 'principal', 'evidence'], 'what the person supplied beyond the notes is kept as theirs');
    const reinspect = read.find((c) => c.record.source.quote.includes('re-inspect'));
    assert.equal(reinspect.state, 'DISMISSED');
    assert.match(reinspect.disposition.reason, /Already a commitment/);
    const done = at('outcome', demo.refs.sop);
    assert.equal(done.record.origin.kind, 'COMMUNICATION');
    assert.equal(done.resolution.resolution, 'FULFILLED');
    assert.equal(done.capture.dueBy, 'EXTRACTED');
  });

  test('the date confirmation closes on Memoire’s record, not on anyone’s report', () => {
    const v = at('confirmed', demo.refs.confirm);
    assert.equal(v.resolution.resolution, 'FULFILLED');
    assert.equal(v.requirements[0].basis, 'SYSTEM');
    assert.equal(v.evidence[0].item.source.system, 'memoire');
  });

  test('the slip: a late dependency cannot wait, the redate waits on the GM, and Helm hears its own trigger', () => {
    assert.deepEqual(codes('slip', demo.refs.transfer).sort(), ['CHANGE_AWAITING_DECISION', 'DEPENDENCY_LATE']);
    const late = snapshots.slip.conditions.find((c) => c.code === 'DEPENDENCY_LATE');
    assert.equal(late.severity, 'CANNOT_WAIT');
    const ask = snapshots.slip.conditions.find((c) => c.code === 'CHANGE_AWAITING_DECISION');
    assert.equal(ask.ask.whom.label, 'Country GM Vietnam');
    const trigger = outboundEvents(snapshots.slip.views).find((e) => e.eventType === 'review_trigger.observed');
    assert.equal(trigger.payload.triggerKey, 'distributor-release-slips');
  });

  test('the transfer is four days late against the first promise and on time against the agreed one', () => {
    const variance = varianceOf(at('transfer', demo.refs.transfer));
    assert.equal(variance.time.daysAgainstOriginal, 4);
    assert.equal(variance.time.daysAgainstAgreed, 0);
    assert.equal(variance.time.redates, 1);
  });

  test('delivery day: all activity done and output proven — and the outcome in conflict', () => {
    const v = at('shipment', demo.refs.ship);
    assert.equal(v.links[0].activity.done, 14);
    assert.equal(v.links[0].activity.total, 14);
    const byKey = Object.fromEntries(v.requirements.map((r) => [r.requirement.key, r]));
    assert.equal(byKey['goods-issue'].status, 'EVIDENCED', 'twelve units left the warehouse');
    assert.equal(byKey.delivered.status, 'CONFLICTED', 'a person says delivered in full; the ERP proves ten');
    assert.deepEqual(codes('shipment', demo.refs.ship), ['EVIDENCE_CONFLICT']);
  });

  test('the confirmation is withdrawn, not deleted, and the ERP’s later record supersedes its earlier one', () => {
    const qc = at('qc', demo.refs.ship);
    assert.equal(qc.requirements.find((r) => r.requirement.key === 'delivered').status, 'CONTRADICTED');
    assert.ok(qc.evidence.some((e) => e.item.channel === 'HUMAN_CONFIRMATION' && e.disputed !== null));
    const done = at('delivered', demo.refs.ship);
    assert.equal(done.resolution.resolution, 'FULFILLED');
    const erp = done.evidence.filter((e) => e.item.source.system === 'erp');
    assert.equal(erp.length, 2);
    assert.ok(erp.find((e) => e.item.statement.includes('10 of 12')).supersededBy !== null);
    assert.equal(varianceOf(done).time.daysAgainstOriginal, 9);
  });

  test('the outcome: partly fulfilled, margin below the committed future by exactly 0.9668 points', () => {
    const v = at('outcome', demo.refs.outcome);
    assert.equal(v.resolution.resolution, 'PARTIALLY_FULFILLED');
    const variance = varianceOf(v);
    const margin = variance.measures.find((m) => m.key === 'GrossMarginPct');
    assert.equal(margin.difference, '-0.9668');
    assert.equal(margin.met, false);
    assert.equal(variance.measures.find((m) => m.key === 'DemandCoverage').met, true);
    assert.equal(variance.measures.find((m) => m.key === 'framework-relationship').met, null, 'qualitative outcomes are judged by people');
    assert.equal(variance.measuresHeld, false);
    assert.ok(v.requirements.filter((r) => r.requirement.required).every((r) => r.status === 'EVIDENCED'));
  });

  test('learning closes the loop: nobody is asked twice, and the episode is complete', async () => {
    assert.deepEqual(snapshots.outcome.conditions, [], 'the lesson on the decision’s commitment answers for the tree beneath it');
    const episode = unwrap(await demo.runtime.episode(gm, demo.refs.outcome));
    assert.equal(episode.complete, true);
    assert.equal(episode.ref, `forge:commitment:${demo.refs.outcome}`);
    for (const section of ['situation', 'decision', 'assumptions', 'commitment', 'evidence', 'outcome', 'variance', 'explanation', 'learning']) {
      assert.ok(episode.sections[section].length > 0, `${section} is not empty`);
    }
    assert.equal(episode.sections.learning[0].class, 'RECOMMENDATION');
    assert.equal(episode.sections.explanation[0].class, 'INFERENCE');
    assert.ok(episode.sections.assumptions.some((s) => s.class === 'ASSUMPTION' && /nobody stands behind this/.test(s.text)));
  });

  test('the verified outcome is published once, by the principal, resting on Helm’s own records', async () => {
    const v = at('outcome', demo.refs.outcome);
    assert.equal(v.publications.length, 1);
    const p = v.publications[0].publication;
    assert.equal(v.publications[0].actor.id, 'demo-gm');
    assert.match(p.fingerprint, /^fop_[0-9a-f]{16}$/);
    assert.equal(p.measures.find((m) => m.metricKey === 'GrossMarginPct').basis.kind, 'SYSTEM');
    const published = outboundEvents(snapshots.outcome.views).filter((e) => e.eventType === 'outcome.published');
    assert.equal(published.length, 1);
  });

  test('Helm’s classes hold in Forge: Supply Chain sees that margin and cash were proven and how it ended, not the values', async () => {
    const scm = demo.people.scm.scope;
    const theirs = unwrap(await demo.runtime.view(scm, demo.refs.outcome));
    const finance = unwrap(await demo.runtime.view(demo.people.fin.scope, demo.refs.outcome));
    assert.equal(theirs.resolution.resolution, 'PARTIALLY_FULFILLED');
    assert.doesNotMatch(JSON.stringify(theirs.evidence) + JSON.stringify(theirs.outcome) + JSON.stringify(theirs.publications), /31\.421|1768300000|1 768 300 000/);
    const margin = varianceOf(theirs).measures.find((m) => m.key === 'GrossMarginPct');
    assert.equal(margin.withheld, true);
    assert.equal(varianceOf(theirs).measures.find((m) => m.key === 'DemandCoverage').actual, '100', 'general management values are not withheld');
    assert.ok(theirs.requirements.filter((r) => r.requirement.required).every((r) => r.status === 'EVIDENCED'), 'the same status for every reader');
    assert.equal(varianceOf(finance).measures.find((m) => m.key === 'GrossMarginPct').difference, '-0.9668', 'Finance is cleared');
  });

  test('reading at an earlier moment reproduces what was known then', async () => {
    const then = unwrap(await demo.runtime.view(gm, demo.refs.ship, lensAt(snapshots.shipment.at)));
    assert.equal(then.phase, 'ACTIVE');
    assert.equal(then.requirements.find((r) => r.requirement.key === 'delivered').status, 'CONFLICTED');
    const episodeThen = unwrap(await demo.runtime.episode(gm, demo.refs.outcome, lensAt(snapshots.slip.at)));
    const episodeNow = unwrap(await demo.runtime.episode(gm, demo.refs.outcome));
    assert.equal(episodeThen.complete, false);
    assert.notEqual(episodeThen.fingerprint, episodeNow.fingerprint);
  });

  test('downward from the decision: the trace reaches every commitment and its outcome', async () => {
    const roots = unwrap(await demo.runtime.traceOrigin(gm, 'helm:decision-commitment:dcm-rohto-q4'));
    assert.equal(roots.length, 1);
    assert.equal(roots[0].children.length, 4);
    const upward = unwrap(await demo.runtime.trace(gm, demo.refs.ship));
    assert.equal(upward.ancestors[0].record.id, demo.refs.outcome);
    assert.equal(upward.origin.label, 'Rohto Q4 order fulfilment');
  });

  test('no surface reported progress as a percentage, and no commitment holds one', () => {
    for (const v of snapshots.outcome.views) {
      assert.equal(JSON.stringify(v).match(/percent_?complete|progressPct/i), null);
    }
  });
});
