/**
 * Value, as claimed and as realized (ADR-0028), on the Meridian story and on a decision that ended saying nothing.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { conditionsOf, createForgeRuntime, createInMemoryStore, dependencyRecords, manualClock, sequentialIds, unwrap, valueRecords } from '@forge/kernel';
import { createMeridianDemo, MOMENTS } from '@forge/demo';

describe('value records — the Rohto decision', () => {
  const demo = createMeridianDemo();
  const gm = demo.people.gm.scope;
  const com = demo.people.com.scope;
  let mine;
  let theirs;

  before(async () => {
    for (const m of MOMENTS) await demo.advanceTo(m.key);
    mine = valueRecords(unwrap(await demo.runtime.list(gm))).find((r) => r.commitmentId === demo.refs.outcome);
    theirs = valueRecords(unwrap(await demo.runtime.list(com))).find((r) => r.commitmentId === demo.refs.outcome);
  });

  test('each thing it was meant to protect sits beside what the principal said it did', () => {
    const margin = mine.claims.find((c) => c.claim.dimension === 'MARGIN');
    assert.equal(margin.claim.intent, 'PROTECT');
    assert.equal(margin.realized.effect, 'PROTECTED');
    assert.match(margin.by, /Country GM/);
    assert.equal(mine.unstated, 0);
    assert.equal(mine.resolution, 'PARTIALLY_FULFILLED');
  });

  test('the measures say whether a system stood behind the actual', () => {
    const margin = mine.measures.find((m) => /margin/i.test(m.label));
    assert.equal(margin.actual, '31.421');
    assert.equal(margin.difference, '-0.9668');
    assert.equal(margin.provenBySystem, true, 'Helm recorded the margin actual on the very node it committed to');
  });

  test('what it took: commitments, owners, days, dates moved — nothing priced', () => {
    assert.equal(mine.took.commitments, 5);
    assert.ok(mine.took.owners.length >= 3);
    assert.ok(mine.took.days > 30);
    assert.equal(mine.took.datesMoved, 2);
    assert.equal(mine.took.stillOpen, 0);
    assert.equal(Object.keys(mine).some((k) => /ratio|score|rank|rate|roi|cost/i.test(k)), false);
  });

  test('a reader not cleared for margin sees that something was said, not that nothing was', () => {
    assert.equal(theirs.realizedWithheld, true);
    assert.equal(theirs.unstated, 0, 'withheld is not unstated');
    assert.equal(theirs.measures.find((m) => /margin/i.test(m.label)).withheld, true);
  });
});

test('a decision that ended without saying what value it produced: counted unstated, and asked once — noted', async () => {
  const clock = manualClock('2026-09-25T09:00:00.000Z');
  const runtime = createForgeRuntime({ store: createInMemoryStore(clock), clock, ids: sequentialIds() });
  const GM = { kind: 'ROLE', label: 'Country GM (SYNTHETIC)', ref: null };
  const gm = { orgId: 'org-s', actor: { kind: 'PERSON', id: 'gm', label: 'GM' }, role: 'manager', actsAs: [GM], clearances: 'ALL' };
  const claim = (dimension) => ({ dimension, intent: 'CREATE', statement: `More ${dimension.toLowerCase()} (SYNTHETIC)`, precision: 'UNQUANTIFIED', low: null, high: null, unit: null, source: { system: 'forge', ref: null, url: null } });
  const v = unwrap(await runtime.propose(gm, {
    origin: { kind: 'DIRECT', system: 'forge', ref: null, label: 'SYNTHETIC', fingerprint: null, snapshot: null },
    terms: { statement: 'Open the Da Nang depot (SYNTHETIC)', intendedOutcome: 'Da Nang is served from Da Nang.', why: 'SYNTHETIC', owner: GM, principal: GM, dueBy: '2026-10-30', evidence: [{ key: 'open', level: 'OUTPUT', description: 'The depot opens', required: true, matcher: null }], measures: [], value: [claim('REVENUE'), claim('CAPACITY')] },
  }));
  unwrap(await runtime.accept(gm, v.record.id));
  clock.set('2026-10-29T09:00:00.000Z');
  unwrap(await runtime.change(gm, v.record.id, { kind: 'CLOSE', resolution: 'FULFILLED', supersededBy: null, confirmedWithoutEvidence: true }, 'Opened.'));
  unwrap(await runtime.recordOutcome(gm, v.record.id, { statement: 'The depot opened.', achievedOn: '2026-10-28', measures: [], realizedValue: [{ dimension: 'CAPACITY', effect: 'CREATED', statement: 'Two days less to Da Nang.', amount: null, unit: null }], basis: [] }));
  const view = unwrap(await runtime.view(gm, v.record.id));
  const [record] = valueRecords([view]);
  assert.equal(record.unstated, 1);
  assert.equal(record.took.days, 34);
  const c = conditionsOf(view).find((x) => x.code === 'VALUE_UNSTATED');
  assert.equal(c.severity, 'NOTED');
  assert.match(c.statement.text, /Nobody has said what became of the revenue value/);
});

describe('what work waited on — the Rohto story', () => {
  const demo = createMeridianDemo();
  let records;
  before(async () => {
    for (const m of MOMENTS) await demo.advanceTo(m.key);
    records = dependencyRecords(unwrap(await demo.runtime.list(demo.people.gm.scope)));
  });

  test('Distributor D’s release came two days after it was needed, and the transfer’s date moved after it', () => {
    const d = records.find((r) => r.on.startsWith('Distributor D'));
    assert.equal(d.kind, 'EXTERNAL');
    assert.equal(d.waitedOn, 1);
    assert.equal(d.late, 1);
    assert.equal(d.cases[0].daysLate, 2);
    assert.equal(d.cases[0].datesMovedAfter, 1);
    assert.match(d.caveat, /too few to read a pattern into/);
  });

  test('a dependency on another owner’s commitment settles when it is delivered — here, in time', () => {
    const c = records.find((r) => r.kind === 'COMMITMENT');
    assert.match(c.on, /Supply Chain Director Vietnam — their commitments/);
    assert.equal(c.late, 0);
    assert.ok(c.cases[0].settledAt);
    assert.equal(c.stillWaiting, 0);
  });

  test('ordered by name; counts and cases, never a rate', () => {
    assert.deepEqual(records.map((r) => r.on), [...records.map((r) => r.on)].sort((a, b) => a.localeCompare(b)));
    assert.equal(records.some((r) => Object.keys(r).some((k) => /rate|score|rank|percent/i.test(k))), false);
  });
});
