/**
 * Precedents (ADR-0025) on the Meridian story: when Helm's second decision is drafted, Forge brings back what the
 * Rohto reallocation taught — and says why it thinks so, ranks nothing, and withholds what a reader may not read.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { precedentsFor, subjectOf, unwrap } from '@forge/kernel';
import { draftFromHelm, draftSubject } from '@forge/fabric';
import { BUFFER_DECISION, createMeridianDemo, MOMENTS } from '@forge/demo';

describe('precedents — the second decision meets the first one’s lessons', () => {
  const demo = createMeridianDemo();
  const gm = demo.people.gm.scope;
  const scm = demo.people.scm.scope;
  let views;
  let draft;

  before(async () => {
    for (const m of MOMENTS) await demo.advanceTo(m.key);
    views = unwrap(await demo.runtime.list(gm));
    draft = unwrap(await draftFromHelm(gm, BUFFER_DECISION));
  });

  const reading = (title, ledger = views) => precedentsFor(draftSubject([draft.outcome, ...draft.intents].find((d) => d.input.terms.statement.startsWith(title))), ledger);

  test('moving the units back to Distributor D: the Rohto transfer is a precedent, with its tie and its lesson', () => {
    const r = reading('Transfer eight units back');
    assert.equal(r.epistemic, 'INFERENCE');
    assert.equal(r.precedents.length, 1);
    const p = r.precedents[0];
    assert.match(p.statement, /Recall and transfer eight consignment units/);
    assert.ok(p.ties.some((t) => t.kind === 'SIMILAR_PROMISE' && /consignment/.test(t.statement)));
    assert.ok(p.ties.some((t) => t.kind === 'SAME_OWNER'), 'the same owner is said, alongside a real tie');
    assert.ok(p.daysAgainstOriginal > 0, 'it ended after the date first promised — said as a fact');
    assert.ok(p.lessons.some((l) => /QC re-release/.test(l.statement)), 'the lesson recorded higher in its tree comes with it');
    assert.match(r.headline, /once before: fulfilled, after the date first promised\. One lesson recorded then may apply\./);
    assert.match(r.caveat, /a story to read, not a pattern/);
  });

  test('a lesson whose stated scope names the promise may apply even without a precedent — and says why', () => {
    const r = reading('Agree the restored consignment terms');
    assert.equal(r.precedents.length, 0);
    assert.equal(r.lessons.length, 1);
    assert.match(r.lessons[0].why, /applies to “reallocations of consignment stock”, and this promise is about “consignment”/);
  });

  test('ordering a replenishment shares too little with anything to be called a precedent', () => {
    const r = reading('Place a replenishment order');
    assert.equal(r.precedents.length, 0);
    assert.equal(r.lessons.length, 0);
    assert.equal(r.headline, 'Nothing like this has ended on the ledger yet.');
  });

  test('a decision’s own tree is not its precedent; an owner alone is not a resemblance', () => {
    const transfer = views.find((v) => v.record.id === demo.refs.transfer);
    const own = precedentsFor(subjectOf(transfer), views);
    assert.ok(own.precedents.every((p) => views.find((v) => v.record.id === p.commitmentId).record.origin.ref !== transfer.record.origin.ref));
  });

  test('the Supply Chain Director, not cleared for margin, reads the lesson they wrote (ADR-0024)', async () => {
    const theirs = unwrap(await demo.runtime.list(scm));
    const r = reading('Transfer eight units back', theirs);
    assert.ok(r.lessons.some((l) => !l.withheld && /QC re-release/.test(l.statement)));
    const explanation = r.precedents[0].explanations.find((e) => /QC re-release before they can ship/.test(e.statement) || e.withheld);
    assert.equal(explanation.withheld, true, 'the GM, cleared for margin, wrote the explanation at the full ceiling');
  });
});
