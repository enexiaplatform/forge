/**
 * Loop 3 — FORGE verified outcome → HELM enterprise memory / Management Genome,
 * through HELM's governed intake (Helm ADR-0034, ADR-0035).
 *
 * Helm's real runtime commits its canonical Rohto decision (Helm's own harness).
 * Forge reads it through Helm's own DecisionStore, drafts and runs the
 * commitments, observes the outcome against Helm's own value nodes, closes and
 * PUBLISHES a verified outcome. Then Forge SUBMITS it to Helm's intake — Helm's
 * code validates provenance, the commitment fingerprint, the source facts and
 * their sensitivity, and keeps a receipt. A Helm manager adopts it: Helm's
 * decision runtime records the outcome review and computes the variance; the
 * fabric records the adoption. The genome binds the review AND a typed,
 * pinned reference to the Forge execution episode, and its own pattern logic
 * reads the actual Forge verified. Forge never writes Helm.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createForgeRuntime, createInMemoryCandidateStore, createInMemoryStore, manualClock, sequentialIds, unwrap } from '@forge/kernel';
import {
  assembleCommittedDecisions,
  draftFromHelm,
  helmCommitmentOf,
  helmValueRef,
  ingestObservations,
  outboundEvents,
  proposeIntake,
  publicationAuthority,
  toHelmExecutionEpisodeRef,
  toHelmExecutionOutcome,
} from '@forge/fabric';
import { fromSibling, HELM, helmSkip } from './support/siblings.mjs';

const ACTUALS = { GrossMarginPct: '31.421', DemandCoverage: '100', CashImpact: '-1768300000' };
const FIN = ['FINANCIAL_SENSITIVE'];

describe('Loop 3 — Forge’s verified outcome reaches Helm’s memory through Helm’s governed intake', { skip: helmSkip }, () => {
  let s;
  let hc;
  let forge;
  let gm;
  let outcomeId;
  let publication;
  let submission;
  let intake;
  let genome;
  let receipt;
  let review;

  before(async () => {
    const harness = await fromSibling(HELM, 'packages/genome-runtime/test/harness.mjs');
    s = await harness.buildGenomeStack();
    const { buildSeedValueRegistry } = await import('@helm/value-graph');
    const { SENSITIVITY_ORDER, sensitivityOfMetric } = await import('@helm/twin-runtime');
    const { createExecutionOutcomeIntake, createInMemoryExecutionOutcomeStore } = await import('@helm/integration-runtime');
    const { createManagementGenome, createInMemoryGenomeStore } = await import('@helm/genome-runtime');
    const { seqIdGen } = await import('@helm/shared');
    const metrics = buildSeedValueRegistry();
    const store = s.decisionStore;
    // Helm's own DecisionStore answers Forge's HelmDecisionSource port as it is: same reads, same shapes.
    const source = {
      listDecisions: (sc) => store.listDecisions(sc),
      listCommitments: (sc, id) => store.listCommitments(sc, id),
      listAlternatives: (sc, id) => store.listAlternatives(sc, id),
      listAssumptions: (sc, id) => store.listAssumptions(sc, id),
      listActionIntents: (sc, id) => store.listActionIntents(sc, id),
      metricDirectionality: async (_sc, key) => ({ ok: true, value: metrics.metric(key)?.directionality ?? null }),
      valueSensitivity: async (_sc, key) => ({ ok: true, value: sensitivityOfMetric(key) }),
    };
    hc = unwrap(await assembleCommittedDecisions(source, s.scope)).find((d) => d.commitment.id === s.story.commitmentId);

    // Helm's intake and a genome that resolves execution episodes through it — composed as Helm's app composes them.
    intake = createExecutionOutcomeIntake({
      store: createInMemoryExecutionOutcomeStore({ clock: s.clock, idGen: seqIdGen('xo') }),
      decisions: s.decisionStore,
      sensitivity: { known: SENSITIVITY_ORDER, ofMetric: sensitivityOfMetric },
    });
    genome = createManagementGenome({
      store: createInMemoryGenomeStore({ clock: s.clock, idGen: seqIdGen('gf') }),
      clock: s.clock,
      sources: { graph: s.graph, decisions: s.decisionStore, scenarios: s.scenarios, authority: s.authority, twin: s.twin, causal: s.causal, counterfactual: s.counterfactual, executions: intake },
    });

    const clock = manualClock('2026-09-25T09:00:00.000Z');
    forge = createForgeRuntime({ store: createInMemoryStore(clock), candidates: createInMemoryCandidateStore(clock), clock, ids: sequentialIds() });
    const role = (label) => ({ kind: 'ROLE', label, ref: null });
    gm = { orgId: s.scope.orgId, actor: { kind: 'PERSON', id: s.scope.actorId, label: 'Country GM' }, role: 'admin', clearances: 'ALL', actsAs: [role(hc.decision.owner.label), role(hc.commitment.committedBy.label)] };

    const proposed = unwrap(await proposeIntake(forge, gm, unwrap(await draftFromHelm(gm, hc))));
    outcomeId = proposed.outcome.record.id;
    unwrap(await forge.accept(gm, outcomeId));

    clock.set('2026-11-18T09:00:00.000Z');
    const observations = hc.commitment.expectedOutcomes
      .filter((o) => o.kind === 'MODELLED' && o.nodeId && ACTUALS[o.metricKey])
      .map((o) => ({
        id: `helm-observation:${o.nodeId}`,
        system: 'helm',
        eventType: 'value.actual_observed',
        objectRef: helmValueRef(o.nodeId, o.period?.start ?? null),
        entityRef: null,
        occurredAt: '2026-11-18T08:00:00.000Z',
        payload: { metricKey: o.metricKey, value: ACTUALS[o.metricKey] },
        summary: `${o.label}: actual ${ACTUALS[o.metricKey]} (finance source actual, recorded by Helm)`,
        url: null,
        protection: o.sensitivity ?? [],
      }));
    unwrap(await ingestObservations(forge, gm.orgId, observations));

    clock.set('2026-11-20T08:00:00.000Z');
    unwrap(await forge.change(gm, outcomeId, { kind: 'CLOSE', resolution: 'PARTIALLY_FULFILLED', supersededBy: null, confirmedWithoutEvidence: false }, 'Two of twelve units arrived nine days after the date Rohto was promised.'));
    unwrap(await forge.recordOutcome(gm, outcomeId, {
      statement: 'Rohto received all twelve units; two arrived nine days late after a QC hold. Margin and cash landed below the committed future.',
      achievedOn: '2026-10-24',
      measures: [
        ...Object.entries(ACTUALS).map(([key, actual]) => ({ key, actual, note: null })),
        { key: 'framework-relationship', actual: null, note: 'The 2027 framework renewal opened; the late units were raised and not made a condition.' },
      ],
      realizedValue: [],
      basis: [],
    }));
    unwrap(await forge.recordLearning(gm, outcomeId, { kind: 'EXPLANATION', statement: 'Transferred consignment units needed a QC re-release the plan did not allow for.', appliesTo: null }));
    publication = unwrap(await forge.publishOutcome(gm, outcomeId)).publication;
    const view = unwrap(await forge.view(gm, outcomeId));
    submission = toHelmExecutionOutcome(publication, { orgId: s.scope.orgId, publishedByLabel: 'Country GM Vietnam', authority: publicationAuthority(view) });
  });

  test('Forge reads Helm’s committed decision through Helm’s own store — and Helm’s classes come with it', () => {
    assert.ok(hc, 'the canonical Rohto commitment is visible');
    assert.equal(hc.commitment.fingerprint, submission.decisionCommitment.fingerprint);
    assert.equal(hc.actionIntents.length, 3);
    const margin = hc.commitment.expectedOutcomes.find((o) => o.metricKey === 'GrossMarginPct');
    assert.equal(margin.betterWhen, 'HIGHER', 'directionality from Helm’s value registry');
    assert.deepEqual(margin.sensitivity, FIN, 'sensitivity from Helm’s twin runtime');
  });

  test('the publication is verified, carries Helm’s classes, and becomes contextual facts — none less protected', () => {
    assert.deepEqual(publication.protection, FIN);
    const margin = submission.facts.find((f) => f.metric.key === 'GrossMarginPct');
    assert.equal(margin.value, '31.421');
    assert.equal(margin.provenance.basis, 'SYSTEM_RECORD');
    assert.deepEqual(margin.sensitivity, FIN);
    assert.equal(margin.unit, 'percentage', 'in Helm’s own unit vocabulary');
    assert.equal(submission.facts.find((f) => f.metric.key === 'DemandCoverage').sensitivity.length, 0);
    assert.deepEqual(submission.authority, { policy: 'forge-interim-authority@1', trusted: false }, 'the authority context, as it was');
    assert.equal(helmCommitmentOf(publication), s.story.commitmentId);
  });

  test('Helm’s intake refuses a lowered class and another version of the commitment — then receives the honest outcome, once', async () => {
    const lowered = { ...submission, facts: submission.facts.map((f) => (f.metric.key === 'GrossMarginPct' ? { ...f, sensitivity: [] } : f)) };
    const r1 = await intake.submit(s.scope, lowered, 'Country GM Vietnam');
    assert.equal(r1.ok, false);
    assert.match(r1.error.message, /never becomes less protected/);
    const stale = await intake.submit(s.scope, { ...submission, decisionCommitment: { ...submission.decisionCommitment, fingerprint: 'dfp_0000000000000000_1' } }, 'Country GM Vietnam');
    assert.equal(stale.ok, false);
    const received = unwrap(await intake.submit(s.scope, submission, 'Country GM Vietnam'));
    assert.equal(received.duplicate, false);
    assert.deepEqual(received.receipt.sensitivityClasses, FIN);
    receipt = received.receipt;
    assert.equal(unwrap(await intake.submit(s.scope, submission, 'Country GM Vietnam')).duplicate, true, 'idempotent');
  });

  test('a Helm manager adopts it: Helm’s decision runtime records the review and computes the variance itself', async () => {
    review = unwrap(await s.decisionsRuntime.recordOutcomeReview(s.scope, receipt.commitmentId, intake.adoptionInput(receipt, 'Country GM Vietnam')));
    unwrap(await intake.recordAdoption(s.scope, receipt.id, review, 'Country GM Vietnam'));
    const margin = review.variances.find((v) => v.metricKey === 'GrossMarginPct');
    assert.equal(margin.expected, '32.3878');
    assert.equal(margin.actual, '31.421');
    assert.equal(margin.variance, '-0.9668', 'Helm’s own decimal arithmetic agrees with Forge’s');
    assert.match(review.notes, new RegExp(publication.fingerprint), 'the review names the Forge publication it was adopted from');
  });

  test('Helm’s genome binds the review and a typed, pinned reference to the Forge execution episode; its pattern logic reads the actual', async () => {
    const episodeId = unwrap(await genome.openEpisode(s.scope, {
      decisionId: s.story.decisionId,
      title: 'Rohto Q4 allocation — executed through Forge',
      scope: { kind: 'ENTERPRISE_WIDE', justification: 'Integration proof of the Forge → Helm memory loop.' },
      authoredByLabel: 'Country GM Vietnam',
    })).episode.id;
    unwrap(await genome.bindRef(s.scope, episodeId, 'OUTCOME_REVIEW', { kind: 'OUTCOME_REVIEW', id: review.id, pin: publication.fingerprint, label: 'Outcome review adopted from Forge' }));
    const bound = unwrap(await genome.bindRef(s.scope, episodeId, 'EXECUTION_EPISODE', toHelmExecutionEpisodeRef(publication)));
    assert.match(JSON.stringify(bound), new RegExp(publication.episode.fingerprint));

    const pattern = unwrap(await genome.proposePattern(s.scope, {
      title: 'Margin lands below the committed margin on consignment reallocations',
      scope: { kind: 'ENTERPRISE_WIDE', justification: 'Integration proof.' },
      conditions: { expectedMetric: ['GrossMarginPct'] },
      characteristic: { kind: 'OUTCOME_VS_EXPECTATION', metricKey: 'GrossMarginPct', direction: 'ACTUAL_BELOW_EXPECTED' },
      statement: 'Reallocations of consignment stock have landed below the committed gross margin.',
      limitations: 'One episode; a test.',
      authoredByLabel: 'Country GM Vietnam',
    }));
    const text = JSON.stringify(unwrap(await genome.classifyEpisode(s.scope, pattern.pattern?.id ?? pattern.id, episodeId)));
    assert.match(text, /SUPPORTS/, 'Helm observes the characteristic in the episode');
    assert.match(text, /31\.421/, 'from the actual Forge verified');

    const generic = await genome.bindRef(s.scope, episodeId, 'EXECUTION_EPISODE', { kind: 'SOURCE_DOCUMENT', id: publication.episode.ref, pin: publication.fingerprint, label: 'a URL' });
    assert.equal(generic.ok, false, 'not a generic document reference');
    const repinned = await genome.bindRef(s.scope, episodeId, 'EXECUTION_EPISODE', { ...toHelmExecutionEpisodeRef(publication), pin: 'fep_ffffffffffffffff' });
    assert.match(repinned.error.message, /referenced as received/);
  });

  test('the publication also travels in Helm’s source-event envelope, with its own idempotency key', async () => {
    const published = outboundEvents(unwrap(await forge.list(gm))).filter((e) => e.eventType === 'outcome.published');
    assert.equal(published.length, 1);
    assert.equal(published[0].sourceSystem, 'forge');
    assert.equal(published[0].payload.publication.fingerprint, publication.fingerprint);
  });
});
