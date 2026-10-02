/**
 * Decision fidelity on the Meridian story: where execution departed from what Helm committed — each departure a
 * record of when, by whom, why and on what authority, and never a score.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { unwrap } from '@forge/kernel';
import { decisionFidelity, departureKinds, HELM_ACTION_INTENT_CONTEXT, helmActionIntentRef, toHelmExecutionOutcome } from '@forge/fabric';
import { createMeridianDemo, HELM_DECISIONS, MOMENTS, ROHTO_DECISION } from '@forge/demo';

describe('decision fidelity — the Meridian story', () => {
  const demo = createMeridianDemo();
  const gm = demo.people.gm.scope;
  const at = {};

  before(async () => {
    for (const m of MOMENTS) {
      await demo.advanceTo(m.key);
      at[m.key] = unwrap(await demo.runtime.list(gm));
    }
  });

  const fidelity = (key, hc = ROHTO_DECISION, later = HELM_DECISIONS) => decisionFidelity(hc, at[key], later);
  const kinds = (f) => f.departures.map((d) => d.kind);

  test('each commitment drafted from an intent names it, by reference', () => {
    const intents = at.intake.filter((v) => v.record.parentId !== null && v.record.origin.ref === 'helm:decision-commitment:dcm-rohto-q4');
    assert.equal(intents.length, 3);
    for (const v of intents) {
      const field = v.record.context.find((c) => c.key === HELM_ACTION_INTENT_CONTEXT);
      assert.ok(field, v.record.terms.statement);
      assert.equal(field.epistemic, 'FACT');
      assert.ok(ROHTO_DECISION.actionIntents.some((i) => helmActionIntentRef(i.id) === field.source.ref));
    }
  });

  test('at the end: the delivery execution added, two dates moved, and the outcome ended short — two intents held as decided', () => {
    const f = fidelity('outcome');
    assert.deepEqual(kinds(f), ['ADDED', 'REDATED', 'REDATED', 'ENDED_SHORT']);
    assert.deepEqual(f.heldAsDecided.map((h) => h.statement), ['Confirm the delivery date with Rohto procurement', 'Update the quarter inventory exposure and cash forecast']);
    assert.equal(f.headline, 'Execution differs from the decision in 4 places; 2 of 3 intents still stand as decided.');
  });

  test('a moved date says who asked, why, against which date, and who approved it on what authority', () => {
    const transfer = fidelity('outcome').departures.find((d) => d.kind === 'REDATED' && d.commitmentId === demo.refs.transfer);
    assert.equal(transfer.statement, '“Recall and transfer eight consignment units from Distributor D to HCMC” moved from 2 Oct 2026 (the date Helm’s intent carried) to 6 Oct 2026, 4 days later.');
    assert.match(transfer.by, /Supply Chain/, 'the person who asked, not the approver who applied it');
    assert.match(transfer.reason, /Distributor D’s warehouse confirms release/);
    assert.match(transfer.authority.approvedBy, /Country GM/);
    assert.match(transfer.authority.approvalReason, /Rohto’s 15 October date still holds/);
    assert.equal(transfer.authority.trusted, false, 'Forge’s interim policy, said so — not Helm’s authority');
  });

  test('each departure carries its commitment’s classes, and the submission to Helm carries them all (Helm ADR-0038)', async () => {
    const f = fidelity('outcome');
    const short = f.departures.find((d) => d.kind === 'ENDED_SHORT');
    assert.deepEqual(short.protection, ['FINANCIAL_SENSITIVE'], 'the outcome commitment is measured by margin');
    const transfer = f.departures.find((d) => d.kind === 'REDATED' && d.commitmentId === demo.refs.transfer);
    assert.deepEqual(transfer.protection, [], 'the transfer rests on nothing protected');
    const cleared = { ...gm, clearances: 'ALL' };
    const view = unwrap(await demo.runtime.view(cleared, demo.refs.outcome));
    const publication = view.publications.at(-1)?.publication ?? unwrap(await demo.runtime.publishOutcome(cleared, demo.refs.outcome)).publication;
    const submission = toHelmExecutionOutcome(publication, { orgId: gm.orgId, publishedByLabel: 'Country GM Vietnam', authority: null, departures: f.departures });
    assert.equal(submission.departures.length, f.departures.length);
    assert.ok(submission.departures.every((d) => d.sensitivity.every((c) => submission.sensitivity.includes(c))), 'never less protected than what it states');
    assert.equal(submission.departures.find((d) => d.kind === 'ENDED_SHORT').reason, short.reason);
  });

  test('ownership is not assignment: until the owners accept, the decision is not yet owned', () => {
    const early = decisionFidelity(ROHTO_DECISION, at.intake.map((v) => v), HELM_DECISIONS);
    const unowned = early.departures.filter((d) => d.kind === 'NOT_OWNED');
    const views = at.intake.filter((v) => v.record.origin.ref === 'helm:decision-commitment:dcm-rohto-q4');
    assert.equal(unowned.length, 2, 'two of the four have not been accepted yet');
    assert.equal(unowned.length, views.filter((v) => v.phase === 'PROPOSED').length);
    for (const d of unowned) assert.match(d.statement, /^Nobody has accepted/);
  });

  test('what differs from the start: an intent nobody took up, and an expected outcome Forge cannot compare', () => {
    const hc = {
      ...ROHTO_DECISION,
      actionIntents: [...ROHTO_DECISION.actionIntents, { id: 'act-brief', title: 'Brief the distributor network on the buffer', detail: '', ownerLabel: 'Commercial Director Vietnam', ownerUserId: null, dueDate: '2026-10-10', targetSystem: 'memoire' }],
      commitment: {
        ...ROHTO_DECISION.commitment,
        expectedOutcomes: [
          ...ROHTO_DECISION.commitment.expectedOutcomes,
          { label: 'Distributor stock days', kind: 'MODELLED', nodeId: 'node-stock-days', metricKey: 'DistributorStockDays', period: null, expectedValue: '0', unit: 'days', currency: null, statement: null, betterWhen: null },
        ],
      },
    };
    const f = fidelity('outcome', hc);
    assert.deepEqual(kinds(f).slice(0, 2), ['OUTCOME_NOT_COMPARABLE', 'INTENT_NOT_TAKEN_UP'], 'structural departures come first, undated');
    assert.equal(f.departures[0].at, null);
    assert.match(f.departures[0].statement, /Distributor stock days at 0.*not one-sided/);
    assert.match(f.departures[1].statement, /“Brief the distributor network on the buffer” \(Commercial Director Vietnam\) has no commitment in Forge/);
  });

  test('a target moved away from Helm’s committed future is a departure, stated against what Helm committed', () => {
    const hc = {
      ...ROHTO_DECISION,
      commitment: {
        ...ROHTO_DECISION.commitment,
        expectedOutcomes: ROHTO_DECISION.commitment.expectedOutcomes.map((o) => (o.metricKey === 'GrossMarginPct' ? { ...o, expectedValue: '33' } : o)),
      },
    };
    const moved = fidelity('outcome', hc).departures.find((d) => d.kind === 'TARGET_MOVED');
    assert.ok(moved);
    assert.match(moved.statement, /^Gross margin.*now aims at 32\.3878 %, where Helm committed to 33 %\.$/);
  });

  test('when Helm recommits the decision, execution of the earlier version says so', () => {
    const later = { ...ROHTO_DECISION, commitment: { ...ROHTO_DECISION.commitment, id: 'dcm-rohto-q4-r2', fingerprint: 'dfp_recommitted_2', committedAt: '2026-10-20T09:00:00.000Z', summary: 'Hold the reallocation; restore the distributor buffer first.' } };
    const f = fidelity('outcome', ROHTO_DECISION, [...HELM_DECISIONS, later]);
    const r = f.departures.find((d) => d.kind === 'RECOMMITTED');
    assert.match(r.statement, /^Helm recommitted this decision \(dfp_recommitted_2\); these commitments still execute the version committed 25 Sep 2026 \(/);
    assert.equal(r.reason, 'Hold the reallocation; restore the distributor buffer first.');
  });

  test('a decision Forge has not taken in has nothing to depart from', () => {
    assert.equal(decisionFidelity(ROHTO_DECISION, [], HELM_DECISIONS).headline, 'Nothing executes this decision in Forge yet.');
  });

  test('a record, not a score: no percentage, rate or rank anywhere in it', () => {
    const text = JSON.stringify(fidelity('outcome'));
    assert.doesNotMatch(text, /%\)|percent|score|rating|rank/i);
    assert.ok(departureKinds.length > 0);
  });
});
