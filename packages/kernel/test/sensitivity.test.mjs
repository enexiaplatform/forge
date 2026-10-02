/**
 * ADR-0017 at the kernel: a fact keeps its protection through
 *   Helm fact → evidence → outcome → variance → episode → publication,
 * and a reader without clearance sees that it exists, never what it says.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { isCleared, joinProtection, protectionOf, readAs, sealEvent, unsealEvent, unwrap, varianceOf, verifyOutcome } from '../src/index.ts';
import { GM, connector, gm, helmOrigin, scm, setup, transferTerms } from './helpers.mjs';

const NODE = 'helm:value-node:node-margin@2026-10-01T00:00:00.000Z';
const FIN = ['FINANCIAL_SENSITIVE'];
const cleared = { ...gm, clearances: FIN };

const outcomeTerms = {
  statement: 'Reallocate Distributor D’s consignment stock to serve Rohto in Q4',
  intendedOutcome: 'Rohto is served in full and margin holds at the committed future.',
  why: 'Management committed to it in Helm.',
  owner: GM,
  principal: GM,
  dueBy: '2026-12-31',
  evidence: [{ key: 'actual-margin', level: 'OUTCOME', description: 'Helm records the margin actual for Q4', required: true, matcher: { system: 'helm', eventType: 'value.actual_observed', objectRef: NODE, where: {} } }],
  measures: [{ key: 'GrossMarginPct', label: 'Gross margin %', comparator: 'AT_LEAST', expected: '32.3878', unit: '%', statement: null, source: { system: 'helm', ref: NODE, url: null }, metricKey: 'GrossMarginPct', protection: FIN }],
  value: [],
};

describe('a protected fact keeps its protection, all the way to Helm', () => {
  let env;
  let id;

  before(async () => {
    env = setup();
    id = unwrap(await env.runtime.propose(cleared, { origin: helmOrigin, terms: outcomeTerms })).record.id;
    unwrap(await env.runtime.accept(cleared, id));
    env.clock.set('2026-11-18T09:00:00.000Z');
    const withEvidence = unwrap(await env.runtime.recordEvidence(connector('helm'), id, {
      requirementKey: 'actual-margin', stance: 'SUPPORTS', epistemic: 'FACT', channel: 'SYSTEM_EVENT',
      source: { system: 'helm', ref: NODE, url: null }, statement: 'Gross margin %: actual 31.421 (finance source actual, recorded by Helm)',
      observedAt: '2026-11-18T08:00:00.000Z', confidence: null, observationId: 'helm-observation:1', protection: FIN,
    }));
    const evidenceId = withEvidence.evidence[0]?.item.id ?? unwrap(await env.runtime.view(cleared, id)).evidence[0].item.id;
    env.clock.set('2026-11-20T08:00:00.000Z');
    unwrap(await env.runtime.change(cleared, id, { kind: 'CLOSE', resolution: 'PARTIALLY_FULFILLED', supersededBy: null, confirmedWithoutEvidence: false }, 'Two units arrived late; margin landed under the committed future.'));
    unwrap(await env.runtime.recordOutcome(cleared, id, {
      statement: 'Margin landed at 31.421%, under the 32.3878% committed.',
      achievedOn: '2026-10-24',
      measures: [{ key: 'GrossMarginPct', actual: '31.421', note: 'Re-labelling and QC rework.' }],
      realizedValue: [{ dimension: 'MARGIN', effect: 'PROTECTED', statement: '0.97 points under the committed future.', amount: null, unit: null }],
      basis: [evidenceId],
    }));
    unwrap(await env.runtime.recordLearning(cleared, id, { kind: 'EXPLANATION', statement: 'Re-labelling and QC rework took 0.6 points of margin.', appliesTo: null }));
  });

  test('words: the close reason and the explanation take the commitment’s ceiling, and are withheld from an uncleared reader', async () => {
    const theirs = unwrap(await env.runtime.view(scm, id));
    const mine = unwrap(await env.runtime.view(cleared, id));
    assert.match(mine.resolution.reason, /margin landed under/);
    assert.match(theirs.resolution.reason, /^Withheld: written on a commitment that rests on financially sensitive values/);
    assert.match(mine.learnings[0].learning.statement, /0\.6 points/);
    assert.doesNotMatch(JSON.stringify(theirs.learnings), /0\.6/);
    assert.equal(theirs.learnings[0].learning.kind, 'EXPLANATION');
    const close = mine.events.find((e) => e.type === 'CLOSED' || e.type === 'CHANGE_REQUESTED' || e.type === 'TERMS_CHANGED');
    assert.deepEqual(close.textProtection, FIN, 'stamped by the runtime: nobody classified the sentence');
  });

  test('evidence: an uncleared reader sees that Helm proved it, not the value — and the status is the same for both', async () => {
    const theirs = unwrap(await env.runtime.view(scm, id));
    const mine = unwrap(await env.runtime.view(cleared, id));
    assert.match(mine.evidence[0].item.statement, /31\.421/);
    assert.doesNotMatch(theirs.evidence[0].item.statement, /31\.421/);
    assert.deepEqual(theirs.evidence[0].item.withheld, FIN, 'never a silent absence');
    assert.equal(theirs.requirements[0].status, 'EVIDENCED');
    assert.equal(theirs.requirements[0].basis, mine.requirements[0].basis);
  });

  test('outcome and variance: the actual, the difference and the narrative stated with them are withheld', async () => {
    const theirs = unwrap(await env.runtime.view(scm, id));
    assert.equal(theirs.resolution.resolution, 'PARTIALLY_FULFILLED', 'how it ended is not withheld');
    assert.doesNotMatch(JSON.stringify(theirs.outcome), /31\.421|0\.97|re-labelling/i);
    const m = varianceOf(theirs).measures[0];
    assert.equal(m.withheld, true);
    assert.equal(m.actual, null);
    assert.equal(m.difference, null);
    assert.equal(m.expected, '32.3878', 'the expectation is the decision’s, read by whoever may read the decision');
    assert.equal(varianceOf(unwrap(await env.runtime.view(cleared, id))).measures[0].difference, '-0.9668');
  });

  test('the episode carries the union of its classes, and says what it withheld', async () => {
    const theirs = unwrap(await env.runtime.episode(scm, id));
    const mine = unwrap(await env.runtime.episode(cleared, id));
    assert.deepEqual(mine.protection, FIN);
    assert.deepEqual(mine.withheld, []);
    assert.deepEqual(theirs.withheld, FIN);
    assert.ok(theirs.sections.variance.some((s) => /actual withheld \(financially sensitive\)/.test(s.text)));
    assert.doesNotMatch(JSON.stringify(theirs.sections), /31\.421/);
  });

  test('only someone who can read it all can publish it; the publication carries the classes, and is itself sealed', async () => {
    const refused = verifyOutcome(unwrap(await env.runtime.view(scm, id)));
    assert.equal(refused.ok, false);
    assert.ok(refused.error.details.gaps.some((g) => g.code === 'withheld'));
    const published = unwrap(await env.runtime.publishOutcome(cleared, id)).publication;
    assert.deepEqual(published.protection, FIN);
    assert.deepEqual(published.measures[0].protection, FIN);
    const seenBy = unwrap(await env.runtime.view(scm, id)).publications[0].publication;
    assert.equal(seenBy.measures[0].actual, null);
    assert.equal(seenBy.measures[0].withheld, true);
    assert.equal(seenBy.fingerprint, published.fingerprint, 'the same publication, read with less');
    assert.match(published.explanations[0].statement, /0\.6 points/);
    assert.doesNotMatch(JSON.stringify(seenBy.explanations), /0\.6/, 'what explains a sealed outcome is sealed with it');
  });
});

describe('words keep the ceiling of the commitment they are written on', () => {
  test('on a commitment that rests on nothing protected, words stay open — unless the writer raises them', async () => {
    const env = setup();
    const id = unwrap(await env.runtime.propose(gm, { origin: helmOrigin, terms: transferTerms() })).record.id;
    unwrap(await env.runtime.accept(scm, id, { reason: 'Accepted; the warehouse confirmed space.' }));
    const accepted = unwrap(await env.runtime.view(gm, id)).events.find((e) => e.type === 'ACCEPTED');
    assert.equal(accepted.reason, 'Accepted; the warehouse confirmed space.');
    assert.equal(accepted.textProtection, undefined);

    unwrap(await env.runtime.recordLearning(scm, id, { kind: 'LESSON', statement: 'Ask HR before moving the night shift.', appliesTo: null }, { textProtection: ['HR_RESTRICTED'] }));
    const hr = { ...gm, clearances: ['HR_RESTRICTED'] };
    assert.match(unwrap(await env.runtime.view(hr, id)).learnings[0].learning.statement, /night shift/);
    assert.doesNotMatch(JSON.stringify(unwrap(await env.runtime.view(gm, id)).learnings), /night shift/);
    assert.deepEqual(unwrap(await env.runtime.episode(hr, id)).protection, ['HR_RESTRICTED'], 'the episode quoting it carries its class, so Helm receives it at least as protected');
  });

  test('a learning drawn from notes keeps its source; the quoted words are sealed with it, which notes is said (ADR-0030)', async () => {
    const env = setup();
    const id = unwrap(await env.runtime.propose(cleared, { origin: helmOrigin, terms: outcomeTerms })).record.id;
    const drawnFrom = { ref: 'notes:review', label: 'Outcome review', quote: 'Margin fell to 31.4 because of re-labelling.', locator: 'line 4' };
    unwrap(await env.runtime.recordLearning(cleared, id, { kind: 'EXPLANATION', statement: 'Re-labelling took margin to 31.4.', appliesTo: null, drawnFrom }));
    assert.deepEqual(unwrap(await env.runtime.view(cleared, id)).learnings[0].learning.drawnFrom, drawnFrom);
    const theirs = unwrap(await env.runtime.view(scm, id)).learnings[0].learning;
    assert.equal(theirs.drawnFrom.label, 'Outcome review');
    assert.equal(theirs.drawnFrom.locator, 'line 4');
    assert.doesNotMatch(JSON.stringify(theirs), /31\.4/);
  });

  test('a writer cannot lower words below the ceiling: the store refuses what the runtime would never write', async () => {
    const env = setup();
    const id = unwrap(await env.runtime.propose(cleared, { origin: helmOrigin, terms: outcomeTerms })).record.id;
    const written = await env.store.appendEvents(cleared, [{
      id: 'evt-lowered', orgId: cleared.orgId, commitmentId: id, type: 'DECLINED', effectiveAt: '2026-09-26T09:00:00.000Z',
      actor: cleared.actor, reason: 'Margin 31 is too thin.', textProtection: [], authority: null, idempotencyKey: null, payload: { party: GM },
    }]);
    assert.equal(written.ok, false);
    assert.equal(written.error.code, 'event.text_below_ceiling');
  });
});

describe('the rules', () => {
  test('classes are compartments: a financial clearance does not open HR; general needs none; admins hold all', () => {
    assert.equal(isCleared(['FINANCIAL_SENSITIVE'], ['HR_RESTRICTED']), false);
    assert.equal(isCleared(['FINANCIAL_SENSITIVE'], ['FINANCIAL_SENSITIVE', 'HR_RESTRICTED']), false);
    assert.equal(isCleared([], []), true);
    assert.equal(isCleared(undefined, ['STRATEGIC_RESTRICTED']), false);
    assert.equal(isCleared('ALL', ['STRATEGIC_RESTRICTED', 'HR_RESTRICTED']), true);
  });

  test('a protection is a normalized set: general dropped, unknown names refused, order fixed, union never shrinks', () => {
    assert.deepEqual(protectionOf('HR_RESTRICTED', 'GENERAL_MANAGEMENT', 'TOP_SECRET', 'FINANCIAL_SENSITIVE'), ['FINANCIAL_SENSITIVE', 'HR_RESTRICTED']);
    assert.deepEqual(joinProtection(['FINANCIAL_SENSITIVE'], [], ['COMMERCIAL_CONFIDENTIAL']), ['FINANCIAL_SENSITIVE', 'COMMERCIAL_CONFIDENTIAL']);
  });

  test('sealing and unsealing are exact inverses, and an unprotected event is never touched', () => {
    const e = { type: 'EVIDENCE_RECORDED', payload: { evidence: { id: 'e1', statement: 'Actual 31.421', protection: FIN } } };
    const s = sealEvent(e);
    assert.doesNotMatch(JSON.stringify(s.open), /31\.421/);
    assert.deepEqual(unsealEvent(s.open, s.sealed), e);
    const plain = { type: 'EVIDENCE_RECORDED', payload: { evidence: { id: 'e2', statement: 'Received 8 units' } } };
    assert.equal(sealEvent(plain).sealed, null);
    assert.equal(readAs(plain, undefined), plain);
  });
});
