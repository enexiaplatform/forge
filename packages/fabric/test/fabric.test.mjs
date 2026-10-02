import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createForgeRuntime, createInMemoryStore, lensAt, manualClock, sequentialIds, unwrap } from '@forge/kernel';
import {
  createFixtureMemoireReader,
  draftFromHelm,
  ingestObservations,
  matchObservation,
  outboundEvents,
  pendingIntake,
  createFixtureHelmReader,
  proposeIntake,
  referenceRules,
} from '../src/index.ts';
import { BUFFER_DECISION, DEMO_ORG, HELM_DECISIONS, MEMOIRE_OPPORTUNITIES, PEOPLE, ROHTO_DECISION } from '@forge/demo';

const gm = PEOPLE.gm.scope;
const scm = PEOPLE.scm.scope;

function env(start = '2026-09-25T09:00:00.000Z') {
  const clock = manualClock(start);
  const runtime = createForgeRuntime({ store: createInMemoryStore(clock), clock, ids: sequentialIds() });
  return { clock, runtime, memoire: createFixtureMemoireReader(MEMOIRE_OPPORTUNITIES) };
}

const observation = (over = {}) => ({
  id: 'o-1', system: 'scm', eventType: 'stock_transfer.received', objectRef: 'TR-0412', entityRef: null,
  occurredAt: '2026-10-06T06:30:00.000Z', payload: { quantity: 8 }, summary: '8 units received', url: null, ...over,
});

describe('intake — capture once, use everywhere', () => {
  test('a committed decision becomes an outcome commitment and one child per action intent, carrying Helm’s own words', async () => {
    const e = env();
    const draft = unwrap(await draftFromHelm(gm, ROHTO_DECISION, { memoire: e.memoire }));
    assert.equal(draft.intents.length, 3);
    assert.equal(draft.outcome.input.terms.statement, ROHTO_DECISION.commitment.summary);
    assert.equal(draft.outcome.input.terms.dueBy, '2026-12-31');
    assert.equal(draft.origin.fingerprint, ROHTO_DECISION.commitment.fingerprint);
    assert.equal(draft.origin.ref, 'helm:decision-commitment:dcm-rohto-q4');
    assert.deepEqual(draft.friction.missing, 0, 'nothing for the Rohto decision has to be typed');
    assert.ok(draft.friction.inherited > draft.friction.inferred);
    const opportunity = draft.context.find((c) => c.key === 'context.opportunity');
    assert.equal(opportunity.entityRef, 'memoire:opportunity:rohto-q4-tender', 'Memoire context is referenced, not copied as an entity');
    assert.ok(draft.context.some((c) => c.epistemic === 'ASSUMPTION' && /nobody stands behind this/.test(c.value)));
  });

  test('modelled outcomes become measures with Helm’s expected values; qualitative ones stay qualitative', async () => {
    const draft = unwrap(await draftFromHelm(gm, ROHTO_DECISION));
    const m = Object.fromEntries(draft.outcome.input.terms.measures.map((x) => [x.key, x]));
    assert.equal(m.GrossMarginPct.expected, '32.3878');
    assert.equal(m.GrossMarginPct.comparator, 'AT_LEAST');
    assert.equal(m['framework-relationship'].comparator, 'QUALITATIVE');
    assert.equal(m['framework-relationship'].expected, null);
    const margin = draft.outcome.input.terms.evidence.find((r) => r.key === 'actual-grossmarginpct');
    assert.equal(margin.matcher.objectRef, 'helm:value-node:node-grossmarginpct-rohto@2026-10-01T00:00:00.000Z', 'pinned to the node and period Helm committed to');
    assert.deepEqual(margin.matcher.where, {});
    assert.equal(m.GrossMarginPct.metricKey, 'GrossMarginPct');
    assert.equal(m.GrossMarginPct.unit, '%');
  });

  test('evidence for an intent is an inference, named as one, and never watched until it names its object', async () => {
    const draft = unwrap(await draftFromHelm(gm, ROHTO_DECISION));
    const transfer = draft.intents.find((d) => d.key === 'act-transfer');
    assert.equal(transfer.fields.evidence, 'INFERRED');
    assert.equal(transfer.notes[0].class, 'INFERENCE');
    assert.match(transfer.notes[0].text, /forge-reference-rules@1/);
    const matcher = transfer.input.terms.evidence[0].matcher;
    assert.equal(matcher.eventType, 'stock_transfer.received');
    assert.equal(matchObservation(matcher, observation()), null, 'an unpinned, unfiltered matcher matches nothing');
  });

  test('an intent with no dated due date or recognisable system asks only for what is missing', async () => {
    const draft = unwrap(await draftFromHelm(gm, BUFFER_DECISION));
    const back = draft.intents.find((d) => d.key === 'act-return-stock');
    assert.equal(back.fields.dueBy, 'MISSING');
    const terms = draft.intents.find((d) => d.key === 'act-consignment-terms');
    assert.equal(terms.input.terms.evidence[0].matcher, null, 'nothing Forge observes records an agreement; a person confirms it');
    assert.equal(draft.friction.missing, 2);

    const e = env('2026-10-01T09:00:00.000Z');
    const refused = await proposeIntake(e.runtime, gm, draft);
    assert.equal(refused.error.code, 'intake.missing_field');
    const done = unwrap(await proposeIntake(e.runtime, gm, draft, {
      'act-return-stock': { dueBy: '2026-11-28' },
      'act-consignment-terms': { intendedOutcome: 'Distributor D holds SKU-X on consignment again, on agreed terms.' },
    }));
    assert.equal(done.intents.find((v) => v.terms.dueBy === '2026-11-28').capture.dueBy, 'MANUAL');
  });

  test('intake happens once per decision, and the inbox shows only what Forge does not yet hold', async () => {
    const e = env('2026-10-01T09:00:00.000Z');
    const reader = createFixtureHelmReader(HELM_DECISIONS, () => e.clock.now());
    assert.equal(unwrap(await pendingIntake(e.runtime, gm, reader)).length, 2);
    const draft = unwrap(await draftFromHelm(gm, ROHTO_DECISION));
    const r = unwrap(await proposeIntake(e.runtime, gm, draft));
    assert.equal(r.intents.every((v) => v.record.parentId === r.outcome.record.id), true);
    assert.equal((await proposeIntake(e.runtime, gm, draft)).error.code, 'intake.already_in_forge');
    const pending = unwrap(await pendingIntake(e.runtime, gm, reader));
    assert.deepEqual(pending.map((p) => p.commitment.id), ['dcm-buffer-rebuild']);
  });

  test('the reference provider maps metrics to value dimensions and says nothing it cannot know', () => {
    assert.equal(referenceRules.dimensionForMetric('GrossMarginPct'), 'MARGIN');
    assert.equal(referenceRules.dimensionForMetric('SomethingElse'), null);
  });
});

describe('matching observations', () => {
  const pinned = { system: 'scm', eventType: 'stock_transfer.received', objectRef: 'TR-0412', where: { quantity: 8 } };
  const filter = { system: 'helm', eventType: 'value.actual_observed', objectRef: null, where: { metricKey: 'GrossMarginPct' } };

  test('a pinned matcher reads a different payload as a contradiction from the same object', () => {
    assert.equal(matchObservation(pinned, observation()), 'SUPPORTS');
    assert.equal(matchObservation(pinned, observation({ payload: { quantity: 6 } })), 'CONTRADICTS');
    assert.equal(matchObservation(pinned, observation({ objectRef: 'TR-0999', payload: { quantity: 6 } })), null);
  });

  test('an unpinned matcher only filters: another metric is not a contradiction', () => {
    const o = observation({ system: 'helm', eventType: 'value.actual_observed', objectRef: 'node-x', payload: { metricKey: 'DemandCoverage' } });
    assert.equal(matchObservation(filter, o), null);
    assert.equal(matchObservation(filter, { ...o, payload: { metricKey: 'GrossMarginPct' } }), 'SUPPORTS');
  });
});

describe('ingestion — observations become evidence and activity, once', () => {
  async function accepted(e) {
    const draft = unwrap(await draftFromHelm(gm, ROHTO_DECISION, { memoire: e.memoire }));
    const r = unwrap(await proposeIntake(e.runtime, gm, draft));
    const transfer = r.intents.find((v) => /^Recall/.test(v.terms.statement));
    const evidence = transfer.terms.evidence.map((x) => ({ ...x, matcher: { ...x.matcher, objectRef: 'TR-0412', where: { quantity: 8 } } }));
    unwrap(await e.runtime.accept(scm, transfer.record.id, { evidence }));
    unwrap(await e.runtime.linkExecution(scm, transfer.record.id, { system: 'scm', kind: 'TRANSFER_ORDER', ref: 'TR-0412', label: 'TR-0412', url: null }));
    return transfer.record.id;
  }

  test('a matching record becomes a fact from that system, recorded by its connector, idempotently', async () => {
    const e = env();
    const id = await accepted(e);
    const first = unwrap(await ingestObservations(e.runtime, DEMO_ORG, [observation()]));
    assert.deepEqual(first.effects.map((x) => x.kind), ['EVIDENCE_SUPPORTS']);
    unwrap(await ingestObservations(e.runtime, DEMO_ORG, [observation()]));
    const v = unwrap(await e.runtime.view(gm, id));
    assert.equal(v.evidence.length, 1, 're-delivery changes nothing');
    assert.equal(v.evidence[0].actor.kind, 'SYSTEM');
    assert.equal(v.requirements[0].basis, 'SYSTEM');
  });

  test('activity on a linked object is activity, never evidence', async () => {
    const e = env();
    const id = await accepted(e);
    const r = unwrap(await ingestObservations(e.runtime, DEMO_ORG, [observation({ id: 'o-act', eventType: 'transfer.progress', payload: { done: 2, total: 5, unit: 'legs' } })]));
    assert.deepEqual(r.effects.map((x) => x.kind), ['ACTIVITY']);
    const v = unwrap(await e.runtime.view(gm, id));
    assert.equal(v.links[0].activity.done, 2);
    assert.equal(v.requirements[0].status, 'OPEN');
  });

  test('a lost opportunity the commitment rests on asks the principal whether it still stands', async () => {
    const e = env();
    const id = await accepted(e);
    unwrap(await ingestObservations(e.runtime, DEMO_ORG, [
      observation({ id: 'lost', system: 'memoire', eventType: 'opportunity.lost', objectRef: 'memoire:opportunity:rohto-q4-tender', entityRef: 'memoire:opportunity:rohto-q4-tender', payload: {}, summary: 'Rohto Q4 tender lost to a competitor' }),
    ]));
    const asks = unwrap(await e.runtime.asks(gm, lensAt(e.clock.now())));
    assert.ok(asks.some((a) => a.code === 'CONTEXT_CHANGED' && a.commitmentId === id));
  });

  test('observations nothing waits for are reported as unmatched, not forced onto a commitment', async () => {
    const e = env();
    await accepted(e);
    const r = unwrap(await ingestObservations(e.runtime, DEMO_ORG, [observation({ id: 'stray', objectRef: 'TR-7777', payload: { quantity: 1 } })]));
    assert.deepEqual(r.unmatched, ['stray']);
  });
});

describe('outbound — Forge published for Helm', () => {
  test('a late dependency that stands for a Helm review trigger is published as that trigger', async () => {
    const e = env();
    const draft = unwrap(await draftFromHelm(gm, ROHTO_DECISION));
    const r = unwrap(await proposeIntake(e.runtime, gm, draft));
    const transfer = r.intents.find((v) => /^Recall/.test(v.terms.statement));
    unwrap(await e.runtime.declareDependency(gm, transfer.record.id, {
      key: 'release', description: 'Distributor D releases the units', on: { kind: 'EXTERNAL', source: { system: 'scm', ref: null, url: null }, label: 'Distributor D' },
      neededBy: '2026-09-30', matcher: null, helmTriggerKey: 'distributor-release-slips',
    }));
    e.clock.set('2026-10-01T09:00:00.000Z');
    const views = unwrap(await e.runtime.list(gm));
    const trigger = outboundEvents(views).find((x) => x.eventType === 'review_trigger.observed');
    assert.equal(trigger.payload.triggerKey, 'distributor-release-slips');
    assert.equal(trigger.originRef, 'helm:decision-commitment:dcm-rohto-q4');
    assert.equal(trigger.sourceSystem, 'forge');
    const keys = outboundEvents(views).map((x) => x.idempotencyKey);
    assert.equal(new Set(keys).size, keys.length, 'every published event has its own idempotency key');
  });
});
