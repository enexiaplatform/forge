/**
 * ADR-0026 — what became of the assumptions a decision rested on: a person's judgment, attributed; a broken one asks
 * the principal whether the promise still stands; an ended decision asks once, noted, about the ones nobody examined;
 * and across decisions, the record says which held and which broke — counts and reasons, never a rate.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assumptionRecords, conditionsOf, unwrap, verifyOutcome } from '../src/index.ts';
import { agent, connector, gm, helmOrigin, outsider, party, person, scm, setup, transferTerms } from './helpers.mjs';

const assumption = (n, statement) => ({
  key: `assumption.${n}`,
  label: 'Assumption (critical)',
  value: statement,
  capture: 'INHERITED',
  epistemic: 'ASSUMPTION',
  source: { system: 'helm', ref: helmOrigin.ref, url: null },
  entityRef: null,
});
const RELEASE = 'Distributor D releases within five working days.';
const TENDER = 'The provincial tender remains material this quarter.';

async function proposed(env, origin = helmOrigin) {
  const v = unwrap(await env.runtime.propose(gm, { origin, terms: transferTerms(), context: [assumption(1, RELEASE), assumption(2, TENDER)] }));
  unwrap(await env.runtime.accept(scm, v.record.id));
  return v.record.id;
}

describe('assumptions — held or broke, said by a person', () => {
  test('a commitment knows the assumptions it inherited, and none has been examined yet', async () => {
    const env = setup();
    const id = await proposed(env);
    const v = unwrap(await env.runtime.view(gm, id));
    assert.deepEqual(v.assumptions.map((a) => [a.key, a.statement, a.assessed]), [['assumption.1', RELEASE, null], ['assumption.2', TENDER, null]]);
  });

  test('held: recorded with its reason and who said it; nothing else changes', async () => {
    const env = setup();
    const id = await proposed(env);
    const v = unwrap(await env.runtime.assessAssumption(scm, id, { key: 'assumption.2', assessment: 'HELD' }, 'The tender is still on the shortlist.'));
    const a = v.assumptions.find((x) => x.key === 'assumption.2');
    assert.equal(a.assessed.assessment, 'HELD');
    assert.equal(a.assessed.reason, 'The tender is still on the shortlist.');
    assert.equal(a.assessed.actor.label, scm.actor.label);
    assert.equal(v.contextChanges.length, 0);
  });

  test('broke while open: the world it rests on changed, so the principal is asked whether it still stands', async () => {
    const env = setup();
    const id = await proposed(env);
    const v = unwrap(await env.runtime.assessAssumption(scm, id, { key: 'assumption.1', assessment: 'BROKE' }, 'Distributor D has not released after eight working days.'));
    assert.equal(v.contextChanges.length, 1);
    assert.match(v.contextChanges[0].statement, /An assumption the decision rested on broke: “Distributor D releases/);
    const ask = conditionsOf(v).find((c) => c.code === 'CONTEXT_CHANGED');
    assert.ok(ask, 'asked like any material change of context');
    assert.deepEqual(ask.ask.acts, ['REAFFIRM', 'CLOSE', 'REQUEST_CHANGE']);
    assert.equal(ask.ask.whom.label, v.terms.principal.label);
    const again = unwrap(await env.runtime.assessAssumption(scm, id, { key: 'assumption.1', assessment: 'BROKE' }, 'Still not released.'));
    assert.equal(again.contextChanges.length, 1, 'saying it broke twice does not change the world twice');
  });

  test('refused: no reason, an assumption it does not rest on, evidence it does not hold, an agent, a connector, an outsider', async () => {
    const env = setup();
    const id = await proposed(env);
    assert.equal((await env.runtime.assessAssumption(scm, id, { key: 'assumption.1', assessment: 'HELD' }, '  ')).error.code, 'reason.required');
    assert.equal((await env.runtime.assessAssumption(scm, id, { key: 'assumption.9', assessment: 'HELD' }, 'x')).error.code, 'assumption.not_found');
    assert.equal((await env.runtime.assessAssumption(scm, id, { key: 'assumption.1', assessment: 'HELD', evidenceIds: ['evd-nope'] }, 'x')).error.code, 'assumption.evidence_not_found');
    assert.equal((await env.runtime.assessAssumption(scm, id, { key: 'assumption.1', assessment: 'MAYBE' }, 'x')).error.code, 'assumption.assessment_unknown');
    for (const who of [agent, connector('scm'), outsider]) {
      const r = await env.runtime.assessAssumption(who, id, { key: 'assumption.1', assessment: 'HELD' }, 'x');
      assert.equal(r.ok, false, who.actor.label);
      assert.equal(r.error.code, 'authority.refused');
    }
  });

  test('whoever stands behind an assumption may say what became of it, though they are no party to the commitment', async () => {
    const env = setup();
    const owned = { ...assumption(1, RELEASE), standsBehind: 'Commercial Director Vietnam' };
    const v = unwrap(await env.runtime.propose(gm, { origin: helmOrigin, terms: transferTerms(), context: [owned, assumption(2, TENDER)] }));
    const cd = person('Hoa Nguyen', [party('Commercial Director Vietnam')]);
    const held = unwrap(await env.runtime.assessAssumption(cd, v.record.id, { key: 'assumption.1', assessment: 'HELD' }, 'Distributor D released all eight.'));
    assert.equal(held.assumptions[0].assessed.actor.label, 'Hoa Nguyen');
    const notTheirs = await env.runtime.assessAssumption(cd, v.record.id, { key: 'assumption.2', assessment: 'HELD' }, 'x');
    assert.equal(notTheirs.error.code, 'authority.refused', 'standing behind one assumption is not standing behind them all');
  });

  test('ended with assumptions unexamined: the principal of the root is asked once, noted — never urgent', async () => {
    const env = setup();
    const id = await proposed(env);
    unwrap(await env.runtime.change(gm, id, { kind: 'CLOSE', resolution: 'FULFILLED', supersededBy: null, confirmedWithoutEvidence: true }, 'Delivered.'));
    const v = unwrap(await env.runtime.view(gm, id));
    const c = conditionsOf(v).find((x) => x.code === 'ASSUMPTIONS_UNEXAMINED');
    assert.equal(c.severity, 'NOTED');
    assert.match(c.statement.text, /2 assumptions the decision rested on were never examined/);
    assert.deepEqual(c.ask.acts, ['ASSESS_ASSUMPTION']);
    unwrap(await env.runtime.assessAssumption(gm, id, { key: 'assumption.1', assessment: 'HELD' }, 'Released on day six.'));
    unwrap(await env.runtime.assessAssumption(gm, id, { key: 'assumption.2', assessment: 'BROKE' }, 'The tender was cancelled in November.'));
    const after = unwrap(await env.runtime.view(gm, id));
    assert.equal(conditionsOf(after).some((x) => x.code === 'ASSUMPTIONS_UNEXAMINED'), false);
    assert.equal(after.contextChanges.length, 0, 'breaking after the end changes nothing it rests on any more');
  });

  test('the episode says what became of each, and the publication carries it to Helm', async () => {
    const env = setup();
    const origin = { ...helmOrigin, snapshot: { assumptions: [{ statement: RELEASE, owner: 'Commercial Director Vietnam' }, { statement: TENDER, owner: null }] } };
    const id = await proposed(env, origin);
    unwrap(await env.runtime.change(gm, id, { kind: 'CLOSE', resolution: 'FULFILLED', supersededBy: null, confirmedWithoutEvidence: true }, 'Delivered.'));
    unwrap(await env.runtime.assessAssumption(gm, id, { key: 'assumption.1', assessment: 'HELD' }, 'Released on day six.'));
    const episode = unwrap(await env.runtime.episode(gm, id));
    assert.ok(episode.sections.assumptions.some((s) => s.class === 'FACT' && /It held, said .* “Released on day six\.”/.test(s.text)));
    assert.ok(episode.sections.assumptions.some((s) => /Nobody has said whether it held/.test(s.text)));
    unwrap(await env.runtime.recordOutcome(gm, id, { statement: 'Eight units reached HCMC.', achievedOn: '2026-10-02', measures: [], realizedValue: [], basis: [] }));
    const verified = verifyOutcome(unwrap(await env.runtime.view(gm, id)));
    assert.equal(verified.ok, true, JSON.stringify(verified.error));
    assert.deepEqual(verified.value.assumptions.map((a) => [a.assessment, a.reason]), [['HELD', 'Released on day six.'], [null, null]]);
  });

  test('across decisions: which held and which broke — counts and reasons, one per decision, never a rate', async () => {
    const env = setup();
    const a = await proposed(env);
    const b = await proposed(env, { ...helmOrigin, ref: 'helm:decision-commitment:dcm-other', label: 'Another decision' });
    unwrap(await env.runtime.assessAssumption(gm, a, { key: 'assumption.1', assessment: 'HELD' }, 'Released on day four.'));
    unwrap(await env.runtime.assessAssumption(gm, b, { key: 'assumption.1', assessment: 'BROKE' }, 'Released on day eleven.'));
    const records = assumptionRecords(unwrap(await env.runtime.list(gm)));
    const release = records.find((r) => r.statement === RELEASE);
    assert.equal(release.held, 1);
    assert.equal(release.broke, 1);
    assert.equal(release.unexamined, 0);
    assert.deepEqual(release.cases.map((c) => c.reason).sort(), ['Released on day eleven.', 'Released on day four.']);
    assert.match(release.caveat, /too few to read a pattern into/);
    assert.equal(Object.keys(release).some((k) => /rate|score|percent/i.test(k)), false);
    assert.deepEqual(records.map((r) => r.statement), [RELEASE, TENDER], 'ordered by the assumption’s words');
  });
});
