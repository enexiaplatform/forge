/**
 * DEMO — the Meridian execution story, as moments.
 *
 * Each moment moves the demo clock, lets the execution surfaces report what
 * they recorded up to then, and plays the acts people took. Every scripted act
 * is tolerant: if whoever is exploring the demo already did it (accepted,
 * approved, closed), the script notes it and moves on, so the story and a
 * person's own clicks can share one ledger.
 */

import {
  type CandidateView,
  type Change,
  type CommitmentView,
  createForgeRuntime,
  createInMemoryCandidateStore,
  createInMemoryStore,
  type ForgeRuntime,
  manualClock,
  type Result,
  type Scope,
  sequentialIds,
} from '@forge/kernel';
import {
  connectorScope,
  createFixtureCommercialApi,
  createFixtureHelmReader,
  createFixtureMemoireReader,
  createFixtureSurface,
  createIngestionLedger,
  createMemoirePromiseSurface,
  draftFromHelm,
  type ExecutionSurface,
  extractCandidates,
  type HelmDecisionReader,
  type IngestEffect,
  ingestObservations,
  type IngestionLedger,
  listAllPromises,
  type MemoireCommercialApi,
  type MemoireContextReader,
  memoireCommitmentRef,
  promotionCandidates,
  proposeIntake,
  referenceExtractor,
} from '@forge/fabric';
import {
  DEMO_ORG,
  HELM_DECISIONS,
  MEMOIRE_DIRECTORY,
  MEMOIRE_OPPORTUNITIES,
  MEMOIRE_PROMISES,
  PEOPLE,
  type PersonKey,
  QC_REVIEW_NOTES,
  ROHTO_DECISION,
  ROLES,
  SURFACES,
} from './meridian.ts';

export const MOMENTS = [
  { key: 'intake', at: '2026-09-25T10:00:00.000Z', title: 'Helm commits, Forge drafts', description: 'Management commits to reallocating Distributor D’s stock. Forge drafts the commitments from the decision; the owners accept.' },
  { key: 'confirmed', at: '2026-09-26T10:00:00.000Z', title: 'Rohto confirms the date', description: 'Memoire records Rohto’s confirmation, which closes the first commitment. Logistics takes on the delivery. Forge reads Hoa’s Memoire promises and proposes one as an obligation — a candidate, not a commitment.' },
  { key: 'slip', at: '2026-10-01T09:00:00.000Z', title: 'The release slips', description: 'Distributor D has not released the units. The transfer asks for a new date; Helm’s review trigger fires. A promise Forge read in Memoire waits for Hoa to confirm.' },
  { key: 'release', at: '2026-10-02T12:00:00.000Z', title: 'Distributor D releases', description: 'SCM records the release. The new date is approved; Finance accepts its commitment. Hoa confirms the installation plan as an obligation.' },
  { key: 'forecast', at: '2026-10-03T09:00:00.000Z', title: 'Forecast published', description: 'Finance publishes the Q4 forecast with the transfer cost in it.' },
  { key: 'transfer', at: '2026-10-06T09:00:00.000Z', title: 'Units arrive in HCMC', description: 'The transfer is received — four days after the date first promised, on the date agreed.' },
  { key: 'shipment', at: '2026-10-15T10:00:00.000Z', title: 'Delivery day', description: 'Every tracked issue is done and twelve units left the warehouse. Logistics confirms delivery; the ERP proves ten.' },
  { key: 'qc', at: '2026-10-16T10:00:00.000Z', title: 'Two units on QC hold', description: 'The confirmation is withdrawn: two units failed seal inspection. A new date is agreed for them. Forge reads the QC review notes and proposes what was promised in them.' },
  { key: 'delivered', at: '2026-10-24T09:00:00.000Z', title: 'Twelve of twelve', description: 'The ERP proves the remaining two units delivered. The delivery commitment closes. Of the two candidates from the notes, one is confirmed and one dismissed.' },
  { key: 'outcome', at: '2026-11-20T09:30:00.000Z', title: 'What actually happened', description: 'Helm observes the quarter’s actuals. The Country GM records the outcome, closes the decision’s commitment, keeps the lesson and publishes the verified outcome for Helm’s memory.' },
] as const;

export type MomentKey = (typeof MOMENTS)[number]['key'];
export type Moment = (typeof MOMENTS)[number];

export type StoryLogEntry = {
  readonly at: string;
  readonly moment: MomentKey;
  readonly who: string;
  readonly act: string;
  readonly result: 'DONE' | 'ALREADY_DONE' | 'SKIPPED';
  readonly note: string | null;
};

/** The ids of the commitments the story speaks about, once they exist. */
export type StoryRefs = {
  outcome?: string;
  transfer?: string;
  confirm?: string;
  forecast?: string;
  ship?: string;
  /** The installation plan, promised in Memoire and confirmed as an obligation. */
  plan?: string;
  /** The SOP revision, promised in the QC review and confirmed from the notes. */
  sop?: string;
};

export type MeridianDemo = {
  readonly orgId: string;
  readonly runtime: ForgeRuntime;
  readonly clock: ReturnType<typeof manualClock>;
  readonly people: typeof PEOPLE;
  readonly helm: HelmDecisionReader;
  readonly memoire: MemoireContextReader;
  /** Memoire's Commercial API v1, as the demo fixture serves it — Hoa's promises at the demo's moment. */
  readonly memoirePromises: MemoireCommercialApi;
  readonly surfaces: readonly ExecutionSurface[];
  readonly ledger: IngestionLedger;
  readonly refs: StoryRefs;
  readonly log: readonly StoryLogEntry[];
  readonly ingested: readonly IngestEffect[];
  current(): Moment | null;
  next(): Moment | null;
  advanceTo(key: MomentKey): Promise<void>;
  /** Let every surface report what it recorded up to now. */
  sync(): Promise<IngestEffect[]>;
};

export const START = '2026-09-25T08:30:00.000Z';

export function createMeridianDemo(): MeridianDemo {
  const clock = manualClock(START);
  const store = createInMemoryStore(clock);
  const runtime = createForgeRuntime({ store, candidates: createInMemoryCandidateStore(clock), clock, ids: sequentialIds() });
  const helm = createFixtureHelmReader(HELM_DECISIONS, () => clock.now());
  const memoire = createFixtureMemoireReader(MEMOIRE_OPPORTUNITIES);
  const memoirePromises = createFixtureCommercialApi(MEMOIRE_PROMISES, () => clock.now());
  const surfaces = [
    ...SURFACES.map((s) => createFixtureSurface(s.system, s.label, s.describes, s.observations)),
    createMemoirePromiseSurface(memoirePromises),
  ];
  const ledger = createIngestionLedger();
  const refs: StoryRefs = {};
  const log: StoryLogEntry[] = [];
  const ingested: IngestEffect[] = [];
  let index = -1;

  async function sync(): Promise<IngestEffect[]> {
    const effects: IngestEffect[] = [];
    for (const s of surfaces) {
      const observations = await s.pull(ledger.checkpoint(s), clock.now());
      if (observations.length === 0) continue;
      const report = await ingestObservations(runtime, DEMO_ORG, observations);
      if (report.ok) effects.push(...report.value.effects);
      ledger.record(s, observations);
    }
    ingested.push(...effects);
    return effects;
  }

  const P = (k: PersonKey): Scope => PEOPLE[k].scope;
  const view = async (id: string | undefined): Promise<CommitmentView | null> => {
    if (!id) return null;
    const v = await runtime.view(P('gm'), id);
    return v.ok ? v.value : null;
  };

  async function act(moment: MomentKey, at: string, who: PersonKey, what: string, fn: () => Promise<Result<unknown> | 'ALREADY_DONE' | 'SKIPPED'>) {
    clock.set(at);
    await sync();
    const r = await fn();
    const entry = (result: StoryLogEntry['result'], note: string | null) =>
      log.push({ at, moment, who: PEOPLE[who].scope.actor.label, act: what, result, note });
    if (r === 'ALREADY_DONE') entry('ALREADY_DONE', 'Already done in the demo — the story moves on.');
    else if (r === 'SKIPPED') entry('SKIPPED', 'Not applicable to the ledger as it now stands.');
    else if (r.ok) entry('DONE', null);
    else entry('SKIPPED', r.error.message);
  }

  /** Accept if still proposed — whoever explores the demo may already have. */
  const acceptIfProposed = async (who: PersonKey, id: string | undefined, evidence?: Parameters<ForgeRuntime['accept']>[2]) => {
    const v = await view(id);
    if (!v || !id) return 'SKIPPED' as const;
    if (v.phase !== 'PROPOSED') return 'ALREADY_DONE' as const;
    return runtime.accept(P(who), id, evidence);
  };

  const closeIfOpen = async (who: PersonKey, id: string | undefined, c: Extract<Change, { kind: 'CLOSE' }>, reason: string) => {
    const v = await view(id);
    if (!v || !id) return 'SKIPPED' as const;
    if (v.phase === 'CLOSED') return 'ALREADY_DONE' as const;
    return runtime.change(P(who), id, c, reason);
  };

  const candidateFor = async (sourceRef: string, quoteHas = ''): Promise<CandidateView | null> => {
    const all = await runtime.listCandidates(P('gm'));
    return all.ok ? (all.value.find((c) => c.record.source.ref === sourceRef && (c.record.source.quote ?? '').includes(quoteHas)) ?? null) : null;
  };

  /** Confirm a candidate if it is still pending; adopt the commitment if whoever explores the demo already did. */
  const confirmIfPending = async (
    who: PersonKey,
    c: CandidateView | null,
    input: (c: CandidateView) => Parameters<ForgeRuntime['confirmCandidate']>[2],
    adopt: (id: string) => void,
  ) => {
    if (!c) return 'SKIPPED' as const;
    if (c.state !== 'PENDING') {
      if (c.disposition?.commitmentId) adopt(c.disposition.commitmentId);
      return 'ALREADY_DONE' as const;
    }
    const r = await runtime.confirmCandidate(P(who), c.record.id, input(c));
    if (r.ok) adopt(r.value.commitment.record.id);
    return r;
  };

  const approvePending = async (who: PersonKey, id: string | undefined, kind: Change['kind'], reason: string) => {
    const v = await view(id);
    if (!v || !id) return 'SKIPPED' as const;
    const req = v.changeRequests.find((r) => r.change.kind === kind && r.decided === null);
    if (!req) return v.changeRequests.some((r) => r.change.kind === kind) ? ('ALREADY_DONE' as const) : ('SKIPPED' as const);
    return runtime.decideChange(P(who), id, req.requestId, 'APPROVED', reason);
  };

  const scripts: Record<MomentKey, (m: MomentKey) => Promise<void>> = {
    async intake(m) {
      await act(m, '2026-09-25T09:00:00.000Z', 'gm', 'Draft and propose the commitments from the Helm decision', async () => {
        const held = await runtime.list(P('gm'), { originRef: `helm:decision-commitment:${ROHTO_DECISION.commitment.id}` });
        if (held.ok && held.value.length > 0) {
          adoptRefs(held.value);
          return 'ALREADY_DONE';
        }
        const draft = await draftFromHelm(P('gm'), ROHTO_DECISION, { memoire });
        if (!draft.ok) return draft;
        const r = await proposeIntake(runtime, P('gm'), draft.value);
        if (r.ok) adoptRefs([r.value.outcome, ...r.value.intents]);
        return r;
      });
      await act(m, '2026-09-25T09:20:00.000Z', 'gm', 'Accept the outcome commitment', () => acceptIfProposed('gm', refs.outcome));
      await act(m, '2026-09-25T09:40:00.000Z', 'com', 'Accept, naming the Rohto opportunity as where the confirmation will be recorded', async () => {
        const v = await view(refs.confirm);
        if (!v) return 'SKIPPED';
        const pinned = v.terms.evidence.map((r) =>
          r.matcher ? { ...r, matcher: { ...r.matcher, objectRef: 'memoire:opportunity:rohto-q4-tender', where: { subject: 'delivery-date' } } } : r,
        );
        return acceptIfProposed('com', refs.confirm, { evidence: pinned });
      });
    },

    async confirmed(m) {
      await act(m, '2026-09-26T08:00:00.000Z', 'com', 'Let Forge read her Memoire promises for obligations the enterprise owes', async () => {
        const proposed = promotionCandidates(await listAllPromises(memoirePromises), MEMOIRE_DIRECTORY);
        const held = await runtime.listCandidates(P('gm'));
        if (held.ok && proposed.every((p) => held.value.some((c) => c.record.dedupeKey === p.dedupeKey))) return 'ALREADY_DONE';
        return runtime.suggestCandidates(connectorScope(DEMO_ORG, 'memoire'), proposed);
      });
      await act(m, '2026-09-26T09:00:00.000Z', 'com', 'Close the date confirmation as fulfilled', () =>
        closeIfOpen('com', refs.confirm, { kind: 'CLOSE', resolution: 'FULFILLED', supersededBy: null, confirmedWithoutEvidence: false }, 'Rohto procurement confirmed 15 October, on the record in Memoire.'),
      );
      await act(m, '2026-09-26T09:30:00.000Z', 'scm', 'Accept the transfer, naming transfer order TR-0412', async () => {
        const v = await view(refs.transfer);
        if (!v) return 'SKIPPED';
        const pinned = v.terms.evidence.map((r) =>
          r.matcher ? { ...r, description: 'Transfer TR-0412 of 8 units received at HCMC (SCM)', matcher: { ...r.matcher, objectRef: 'TR-0412', where: { quantity: 8 } } } : r,
        );
        return acceptIfProposed('scm', refs.transfer, { evidence: pinned });
      });
      await act(m, '2026-09-26T09:35:00.000Z', 'scm', 'Declare the dependency on Distributor D’s release — Helm’s own review trigger', async () => {
        const v = await view(refs.transfer);
        if (!v || !refs.transfer) return 'SKIPPED';
        if (v.dependencies.some((d) => d.dependency.key === 'distributor-release')) return 'ALREADY_DONE';
        return runtime.declareDependency(P('scm'), refs.transfer, {
          key: 'distributor-release',
          description: 'Distributor D releases the eight consignment units',
          on: { kind: 'EXTERNAL', source: { system: 'scm', ref: 'CR-D-0925', url: null }, label: 'Distributor D' },
          neededBy: '2026-09-30',
          matcher: { system: 'scm', eventType: 'consignment.released', objectRef: 'CR-D-0925', where: { units: 8 } },
          helmTriggerKey: 'distributor-release-slips',
        });
      });
      await act(m, '2026-09-26T09:40:00.000Z', 'scm', 'Link the transfer order in SCM', async () =>
        refs.transfer ? runtime.linkExecution(P('scm'), refs.transfer, { system: 'scm', kind: 'TRANSFER_ORDER', ref: 'TR-0412', label: 'Distributor D → HCMC, 8 × SKU-X', url: null }) : 'SKIPPED',
      );
      await act(m, '2026-09-26T10:00:00.000Z', 'gm', 'Hand the delivery itself to Logistics, as a commitment under the outcome', async () => {
        if (refs.ship) return 'ALREADY_DONE';
        const parent = await view(refs.outcome);
        if (!parent || !refs.transfer) return 'SKIPPED';
        const r = await runtime.propose(P('gm'), {
          origin: parent.record.origin,
          parentId: parent.record.id,
          terms: {
            statement: 'Deliver the Rohto order — twelve units of SKU-X — from HCMC on the date Rohto confirmed',
            intendedOutcome: 'Rohto holds all twelve units on 15 October.',
            why: parent.terms.why,
            owner: { kind: 'ROLE', label: 'Logistics Manager HCMC', ref: null },
            principal: { kind: 'ROLE', label: 'Country GM Vietnam', ref: null },
            dueBy: '2026-10-15',
            evidence: [
              { key: 'goods-issue', level: 'OUTPUT', description: 'Goods issue of 12 units on DO-5520 (WMS)', required: true, matcher: { system: 'wms', eventType: 'goods_issue.posted', objectRef: 'DO-5520', where: { quantity: 12 } } },
              { key: 'delivered', level: 'OUTCOME', description: 'Proof of delivery for all 12 units on SO-5520 (ERP)', required: true, matcher: { system: 'erp', eventType: 'delivery.confirmed', objectRef: 'SO-5520', where: { cumulativeQuantity: 12 } } },
            ],
            measures: [],
            value: [],
          },
          capture: { why: 'INHERITED', principal: 'INHERITED' },
          context: parent.record.context,
          dependencies: [
            { key: 'stock-in-hcmc', description: 'The transferred units are in HCMC', on: { kind: 'COMMITMENT', commitmentId: refs.transfer }, neededBy: '2026-10-08', matcher: null, helmTriggerKey: null },
          ],
          links: [{ system: 'jira', kind: 'EPIC', ref: 'LOG-88', label: 'Rohto Q4 delivery', url: null }],
        });
        if (r.ok) refs.ship = r.value.record.id;
        return r;
      });
      await act(m, '2026-09-26T10:00:00.000Z', 'log', 'Accept the delivery', () => acceptIfProposed('log', refs.ship));
    },

    async slip(m) {
      await act(m, '2026-10-01T08:30:00.000Z', 'scm', 'Ask the Country GM to move the transfer to 6 October', async () => {
        const v = await view(refs.transfer);
        if (!v || !refs.transfer) return 'SKIPPED';
        if (v.phase !== 'ACTIVE' || v.terms.dueBy !== '2026-10-02' || v.changeRequests.some((r) => r.change.kind === 'REDATE')) return 'ALREADY_DONE';
        return runtime.change(P('scm'), refs.transfer, { kind: 'REDATE', dueBy: '2026-10-06' }, 'Distributor D’s warehouse confirms release on 2 October; the transfer lands on the 6th.');
      });
    },

    async release(m) {
      await act(m, '2026-10-02T10:30:00.000Z', 'com', 'Confirm the installation plan as an obligation — linked to the Memoire promise, not copied', async () =>
        confirmIfPending(
          'com',
          await candidateFor(memoireCommitmentRef('cmt-rohto-install-plan')),
          (c) => ({
            terms: {
              statement: c.record.proposal.statement,
              intendedOutcome: 'Rohto has the installation plan for the twelve analyzers before the units arrive.',
              why: 'Hoa promised it to Rohto in Memoire, and installation on the confirmed date depends on it.',
              owner: c.record.proposal.owner ?? ROLES.COM,
              principal: ROLES.GM,
              dueBy: c.record.proposal.dueBy ?? '2026-10-09',
              evidence: c.record.proposal.evidence,
              measures: [],
              value: [],
            },
          }),
          (id) => {
            refs.plan = id;
          },
        ),
      );
      await act(m, '2026-10-02T10:35:00.000Z', 'com', 'Accept the installation plan', () => acceptIfProposed('com', refs.plan));
      await act(m, '2026-10-02T11:00:00.000Z', 'gm', 'Approve the new transfer date', () =>
        approvePending('gm', refs.transfer, 'REDATE', 'Rohto’s 15 October date still holds with a 6 October arrival.'),
      );
      await act(m, '2026-10-02T11:30:00.000Z', 'fin', 'Accept the forecast update, naming forecast version FC-2026-10', async () => {
        const v = await view(refs.forecast);
        if (!v) return 'SKIPPED';
        const pinned = v.terms.evidence.map((r) =>
          r.matcher ? { ...r, description: 'Forecast FC-2026-10 published with the transfer cost in it (Finance)', matcher: { ...r.matcher, objectRef: 'FC-2026-10', where: { includesTransferCost: true } } } : r,
        );
        return acceptIfProposed('fin', refs.forecast, { evidence: pinned });
      });
    },

    async forecast(m) {
      await act(m, '2026-10-03T09:00:00.000Z', 'fin', 'Close the forecast update', () =>
        closeIfOpen('fin', refs.forecast, { kind: 'CLOSE', resolution: 'FULFILLED', supersededBy: null, confirmedWithoutEvidence: false }, 'FC-2026-10 carries the transfer cost and the reduced consignment position.'),
      );
    },

    async transfer(m) {
      await act(m, '2026-10-06T08:30:00.000Z', 'com', 'Close the installation plan on Memoire’s record of it', () =>
        closeIfOpen('com', refs.plan, { kind: 'CLOSE', resolution: 'FULFILLED', supersededBy: null, confirmedWithoutEvidence: false }, 'Memoire records the installation plan sent to Rohto on 5 October.'),
      );
      await act(m, '2026-10-06T09:00:00.000Z', 'scm', 'Close the transfer', () =>
        closeIfOpen('scm', refs.transfer, { kind: 'CLOSE', resolution: 'FULFILLED', supersededBy: null, confirmedWithoutEvidence: false }, 'TR-0412 received in full at HCMC.'),
      );
    },

    async shipment(m) {
      await act(m, '2026-10-15T08:00:00.000Z', 'log', 'Confirm delivery to Rohto', async () => {
        const v = await view(refs.ship);
        if (!v || !refs.ship) return 'SKIPPED';
        if (v.evidence.some((e) => e.item.channel === 'HUMAN_CONFIRMATION')) return 'ALREADY_DONE';
        return runtime.recordEvidence(P('log'), refs.ship, {
          requirementKey: 'delivered',
          stance: 'SUPPORTS',
          epistemic: 'FACT',
          channel: 'HUMAN_CONFIRMATION',
          source: { system: 'manual', ref: null, url: null },
          statement: 'Delivered in full to Rohto’s HCMC site this morning.',
          observedAt: '2026-10-15T07:30:00.000Z',
          confidence: null,
          observationId: null,
        });
      });
    },

    async qc(m) {
      await act(m, '2026-10-16T08:00:00.000Z', 'log', 'Withdraw the delivery confirmation', async () => {
        const v = await view(refs.ship);
        const mine = v?.evidence.find((e) => e.item.channel === 'HUMAN_CONFIRMATION' && e.disputed === null);
        if (!v || !refs.ship || !mine) return 'ALREADY_DONE';
        return runtime.disputeEvidence(P('log'), refs.ship, mine.item.id, 'Two units failed seal inspection after the transfer and were held at QC; ten were delivered on the 15th, not twelve.');
      });
      await act(m, '2026-10-16T08:15:00.000Z', 'log', 'Ask for 24 October for the last two units', async () => {
        const v = await view(refs.ship);
        if (!v || !refs.ship || v.phase !== 'ACTIVE') return 'SKIPPED';
        if (v.changeRequests.some((r) => r.change.kind === 'REDATE')) return 'ALREADY_DONE';
        return runtime.change(P('log'), refs.ship, { kind: 'REDATE', dueBy: '2026-10-24' }, 'QC re-release of the two held units takes until the 23rd; Rohto has agreed to the 24th.');
      });
      await act(m, '2026-10-16T09:00:00.000Z', 'gm', 'Approve 24 October', () =>
        approvePending('gm', refs.ship, 'REDATE', 'Rohto has agreed; ten of twelve on the confirmed date is what we can now honour.'),
      );
      await act(m, '2026-10-16T09:45:00.000Z', 'log', 'Paste the QC hold review notes for Forge to read', async () => {
        const held = await runtime.listCandidates(P('gm'));
        if (held.ok && held.value.some((c) => c.record.source.ref === QC_REVIEW_NOTES.source.ref)) return 'ALREADY_DONE';
        const read = await extractCandidates(referenceExtractor, QC_REVIEW_NOTES);
        if (!read.ok) return read;
        return runtime.suggestCandidates(P('log'), read.value.candidates);
      });
    },

    async delivered(m) {
      await act(m, '2026-10-24T08:00:00.000Z', 'gm', 'Dismiss the re-inspection candidate: the delivery commitment already holds it', async () => {
        const c = await candidateFor(QC_REVIEW_NOTES.source.ref, 're-inspect');
        if (!c) return 'SKIPPED';
        if (c.state !== 'PENDING') return 'ALREADY_DONE';
        return runtime.dismissCandidate(P('gm'), c.record.id, 'Already a commitment: the delivery’s agreed date of 24 October covers the two held units.');
      });
      await act(m, '2026-10-24T08:10:00.000Z', 'scm', 'Confirm the SOP revision he promised in the review', async () =>
        confirmIfPending(
          'scm',
          await candidateFor(QC_REVIEW_NOTES.source.ref, 'SOP'),
          (c) => ({
            terms: {
              statement: c.record.proposal.statement,
              intendedOutcome: 'Stock transferred back from consignment is QC re-released before it is promised to a customer.',
              why: 'Two of Rohto’s twelve units failed seal inspection after the transfer and missed the confirmed date.',
              owner: c.record.proposal.owner ?? ROLES.SCM,
              principal: ROLES.GM,
              dueBy: c.record.proposal.dueBy ?? '2026-10-30',
              evidence: [{ key: 'sop-revised', level: 'OUTPUT', description: 'The revised SOP is published in the quality system', required: true, matcher: null }],
              measures: [],
              value: [],
            },
          }),
          (id) => {
            refs.sop = id;
          },
        ),
      );
      await act(m, '2026-10-24T08:15:00.000Z', 'scm', 'Accept the SOP revision', () => acceptIfProposed('scm', refs.sop));
      await act(m, '2026-10-24T09:00:00.000Z', 'log', 'Close the delivery', () =>
        closeIfOpen('log', refs.ship, { kind: 'CLOSE', resolution: 'FULFILLED', supersededBy: null, confirmedWithoutEvidence: false }, 'SO-5520 shows twelve of twelve delivered.'),
      );
    },

    async outcome(m) {
      await act(m, '2026-11-20T07:30:00.000Z', 'scm', 'Record the revised SOP, published on 29 October, and close the commitment as of then', async () => {
        const v = await view(refs.sop);
        if (!v || !refs.sop) return 'SKIPPED';
        if (v.phase === 'CLOSED') return 'ALREADY_DONE';
        if (!v.evidence.some((e) => e.item.requirementKey === 'sop-revised')) {
          const e = await runtime.recordEvidence(
            P('scm'),
            refs.sop,
            {
              requirementKey: 'sop-revised',
              stance: 'SUPPORTS',
              epistemic: 'FACT',
              channel: 'DOCUMENT',
              source: { system: 'qms', ref: 'SOP-QC-07 rev 3', url: null },
              statement: 'SOP-QC-07 revision 3 adds a QC re-release step for stock transferred back from consignment. Published in the quality system on 29 October.',
              observedAt: '2026-10-29T09:00:00.000Z',
              confidence: null,
              observationId: null,
            },
            { effectiveAt: '2026-10-29T09:00:00.000Z' },
          );
          if (!e.ok) return e;
        }
        return runtime.change(P('scm'), refs.sop, { kind: 'CLOSE', resolution: 'FULFILLED', supersededBy: null, confirmedWithoutEvidence: false }, 'SOP-QC-07 rev 3 is published.', {
          effectiveAt: '2026-10-29T09:30:00.000Z',
        });
      });
      await act(m, '2026-11-20T07:45:00.000Z', 'gm', 'Record what Memoire shows about the framework relationship', async () => {
        const v = await view(refs.outcome);
        const req = v?.terms.evidence.find((r) => r.key === 'confirmed-framework-relationship');
        if (!v || !refs.outcome || !req) return 'SKIPPED';
        if (v.evidence.some((e) => e.item.requirementKey === req.key)) return 'ALREADY_DONE';
        return runtime.recordEvidence(P('gm'), refs.outcome, {
          requirementKey: req.key,
          stance: 'SUPPORTS',
          epistemic: 'FACT',
          channel: 'DOCUMENT',
          source: { system: 'memoire', ref: 'memoire:opportunity:rohto-framework-2027', url: null },
          statement: 'Rohto’s 2027 framework renewal opened in Memoire on 18 November. Rohto raised the two late units at the meeting and did not make them a condition.',
          observedAt: '2026-11-18T03:00:00.000Z',
          confidence: null,
          observationId: 'mem-5102',
        });
      });
      await act(m, '2026-11-20T08:00:00.000Z', 'gm', 'Record what actually happened', async () => {
        const v = await view(refs.outcome);
        if (!v || !refs.outcome) return 'SKIPPED';
        if (v.outcome !== null) return 'ALREADY_DONE';
        return runtime.recordOutcome(P('gm'), refs.outcome, {
          statement:
            'Rohto received all twelve units — ten on the confirmed date, two nine days later after a QC hold. Margin landed under the committed future, and more cash was tied up, from re-labelling and the QC rework.',
          achievedOn: '2026-10-24',
          measures: [
            { key: 'GrossMarginPct', actual: '31.421', note: 'Re-labelling and QC rework, neither in the transfer cost Helm modelled.' },
            { key: 'DemandCoverage', actual: '100', note: null },
            { key: 'CashImpact', actual: '-1768300000', note: 'Finance’s open challenge on the transfer cost proved right.' },
            { key: 'framework-relationship', actual: null, note: 'Rohto raised the late units at the renewal meeting and did not make them a condition; the 2027 framework renewal opened on 18 Nov.' },
          ],
          realizedValue: [
            { dimension: 'MARGIN', effect: 'PROTECTED', statement: '0.97 points below the committed future, still above the 30.517% expediting would have given.', amount: null, unit: null },
            { dimension: 'CUSTOMER', effect: 'PROTECTED', statement: 'Rohto was served in full and the framework renewal opened.', amount: null, unit: null },
            { dimension: 'CASH', effect: 'PROTECTED', statement: '32.8M VND more tied up than modelled; still less than expediting.', amount: '-32800000', unit: 'VND' },
          ],
          basis: v.evidence.filter((e) => e.item.source.system === 'helm').map((e) => e.item.id),
        });
      });
      await act(m, '2026-11-20T08:30:00.000Z', 'gm', 'Close the decision’s commitment as partly fulfilled', () =>
        closeIfOpen('gm', refs.outcome, { kind: 'CLOSE', resolution: 'PARTIALLY_FULFILLED', supersededBy: null, confirmedWithoutEvidence: false },
          'Rohto was served in full, but two of twelve units arrived nine days after the date Rohto was promised, and margin and cash landed below the committed future.'),
      );
      await act(m, '2026-11-20T08:45:00.000Z', 'gm', 'Explain the variance', async () => {
        const v = await view(refs.outcome);
        if (!v || !refs.outcome) return 'SKIPPED';
        if (v.learnings.some((l) => l.learning.kind === 'EXPLANATION')) return 'ALREADY_DONE';
        return runtime.recordLearning(P('gm'), refs.outcome, {
          kind: 'EXPLANATION',
          statement: 'Consignment units coming back from a distributor need a QC re-release before they can ship. The plan treated them as shippable on receipt, so neither the dates nor the transfer cost allowed for it.',
          appliesTo: null,
        });
      });
      await act(m, '2026-11-20T09:00:00.000Z', 'scm', 'Record the lesson', async () => {
        const v = await view(refs.outcome);
        if (!v || !refs.outcome) return 'SKIPPED';
        if (v.learnings.some((l) => l.learning.kind === 'LESSON')) return 'ALREADY_DONE';
        return runtime.recordLearning(P('scm'), refs.outcome, {
          kind: 'LESSON',
          statement: 'When stock is reallocated from consignment, plan two to four working days of QC re-release before the customer date, and quote re-labelling in the transfer cost.',
          appliesTo: 'reallocations of consignment stock',
        });
      });
      await act(m, '2026-11-20T09:10:00.000Z', 'com', 'Say what became of the assumptions the decision rested on', async () => {
        const v = await view(refs.outcome);
        if (!v || !refs.outcome) return 'SKIPPED';
        if (v.assumptions.every((a) => a.assessed !== null)) return 'ALREADY_DONE';
        const said: Record<string, string> = {
          'Distributor D will release its eight consignment units for the quarter.':
            'Distributor D released all eight units, on 6 October — four days after the date the plan assumed, but within the quarter.',
          'The provincial tender remains material this quarter.': 'The provincial tender is still on the shortlist; Helm’s buffer decision rests on it.',
          'Rohto treats on-time delivery of this order as a condition of the annual framework agreement.':
            'Rohto took the two late units without raising the framework; its renewal is still on the January agenda.',
        };
        // Whoever stands behind an assumption says what became of it; the principal answers for the ones nobody owns.
        let last: Result<unknown> = { ok: true, value: null };
        for (const a of v.assumptions.filter((x) => x.assessed === null)) {
          const who = a.standsBehind === 'Commercial Director Vietnam' ? 'com' : 'gm';
          last = await runtime.assessAssumption(P(who), refs.outcome, { key: a.key, assessment: 'HELD' }, said[a.statement] ?? 'It held through delivery.');
          if (!last.ok) return last;
        }
        return last;
      });
      await act(m, '2026-11-20T09:15:00.000Z', 'gm', 'Publish the verified outcome for Helm’s enterprise memory', async () => {
        const v = await view(refs.outcome);
        if (!v || !refs.outcome) return 'SKIPPED';
        if (v.publications.length > 0) return 'ALREADY_DONE';
        return runtime.publishOutcome(P('gm'), refs.outcome);
      });
    },
  };

  function adoptRefs(views: readonly CommitmentView[]) {
    for (const v of views) {
      const s = v.record.terms.statement;
      if (v.record.parentId === null) refs.outcome = v.record.id;
      else if (/^Recall and transfer/.test(s)) refs.transfer = v.record.id;
      else if (/^Confirm the delivery date/.test(s)) refs.confirm = v.record.id;
      else if (/^Update the quarter/.test(s)) refs.forecast = v.record.id;
      else if (/^Deliver the Rohto order/.test(s)) refs.ship = v.record.id;
    }
  }

  return {
    orgId: DEMO_ORG,
    runtime,
    clock,
    people: PEOPLE,
    helm,
    memoire,
    memoirePromises,
    surfaces,
    ledger,
    refs,
    log,
    ingested,
    current: () => (index >= 0 ? MOMENTS[index] : null),
    next: () => MOMENTS[index + 1] ?? null,
    async advanceTo(key) {
      const target = MOMENTS.findIndex((mo) => mo.key === key);
      while (index < target) {
        index += 1;
        const mo = MOMENTS[index];
        await scripts[mo.key](mo.key);
        clock.set(mo.at);
        await sync();
      }
    },
    sync,
  };
}
