/**
 * Loop 1 — HELM decision → FORGE commitment, through the shared database.
 *
 * One Postgres (PGlite) carries Supabase's baseline, Helm's nineteen real
 * migrations and Forge's own, in the order the shared project receives them.
 *
 * Helm's canonical Rohto decision (built by Helm's own harness) is written into
 * it by Helm's own PostgresDecisionStore, as the Country GM, under Helm's
 * row-level security. Helm ids are database ids there, so every reference is
 * mapped, and the commitment fingerprint is recomputed by Helm's own
 * `commitmentFingerprint` over what was actually stored. Scenario runs are not
 * replayed: the four modelled alternatives are recorded as unmodelled, with the
 * reason. Nothing else about the decision changes.
 *
 * Forge then reads it exactly as it will in production — Helm's tables, through
 * a signed-in person's session — and drafts, proposes and runs the commitments
 * in its own tables of the same database. Helm decides who sees what: the
 * decision's visibility, and the clearance on financial values.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createForgeRuntime, sequentialIds, unwrap } from '@forge/kernel';
import { createPostgresStore, createSqlTableClient } from '@forge/kernel/postgres';
import {
  assembleCommittedDecisions,
  createHelmTableSource,
  createHelmValueSurface,
  draftFromHelm,
  HELM_READ_CONTRACT,
  HELM_VALUE_READ_CONTRACT,
  helmScopeOf,
  helmValueRef,
  ingestObservations,
  proposeIntake,
  decisionFidelity,
  deliverOutcomes,
  helmReceivedFingerprints,
  pendingDeliveries,
  publicationAuthority,
  toHelmExecutionEpisodeRef,
  toHelmExecutionOutcome,
} from '@forge/fabric';
import { ecosystemDatabase, runnerAs, seedOrganization } from './support/database.mjs';
import { postgrestClient } from './support/postgrest.mjs';
import { fromSibling, HELM, helmSkip } from './support/siblings.mjs';

const OTHER_ORG = '20000000-0000-4000-8000-0000000000f1';
const SCM = '30000000-0000-4000-8000-00000000005c';
const OUTSIDER = '30000000-0000-4000-8000-0000000000f1';
const SCM_UNIT = '40000000-0000-4000-8000-00000000005c';
const COMMERCIAL_UNIT = '40000000-0000-4000-8000-0000000000cd';
const REPLAY_REASON = 'Modelled in Helm’s canonical harness; its scenario run is not replayed into this database.';
const clock = { now: () => new Date().toISOString() };

/** A copy without the fields a store assigns itself. */
const without = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/** Replace every mapped id, wherever it sits in a JSON value. */
const remap = (v, ids) =>
  typeof v === 'string' ? (ids.get(v) ?? v)
    : Array.isArray(v) ? v.map((x) => remap(x, ids))
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x, ids)]))
        : v;

describe('Loop 1 — a Helm decision becomes Forge commitments, through the shared database and Helm’s own rules', { skip: helmSkip }, () => {
  let db;
  let s; // Helm's canonical stack (in memory) — the source of the decision
  let ORG;
  let GM; // Country GM, org admin
  let CD; // Commercial Director, who committed the decision
  let helmPg; // Helm's own Postgres decision store, as the GM
  let helmScope; // the GM, as Helm reads them
  let replayed; // { decisionId, commitmentId, fingerprint, nodes }
  let forgeAs; // uid -> Forge runtime writing as that person
  let scopeOf; // uid -> Forge scope

  before(async () => {
    const harness = await fromSibling(HELM, 'packages/genome-runtime/test/harness.mjs');
    s = await harness.buildGenomeStack();
    ORG = s.scope.orgId;
    helmScope = s.scope;
    GM = s.scope.actorId;
    const mem = s.decisionStore;
    const sc = s.scope;
    const d = unwrap(await mem.getDecision(sc, s.story.decisionId));
    const c = unwrap(await mem.getCommitment(sc, s.story.commitmentId));
    CD = c.committedBy;

    db = await ecosystemDatabase();
    await seedOrganization(db, { orgId: ORG, name: 'Meridian Vietnam', members: [{ uid: GM, role: 'admin' }, { uid: CD, role: 'manager' }, { uid: SCM, role: 'member' }] });
    await seedOrganization(db, { orgId: OTHER_ORG, name: 'Another company', members: [{ uid: OUTSIDER, role: 'admin' }] });
    await db.query("INSERT INTO public.org_units (id, org_id, name, unit_type) VALUES ($1, $2, 'Supply Chain Vietnam', 'department')", [SCM_UNIT, ORG]);
    await db.query("INSERT INTO public.org_units (id, org_id, name, unit_type) VALUES ($1, $2, 'Commercial Vietnam', 'department')", [COMMERCIAL_UNIT, ORG]);
    await db.query('INSERT INTO public.org_unit_memberships (unit_id, org_id, user_id) VALUES ($1, $2, $3), ($4, $2, $5)', [SCM_UNIT, ORG, SCM, COMMERCIAL_UNIT, CD]);

    // ---------------------------------------------- Helm writes its decision
    const { createPostgresDecisionStore } = await import('@helm/decision-runtime/postgres');
    const { commitmentFingerprint } = await import('@helm/decision-runtime');
    const gmRest = postgrestClient(runnerAs(db, 'authenticated', GM));
    helmPg = createPostgresDecisionStore({ client: gmRest, clock: { now: () => new Date() } });
    const ids = new Map();

    const decision = unwrap(await helmPg.createDecision(sc, { ...without(d, 'id', 'orgId', 'createdAt', 'updatedAt'), state: 'DRAFT', createdBy: null }));
    ids.set(d.id, decision.id);
    for (const state of ['INVESTIGATING', 'READY_FOR_DECISION']) unwrap(await helmPg.setDecisionState(sc, decision.id, state));
    // Helm shows a decision to its creator, admins and the units it is shared with; the Commercial Director commits it.
    const shared = await gmRest.from('helm_decision_visibility').insert({
      org_id: ORG, decision_id: decision.id, org_unit_id: COMMERCIAL_UNIT, org_unit_label: 'Commercial Vietnam', reason: 'Commercial owns the customer promise.', granted_by: GM,
    });
    assert.equal(shared.error, null, shared.error?.message);

    const rev = unwrap(await mem.getRevision(sc, c.revisionId));
    const revision = unwrap(await helmPg.createRevision(sc, {
      decisionId: decision.id, revisionNumber: 1, state: 'DRAFT', reason: rev.reason, basedOnRevisionId: null,
      reconsidersCommitmentId: null, reconsiderationReason: null, fork: rev.fork, notes: rev.notes, createdBy: null,
    }));
    ids.set(rev.id, revision.id);

    for (const a of unwrap(await mem.listAlternatives(sc, rev.id))) {
      const alt = unwrap(await helmPg.addAlternative(sc, {
        decisionId: decision.id, revisionId: revision.id, label: a.label, description: a.description,
        status: a.status === 'WITHDRAWN' ? 'WITHDRAWN' : 'UNMODELLED', scenarioId: null, scenarioRevisionId: null, scenarioRunId: null,
        unmodelledReason: a.unmodelledReason ?? REPLAY_REASON, sort: a.sort, createdBy: null, metadata: a.metadata,
      }));
      ids.set(a.id, alt.id);
    }
    for (const a of unwrap(await mem.listAssumptions(sc, rev.id))) {
      const added = unwrap(await helmPg.addAssumption(sc, {
        ...without(a, 'id', 'orgId', 'createdAt'), decisionId: decision.id, revisionId: revision.id, owner: a.owner ? { ...a.owner, userId: null } : null,
        alternativeIds: a.alternativeIds.map((x) => ids.get(x)), scenarioRevisionId: null, scenarioOverrideId: null, createdBy: null,
      }));
      ids.set(a.id, added.id);
    }

    // The value nodes the expected outcomes are about, in Helm's value graph (GM, under RLS).
    const nodes = {};
    for (const o of c.expectedOutcomes.filter((x) => x.nodeId)) {
      const { data, error } = await gmRest.from('helm_value_nodes').insert({
        org_id: ORG, metric_id: `vm_${o.metricKey.toLowerCase()}`, scope_kind: 'customer', scope_ref: 'rohto', time_horizon: 'quarter', label: o.label,
      }).select('id').single();
      assert.equal(error, null, `value node for ${o.metricKey}: ${error?.message}`);
      ids.set(o.nodeId, data.id);
      nodes[o.metricKey] = data.id;
    }

    const snap = unwrap(await mem.getSnapshot(sc, c.snapshotId));
    const snapshot = unwrap(await helmPg.createSnapshot(sc, {
      decisionId: decision.id, revisionId: revision.id, capturedAt: snap.capturedAt, fork: snap.fork, modelRef: snap.modelRef,
      alternatives: remap(snap.alternatives, ids), criterionIds: [], assumptionIds: snap.assumptionIds.map((x) => ids.get(x)),
      challengeIds: [], evidenceIds: [], criterionEvaluations: remap(snap.criterionEvaluations, ids), openChallenges: [], fingerprint: snap.fingerprint,
    }));

    const body = {
      decisionId: decision.id, revisionId: revision.id, chosenAlternativeId: ids.get(c.chosenAlternativeId), authorship: c.authorship,
      rationale: c.rationale, acceptedTradeOffs: c.acceptedTradeOffs, expectedOutcomes: remap(c.expectedOutcomes, ids), reviewTriggers: c.reviewTriggers,
    };
    const fingerprint = commitmentFingerprint({ orgId: ORG, snapshotFingerprint: snapshot.fingerprint, ...body });
    const cdRest = postgrestClient(runnerAs(db, 'authenticated', CD));
    const commitment = unwrap(await createPostgresDecisionStore({ client: cdRest, clock: { now: () => new Date() } }).createCommitment({ ...sc, actorId: CD }, {
      ...body, committedBy: CD, committedByLabel: c.committedByLabel, committedAt: c.committedAt, summary: c.summary,
      authorityStatus: c.authorityStatus, fingerprint, snapshotId: snapshot.id,
    }));
    unwrap(await helmPg.sealRevision(sc, revision.id));
    unwrap(await helmPg.setDecisionState(sc, decision.id, 'COMMITTED'));
    for (const i of unwrap(await mem.listActionIntents(sc, c.id))) {
      unwrap(await helmPg.addActionIntent(sc, {
        decisionId: decision.id, commitmentId: commitment.id, title: i.title, detail: i.detail, ownerLabel: i.ownerLabel,
        ownerUserId: null, dueDate: i.dueDate, status: i.status, targetSystem: i.targetSystem, handoffRef: null,
      }));
    }
    replayed = { decisionId: decision.id, commitmentId: commitment.id, fingerprint, summary: c.summary, nodes, original: c };

    // ----------------------------------------------------------- Forge, per person
    const people = { [GM]: 'Country GM', [CD]: 'Commercial Director', [SCM]: 'Supply Chain Director', [OUTSIDER]: 'Someone elsewhere' };
    const roleOf = { [GM]: ['Country GM Vietnam', c.committedByLabel], [CD]: [c.committedByLabel], [SCM]: ['Supply Chain Director Vietnam'], [OUTSIDER]: [] };
    scopeOf = (uid, orgId = ORG) => ({
      orgId, actor: { kind: 'PERSON', id: uid, label: people[uid] }, role: uid === GM ? 'admin' : 'member',
      actsAs: roleOf[uid].map((label) => ({ kind: 'ROLE', label, ref: null })),
    });
    const stores = new Map([GM, CD, SCM, OUTSIDER].map((uid) => [uid, createPostgresStore(createSqlTableClient(runnerAs(db, 'authenticated', uid)))]));
    const connector = createPostgresStore(createSqlTableClient(runnerAs(db, 'service_role', null)));
    const ids2 = sequentialIds();
    const route = (m) => (scope, ...a) => (scope.actor.kind === 'PERSON' ? stores.get(scope.actor.id) : connector)[m](scope, ...a);
    const store = Object.fromEntries(['insertCommitment', 'appendEvents', 'getCommitment', 'listCommitments', 'eventsFor', 'findByIdempotencyKey'].map((m) => [m, route(m)]));
    const runtime = createForgeRuntime({ store, clock, ids: ids2 });
    forgeAs = () => runtime;
  });

  const helmSourceAs = (uid) => createHelmTableSource(createSqlTableClient(runnerAs(db, 'authenticated', uid)));

  test('every Helm column Forge reads is one Helm’s own adapter reads, and exists in Helm’s schema', async () => {
    const adapter = readFileSync(join(HELM, 'packages/decision-runtime/src/postgres.ts'), 'utf8');
    const helmCols = (name) => {
      const m = adapter.match(new RegExp(`const ${name} =\\s*((?:'[^']*'\\s*\\+?\\s*)+);`));
      assert.ok(m, `${name} in Helm’s adapter`);
      return new Set([...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('').split(',').map((x) => x.trim()));
    };
    const adapterOf = { helm_decisions: 'DECISION_COLS', helm_decision_commitments: 'COMMITMENT_COLS', helm_decision_alternatives: 'ALTERNATIVE_COLS', helm_decision_assumptions: 'ASSUMPTION_COLS', helm_actions: 'INTENT_COLS' };
    for (const [table, cols] of Object.entries(HELM_READ_CONTRACT)) {
      const theirs = helmCols(adapterOf[table]);
      for (const col of cols) assert.ok(theirs.has(col), `${table}.${col} is read by Helm’s own adapter`);
    }
    for (const [table, cols] of Object.entries({ ...HELM_READ_CONTRACT, ...HELM_VALUE_READ_CONTRACT })) {
      const { rows } = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [table]);
      const present = new Set(rows.map((r) => r.column_name));
      for (const col of cols) assert.ok(present.has(col), `${table}.${col} exists in Helm’s migrated schema`);
    }
  });

  test('Forge reads the committed decision from Helm’s tables, as the GM, exactly as Helm recorded it', async () => {
    const all = unwrap(await assembleCommittedDecisions(helmSourceAs(GM), helmScopeOf(scopeOf(GM))));
    assert.equal(all.length, 1);
    const hc = all[0];
    assert.equal(hc.commitment.id, replayed.commitmentId);
    assert.equal(hc.commitment.fingerprint, replayed.fingerprint, 'the fingerprint Helm computed over what it stored');
    assert.equal(hc.commitment.summary, replayed.summary);
    assert.equal(hc.commitment.committedBy.label, 'Commercial Director Vietnam');
    assert.equal(hc.commitment.chosenAlternative.label, 'B — Reallocate distributor stock');
    assert.equal(hc.actionIntents.length, 3);
    assert.equal(hc.assumptions.length, 5);
    assert.equal(hc.demo, replayed.original.authorship === 'MANAGEMENT_AUTHORED_DEMO', 'Helm’s authorship travels: demo is labelled demo');
    const margin = hc.commitment.expectedOutcomes.find((o) => o.metricKey === 'GrossMarginPct');
    assert.equal(margin.nodeId, replayed.nodes.GrossMarginPct, 'the node is Helm’s database node');
    assert.equal(margin.expectedValue, '32.3878');
    assert.equal(margin.betterWhen, 'HIGHER', 'directionality from Helm’s metric table');
    assert.equal(margin.period.start, '2026-10-01T00:00:00.000Z');
  });

  test('another organization sees none of it — in Helm or in Forge', async () => {
    assert.equal(unwrap(await assembleCommittedDecisions(helmSourceAs(OUTSIDER), helmScopeOf(scopeOf(OUTSIDER, OTHER_ORG)))).length, 0);
    assert.equal(unwrap(await assembleCommittedDecisions(helmSourceAs(OUTSIDER), helmScopeOf(scopeOf(OUTSIDER)))).length, 0, 'not even by naming the org');
  });

  describe('the GM takes it into Forge; Helm’s visibility decides who sees the execution', () => {
    let outcomeId;
    let scmIntentId;

    before(async () => {
      const gm = scopeOf(GM);
      const [hc] = unwrap(await assembleCommittedDecisions(helmSourceAs(GM), helmScopeOf(gm)));
      const draft = unwrap(await draftFromHelm(gm, hc));
      const proposed = unwrap(await proposeIntake(forgeAs(GM), gm, draft));
      outcomeId = proposed.outcome.record.id;
      scmIntentId = proposed.intents.find((v) => v.terms.owner.label === 'Supply Chain Director Vietnam')?.record.id;
      unwrap(await forgeAs(GM).accept(gm, outcomeId));
    });

    test('the commitments live in Forge’s tables, linked to Helm’s commitment and pinned to its fingerprint', async () => {
      const { rows } = await db.query('SELECT id, origin_ref, helm_decision_id, parent_id FROM public.forge_commitments ORDER BY id');
      assert.equal(rows.length, 4, 'the outcome and three action intents');
      for (const r of rows) assert.equal(r.helm_decision_id, replayed.decisionId, 'derived by the database from Helm’s own row');
      const outcome = unwrap(await forgeAs(GM).view(scopeOf(GM), outcomeId));
      assert.equal(outcome.record.origin.ref, `helm:decision-commitment:${replayed.commitmentId}`);
      assert.equal(outcome.record.origin.fingerprint, replayed.fingerprint);
      assert.equal(outcome.phase, 'ACTIVE');
    });

    test('a member Helm does not show the decision to sees neither the decision nor its execution', async () => {
      assert.equal(unwrap(await assembleCommittedDecisions(helmSourceAs(SCM), helmScopeOf(scopeOf(SCM)))).length, 0);
      assert.equal(unwrap(await forgeAs(SCM).list(scopeOf(SCM))).length, 0);
      const accept = await forgeAs(SCM).accept(scopeOf(SCM), scmIntentId);
      assert.equal(accept.ok, false, 'nor can they act on it');
      const { rows } = await runnerAs(db, 'authenticated', SCM)('SELECT count(*)::int AS n FROM public.forge_commitment_events', []);
      assert.equal(rows[0].n, 0, 'not even the events');
    });

    test('a Forge commitment cannot claim a Helm origin that does not exist', async () => {
      const gm = scopeOf(GM);
      const forged = await forgeAs(GM).propose(gm, {
        origin: { kind: 'DECISION', system: 'helm', ref: 'helm:decision-commitment:00000000-0000-4000-8000-000000000000', label: 'Nothing', fingerprint: null, snapshot: null },
        terms: { statement: 'A commitment to nothing Helm decided.', intendedOutcome: 'Nothing.', why: 'A test.', owner: gm.actsAs[0], principal: gm.actsAs[0], dueBy: '2026-12-31', evidence: [], measures: [], value: [] },
      });
      assert.equal(forged.ok, false);
      assert.equal(forged.error.code, 'commitment.origin_not_found', forged.error.message);
    });

    test('when the GM shares the decision with Supply Chain in Helm, Supply Chain sees and acts in Forge', async () => {
      const { error } = await postgrestClient(runnerAs(db, 'authenticated', GM)).from('helm_decision_visibility').insert({
        org_id: ORG, decision_id: replayed.decisionId, org_unit_id: SCM_UNIT, org_unit_label: 'Supply Chain Vietnam',
        reason: 'Supply Chain executes the reallocation.', granted_by: GM,
      });
      assert.equal(error, null, error?.message);
      assert.equal(unwrap(await assembleCommittedDecisions(helmSourceAs(SCM), helmScopeOf(scopeOf(SCM)))).length, 1);
      const seen = unwrap(await forgeAs(SCM).list(scopeOf(SCM)));
      assert.equal(seen.length, 4);
      const accepted = unwrap(await forgeAs(SCM).accept(scopeOf(SCM), scmIntentId));
      assert.equal(accepted.phase, 'ACTIVE');
      assert.equal(accepted.acceptance.actor.id, SCM);
    });

    describe('Helm’s actuals prove the outcome — read with Helm’s clearance rules', () => {
      before(async () => {
        const gmRest = postgrestClient(runnerAs(db, 'authenticated', GM));
        const actual = (metric, value, unit, currency = null) => ({
          org_id: ORG, node_id: replayed.nodes[metric], observation_type: 'ACTUAL', numeric_value: value, unit_type: unit, currency,
          period_start: '2026-10-01T00:00:00.000Z', period_end: '2027-01-01T00:00:00.000Z', observed_at: clock.now(), source_system: 'finance',
        });
        for (const row of [actual('GrossMarginPct', '31.421', 'percentage'), actual('DemandCoverage', '100', 'percentage'), actual('CashImpact', '-1768300000', 'currency', 'VND')]) {
          const { error } = await gmRest.from('helm_value_observations').insert(row);
          assert.equal(error, null, error?.message);
        }
      });

      test('a member without Helm’s financial clearance does not see the margin actual through Forge’s surface', async () => {
        const seen = await createHelmValueSurface(createSqlTableClient(runnerAs(db, 'authenticated', SCM)), ORG).pull(null, clock.now());
        assert.deepEqual(seen.map((o) => o.payload.metricKey).sort(), ['DemandCoverage']);
      });

      test('read as the GM, the actuals land as system evidence on the very node and period Helm committed to', async () => {
        const seen = await createHelmValueSurface(createSqlTableClient(runnerAs(db, 'authenticated', GM)), ORG).pull(null, clock.now());
        assert.equal(seen.length, 3);
        const margin = seen.find((o) => o.payload.metricKey === 'GrossMarginPct');
        assert.equal(margin.objectRef, helmValueRef(replayed.nodes.GrossMarginPct, '2026-10-01T00:00:00.000Z'));
        assert.equal(margin.payload.value, '31.421', 'exact decimal, as Helm stored it');
        unwrap(await ingestObservations(forgeAs(GM), ORG, seen));
        const v = unwrap(await forgeAs(GM).view(scopeOf(GM), outcomeId));
        const req = v.requirements.find((r) => r.requirement.matcher?.objectRef === margin.objectRef);
        assert.ok(req, 'the outcome watches the margin node');
        assert.equal(req.status, 'EVIDENCED');
        assert.equal(req.basis, 'SYSTEM');
      });

      test('a value Helm restricts stays restricted once it is Forge evidence — Helm’s clearance decides, in Forge’s tables', async () => {
        const theirs = unwrap(await forgeAs(SCM).view(scopeOf(SCM), outcomeId));
        const margin = theirs.evidence.find((e) => e.item.source.ref === helmValueRef(replayed.nodes.GrossMarginPct, '2026-10-01T00:00:00.000Z'));
        assert.ok(margin, 'Supply Chain sees that Helm proved the margin');
        assert.doesNotMatch(margin.item.statement, /31\.421/);
        assert.deepEqual(margin.item.withheld, ['FINANCIAL_SENSITIVE']);
        assert.equal(theirs.requirements.find((r) => r.requirement.matcher?.objectRef === margin.item.source.ref).status, 'EVIDENCED', 'the same status for every reader');
        const coverage = theirs.evidence.find((e) => e.item.source.ref === helmValueRef(replayed.nodes.DemandCoverage, '2026-10-01T00:00:00.000Z'));
        assert.match(coverage.item.statement, /100/, 'a general-management value is not withheld');
        const { rows } = await runnerAs(db, 'authenticated', SCM)('SELECT count(*)::int AS n FROM public.forge_sealed_values', []);
        assert.equal(rows[0].n, 0, 'the sealed values are out of reach in the database itself');
        const onTheRow = await runnerAs(db, 'authenticated', SCM)("SELECT payload::text AS p FROM public.forge_commitment_events WHERE event_type = 'EVIDENCE_RECORDED'", []);
        assert.ok(onTheRow.rows.every((r) => !/31\.421/.test(r.p)), 'nothing protected remains on the event row');
      });

      test('when Helm clears Supply Chain for financial values, Forge shows them the margin — Helm’s grant, not Forge’s', async () => {
        await db.query("INSERT INTO public.helm_sensitivity_clearances (org_id, user_id, sensitivity, valid_from, reason, granted_by) VALUES ($1, $2, 'FINANCIAL_SENSITIVE', now() - interval '1 minute', 'Supply Chain reviews the margin of reallocations.', $3)", [ORG, SCM, GM]);
        const theirs = unwrap(await forgeAs(SCM).view(scopeOf(SCM), outcomeId));
        const margin = theirs.evidence.find((e) => e.item.source.ref === helmValueRef(replayed.nodes.GrossMarginPct, '2026-10-01T00:00:00.000Z'));
        assert.match(margin.item.statement, /31\.421/);
        assert.equal(margin.item.withheld, undefined);
      });
    });

    describe('Forge publishes; Helm’s governed intake receives it — on Postgres, under Helm’s own guards and clearance', () => {
      let submission;
      let intake;
      let receipt;
      let helmRuntime;
      let publication;
      let gmRest;

      before(async () => {
        const gm = scopeOf(GM);
        unwrap(await forgeAs(GM).change(gm, outcomeId, { kind: 'CLOSE', resolution: 'PARTIALLY_FULFILLED', supersededBy: null, confirmedWithoutEvidence: false }, 'Two of twelve units arrived nine days after the date Rohto was promised.'));
        unwrap(await forgeAs(GM).recordOutcome(gm, outcomeId, {
          statement: 'Rohto received all twelve units; margin and cash landed below the committed future.',
          achievedOn: '2026-10-24',
          measures: [
            { key: 'GrossMarginPct', actual: '31.421', note: null },
            { key: 'DemandCoverage', actual: '100', note: null },
            { key: 'CashImpact', actual: '-1768300000', note: null },
          ],
          realizedValue: [],
          basis: [],
        }));
        publication = unwrap(await forgeAs(GM).publishOutcome(gm, outcomeId)).publication;
        submission = toHelmExecutionOutcome(publication, { orgId: ORG, publishedByLabel: 'Country GM Vietnam', authority: publicationAuthority(unwrap(await forgeAs(GM).view(gm, outcomeId))) });
        const { SENSITIVITY_ORDER, sensitivityOfMetric } = await import('@helm/twin-runtime');
        const { createExecutionOutcomeIntake } = await import('@helm/integration-runtime');
        const { createPostgresExecutionOutcomeStore } = await import('@helm/integration-runtime/postgres');
        const { createDecisionRuntime } = await import('@helm/decision-runtime');
        gmRest = postgrestClient(runnerAs(db, 'authenticated', GM));
        intake = createExecutionOutcomeIntake({ store: createPostgresExecutionOutcomeStore({ client: gmRest }), decisions: helmPg, sensitivity: { known: SENSITIVITY_ORDER, ofMetric: sensitivityOfMetric } });
        // Helm's decision runtime over Helm's Postgres store; recording an outcome review touches nothing else.
        helmRuntime = createDecisionRuntime({ store: helmPg, scenarios: {}, clock: { now: () => new Date() } });
      });

      const receiptRow = (over = {}) => ({
        org_id: ORG,
        decision_id: replayed.decisionId,
        commitment_id: replayed.commitmentId,
        source_system: 'forge',
        contract: 'helm.execution-outcome.v1',
        publication_fingerprint: 'fop_00000000000000aa',
        publication: submission.publication,
        episode_ref: submission.episode.ref,
        episode_fingerprint: submission.episode.fingerprint,
        commitment_fingerprint: submission.decisionCommitment.fingerprint,
        resolution: submission.resolution,
        achieved_on: submission.achievedOn,
        closed_at: submission.closedAt,
        facts: submission.facts,
        narrative: submission.narrative,
        sensitivity_classes: submission.sensitivity,
        sender_authority: submission.authority,
        submitted_by: GM,
        submitted_by_label: 'Country GM Vietnam',
        ...over,
      });

      test('a client that goes around the intake gets nowhere: Helm’s database refuses a lowered class and another commitment version', async () => {
        const lowered = submission.facts.map((f) => (f.metric.key === 'GrossMarginPct' ? { ...f, sensitivity: [] } : f));
        const a = await gmRest.from('helm_execution_outcomes').insert(receiptRow({ facts: lowered, sensitivity_classes: ['FINANCIAL_SENSITIVE'] }));
        assert.match(a.error?.message ?? '', /arrived without FINANCIAL_SENSITIVE/);
        const b = await gmRest.from('helm_execution_outcomes').insert(receiptRow({ commitment_fingerprint: 'dfp_0000000000000000_1' }));
        assert.match(b.error?.message ?? '', /executed against commitment fingerprint/);
        const c = await gmRest.from('helm_execution_outcomes').insert(receiptRow({ sensitivity_classes: [] }));
        assert.match(c.error?.message ?? '', /labelled less restrictively/);
      });

      test('Forge delivers it through Helm’s intake host, in the principal’s own session; the receipt is read whole or not at all', async () => {
        // The transport as deployed: Forge derives what Helm has not received, and sends it to Helm's own host
        // (its edge function's code), which runs as the sender under Helm's rules. Forge writes nothing of Helm's.
        const { handleExecutionIntakeRequest } = await fromSibling(HELM, 'server/integration/executionIntakeHost.ts');
        const send = (body) => handleExecutionIntakeRequest({ caller: gmRest }, { userId: GM }, body);
        const gm = scopeOf(GM);
        const gmTables = createSqlTableClient(runnerAs(db, 'authenticated', GM));
        const views = unwrap(await forgeAs(GM).list(gm));
        assert.equal(pendingDeliveries(views, unwrap(await helmReceivedFingerprints(gmTables, gm)), ORG).length, 1, 'published, not yet received');
        // Where execution departed from the decision travels with the outcome (Helm ADR-0038), each at its classes.
        const [hc] = unwrap(await assembleCommittedDecisions(helmSourceAs(GM), helmScopeOf(gm)));
        const fidelity = decisionFidelity(hc, views);
        assert.ok(fidelity.departures.length > 0, 'the Rohto execution departed from the decision');
        const departuresOf = () => fidelity.departures;
        const delivered = unwrap(await deliverOutcomes({ scope: gm, views, received: unwrap(await helmReceivedFingerprints(gmTables, gm)), send, departuresOf }));
        assert.equal(delivered.length, 1);
        assert.equal(delivered[0].outcome, 'RECEIVED', JSON.stringify(delivered[0]));
        const stored = (await runnerAs(db, 'authenticated', GM)('SELECT departures, sensitivity_classes FROM public.helm_execution_outcomes', [])).rows[0];
        assert.equal(stored.departures.length, fidelity.departures.length, 'Helm keeps every departure, as received');
        const short = stored.departures.find((d) => d.kind === 'ENDED_SHORT');
        assert.match(short.reason, /nine days after/, 'the ending arrives with the reason given');
        assert.deepEqual(short.sensitivity, ['FINANCIAL_SENSITIVE'], 'written on a commitment measured by margin, it carries the margin’s class');
        for (const d of stored.departures) assert.ok(d.sensitivity.every((c) => stored.sensitivity_classes.includes(c)), 'no departure is less protected than the receipt');
        assert.equal(pendingDeliveries(views, unwrap(await helmReceivedFingerprints(gmTables, gm)), ORG).length, 0, 'nothing left to send once Helm holds the receipt');
        const dropped = unwrap(await deliverOutcomes({ scope: gm, views, received: new Set(), send }));
        assert.equal(dropped[0].duplicate, true, 'a sender that lost the answer sends again and Helm answers with the receipt it holds');
        const refusedBody = await send({ orgId: ORG, submission, sender: GM });
        assert.equal(refusedBody.status, 400, 'a body that names its own sender is refused by name');

        const received = unwrap(await intake.submit(helmScope, submission, 'Country GM Vietnam'));
        assert.equal(received.duplicate, true);
        receipt = received.receipt;
        assert.deepEqual(receipt.sensitivityClasses, ['FINANCIAL_SENSITIVE']);
        const count = async (uid, table) => (await runnerAs(db, 'authenticated', uid)(`SELECT count(*)::int AS n FROM public.${table}`, [])).rows[0].n;
        assert.equal(await count(GM, 'helm_execution_outcomes'), 1);
        assert.equal(await count(CD, 'helm_execution_outcomes'), 0, 'the Commercial Director sees the decision but is not cleared for its margin');
      });

      test('a manager adopts it: Helm’s runtime writes the review to Helm’s table — readable only by those Helm cleared', async () => {
        const review = unwrap(await helmRuntime.recordOutcomeReview(helmScope, receipt.commitmentId, intake.adoptionInput(receipt, 'Country GM Vietnam')));
        assert.equal(review.variances.find((v) => v.metricKey === 'GrossMarginPct').variance, '-0.9668');
        unwrap(await intake.recordAdoption(helmScope, receipt.id, review, 'Country GM Vietnam'));
        const count = async (uid, table) => (await runnerAs(db, 'authenticated', uid)(`SELECT count(*)::int AS n FROM public.${table}`, [])).rows[0].n;
        assert.equal(await count(GM, 'helm_decision_outcome_reviews'), 1);
        assert.equal(await count(CD, 'helm_decision_outcome_reviews'), 0, 'a review states the margin: decision visibility alone no longer opens it');
        assert.equal(await count(SCM, 'helm_decision_outcome_reviews'), 1, 'Supply Chain is shared the decision and cleared for financial values');
        assert.equal(await count(GM, 'helm_execution_outcome_adoptions'), 1);
      });

      describe('Helm learns from it: the Management Genome on Postgres binds the review and the pinned Forge execution episode', () => {
        let genome;
        let episodeId;
        let review;

        before(async () => {
          const { createManagementGenome } = await import('@helm/genome-runtime');
          const { createPostgresGenomeStore } = await import('@helm/genome-runtime/postgres');
          // Decisions, reviews and execution episodes come from Helm's Postgres; the graph and the rest stay Helm's harness —
          // an enterprise-wide episode reads no anchored entity, and this decision has no governance profile or scenario.
          genome = createManagementGenome({
            store: createPostgresGenomeStore({ client: gmRest }),
            clock: { now: () => new Date() },
            sources: { graph: s.graph, decisions: helmPg, scenarios: s.scenarios, authority: s.authority, twin: s.twin, causal: s.causal, counterfactual: s.counterfactual, executions: intake },
          });
          review = unwrap(await helmPg.listOutcomeReviews(helmScope, replayed.decisionId)).at(-1);
          episodeId = unwrap(await genome.openEpisode(helmScope, {
            decisionId: replayed.decisionId,
            title: 'Rohto Q4 allocation — executed through Forge',
            scope: { kind: 'ENTERPRISE_WIDE', justification: 'Integration proof of the Forge → Helm memory loop on Postgres.' },
            authoredByLabel: 'Country GM Vietnam',
          })).episode.id;
        });

        test('the episode carries the classes of what it is about, and binds the adopted review', async () => {
          const ep = unwrap(await genome.getEpisode(helmScope, episodeId)).episode;
          assert.equal(ep.commitmentId, replayed.commitmentId);
          assert.ok(ep.sensitivityClasses.includes('FINANCIAL_SENSITIVE'), 'an episode about the margin is financially sensitive');
          unwrap(await genome.bindRef(helmScope, episodeId, 'OUTCOME_REVIEW', { kind: 'OUTCOME_REVIEW', id: review.id, pin: publication.fingerprint, label: 'Outcome review adopted from Forge' }));
        });

        test('it binds a typed reference to the Forge execution episode, pinned as Helm received it', async () => {
          const bound = unwrap(await genome.bindRef(helmScope, episodeId, 'EXECUTION_EPISODE', toHelmExecutionEpisodeRef(publication)));
          assert.match(JSON.stringify(bound), new RegExp(publication.episode.fingerprint));
          const { rows } = await db.query("SELECT ref FROM public.helm_genome_episode_refs WHERE role = 'EXECUTION_EPISODE'");
          assert.equal(rows.length, 1);
          assert.deepEqual(rows[0].ref, toHelmExecutionEpisodeRef(publication), 'a reference and a pin — nothing of the history copied');
        });

        test('Helm’s database refuses what its runtime would — a generic document, a wrong pin, an episode it never received', async () => {
          const insert = (ref) => gmRest.from('helm_genome_episode_refs').insert({ org_id: ORG, episode_id: episodeId, role: 'EXECUTION_EPISODE', ref, note: null });
          const good = toHelmExecutionEpisodeRef(publication);
          const generic = await insert({ kind: 'SOURCE_DOCUMENT', id: `${good.id}#doc`, pin: null, label: 'a URL' });
          assert.match(generic.error?.message ?? '', /takes an execution episode/);
          const repinned = await insert({ ...good, pin: 'fep_ffffffffffffffff', label: 'repinned' });
          assert.match(repinned.error?.message ?? '', /referenced as received, pinned to fep_/, 'the guard, before any uniqueness');
          const unknown = await insert({ ...good, id: 'forge:commitment:never-published' });
          assert.match(unknown.error?.message ?? '', /has not received and adopted/);
        });

        test('its pattern logic reads the actual Forge verified — Helm’s learning, from Helm’s review', async () => {
          const pattern = unwrap(await genome.proposePattern(helmScope, {
            title: 'Margin lands below the committed margin on consignment reallocations',
            scope: { kind: 'ENTERPRISE_WIDE', justification: 'Integration proof.' },
            conditions: { expectedMetric: ['GrossMarginPct'] },
            characteristic: { kind: 'OUTCOME_VS_EXPECTATION', metricKey: 'GrossMarginPct', direction: 'ACTUAL_BELOW_EXPECTED' },
            statement: 'Reallocations of consignment stock have landed below the committed gross margin.',
            limitations: 'One episode; a test.',
            authoredByLabel: 'Country GM Vietnam',
          }));
          const text = JSON.stringify(unwrap(await genome.classifyEpisode(helmScope, pattern.pattern?.id ?? pattern.id, episodeId)));
          assert.match(text, /SUPPORTS/);
          assert.match(text, /31.421/);
        });

        test('a reader Helm has not cleared for the margin does not see the episode at all — it is read whole', async () => {
          const as = async (uid) => (await createManagementGenomeFor(uid)).getEpisode({ ...helmScope, actorId: uid }, episodeId);
          const cd = await as(CD);
          assert.equal(cd.ok, false, 'the Commercial Director sees the decision, but not an episode about its margin');
          assert.equal(cd.error.code, 'genome.not_found');
          const scm = unwrap(await as(SCM));
          assert.equal(scm.refs.filter((r) => r.role === 'EXECUTION_EPISODE').length, 1, 'Supply Chain — shared and cleared — reads it whole, Forge reference included');
        });

        const createManagementGenomeFor = async (uid) => {
          const { createManagementGenome } = await import('@helm/genome-runtime');
          const { createPostgresGenomeStore } = await import('@helm/genome-runtime/postgres');
          return createManagementGenome({
            store: createPostgresGenomeStore({ client: postgrestClient(runnerAs(db, 'authenticated', uid)) }),
            clock: { now: () => new Date() },
            sources: { graph: s.graph, decisions: helmPg, scenarios: s.scenarios, authority: s.authority, twin: s.twin, causal: s.causal, counterfactual: s.counterfactual, executions: intake },
          });
        };
      });

      test('in Forge, the published outcome is sealed from the same reader', async () => {
        const seen = unwrap(await forgeAs(CD).view(scopeOf(CD), outcomeId)).publications[0].publication;
        const margin = seen.measures.find((m) => m.metricKey === 'GrossMarginPct');
        assert.equal(margin.actual, null);
        assert.equal(margin.withheld, true);
        assert.equal(seen.fingerprint, publication.fingerprint);
      });
    });
  });
});
