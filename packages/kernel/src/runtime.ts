/**
 * The Forge runtime — the only place a commitment changes.
 *
 * Every command reads the commitment at the store's present, validates the act
 * against the commitment's own rules, asks the authority port, and appends
 * events that record who acted, under which verdict, and why. Reads derive
 * everything at a lens. Domain failures come back as `Result` values with a
 * manager-readable message; nothing here throws for a rule.
 */

import {
  type Clock,
  fail,
  fingerprint,
  type IdGen,
  isDecimal,
  isIsoDate,
  ok,
  type Party,
  type Result,
  sameParty,
  type Scope,
  canonicalJson,
} from './primitives.ts';
import { type AuthorityAct, type AuthorityPort, type AuthorityVerdict, interimAuthority, isConsequential } from './authority.ts';
import {
  type CandidateRecord,
  type CandidateStore,
  type CandidateView,
  candidateFingerprint,
  candidateViews,
  editedTerms,
  type SuggestCandidateInput,
  validateCandidate,
} from './candidates.ts';
import { type OutcomePublication, verifyOutcome } from './publication.ts';
import { type CommitmentView, deriveView } from './derive.ts';
import { type Condition, asksFor, bySeverity, conditionsOf } from './conditions.ts';
import { assembleEpisode, type ExecutionEpisode } from './episode.ts';
import type { CommitmentStore } from './port.ts';
import { varianceOf, type Variance } from './variance.ts';
import {
  type AuthorityBasis,
  type CaptureMode,
  type Change,
  type CommitmentEvent,
  type CommitmentRecord,
  type ContextField,
  type Dependency,
  type EventPayloads,
  type EventType,
  type EvidenceItem,
  type EvidenceRequirement,
  type ExecutionLink,
  type Learning,
  type Lens,
  END_OF_RECORD,
  latestAt,
  type NewEvent,
  type ObservedOutcome,
  type Origin,
  type OutcomeMeasure,
  type SourceRef,
  type TermField,
  type Terms,
  termFields,
} from './types.ts';
import { hasText, joinProtection, type Protection, protectionOf, readableBy, textCeiling } from './sensitivity.ts';
import { readerKey } from './ledgerCache.ts';

export type ForgeRuntimeDeps = {
  readonly store: CommitmentStore;
  readonly clock: Clock;
  readonly ids: IdGen;
  readonly authority?: AuthorityPort;
  /** Where candidates live — required for the candidate commands. */
  readonly candidates?: CandidateStore;
  /**
   * Refuse consequential acts (accept, approve, change, cancel, close, reopen) unless a TRUSTED authority —
   * Helm's Decision & Authority Runtime — allowed them. Off in local and staging; on in shared production.
   */
  readonly requireTrustedAuthority?: boolean;
};

export type ProposeInput = {
  readonly origin: Origin;
  readonly parentId?: string | null;
  readonly terms: Terms;
  /** How each term was captured. Anything not stated was typed by a person. */
  readonly capture?: Partial<Record<TermField, CaptureMode>>;
  readonly context?: readonly ContextField[];
  readonly dependencies?: readonly Dependency[];
  readonly links?: readonly Omit<ExecutionLink, 'id'>[];
  readonly effectiveAt?: string;
};

export type ActOptions = {
  /** When it happened in the world; defaults to now. */
  readonly effectiveAt?: string;
  /**
   * A class for the words written with this act, above the commitment's ceiling (ADR-0017). Only ever raises:
   * the words always carry at least every class the commitment rests on.
   */
  readonly textProtection?: Protection;
  /** Re-delivering the same act with the same key changes nothing. */
  readonly idempotencyKey?: string | null;
};

export type EvidenceInput = Omit<EvidenceItem, 'id'>;

export type ChangeOutcome = {
  /** True when the change took effect; false when it now waits for an approver. */
  readonly applied: boolean;
  readonly requestId: string | null;
  readonly view: CommitmentView;
};

export type TraceNode = {
  readonly view: CommitmentView;
  readonly conditions: readonly Condition[];
  readonly variance: Variance;
  readonly children: readonly TraceNode[];
};

export type Trace = {
  /** From the root commitment down to this one: navigating upward from execution to intent (§14). */
  readonly ancestors: readonly CommitmentView[];
  readonly self: TraceNode;
  /** The root's origin — the decision, objective or obligation everything answers to. */
  readonly origin: Origin;
};

export type ForgeRuntime = ReturnType<typeof createForgeRuntime>;

const blank = (s: string | null | undefined): boolean => s === null || s === undefined || s.trim().length === 0;

export function createForgeRuntime(deps: ForgeRuntimeDeps) {
  const { store, clock, ids } = deps;
  const authority = deps.authority ?? interimAuthority;
  const now = (): string => clock.now();

  // ------------------------------------------------------------- reading

  async function load(scope: Scope, id: string, lens: Lens = latestAt(now())): Promise<Result<CommitmentView>> {
    const rec = await store.getCommitment(scope, id);
    if (!rec.ok) return rec;
    if (rec.value === null) return fail('commitment.not_found', 'That commitment does not exist, or you cannot see it.', { id });
    const evs = await store.eventsFor(scope, [id]);
    if (!evs.ok) return evs;
    const v = deriveView(rec.value, evs.value, lens);
    if (v === null) return fail('commitment.not_known_at_lens', 'Forge had not recorded this commitment at that moment.', { id });
    return ok(v);
  }

  async function loadAll(scope: Scope, lens: Lens): Promise<Result<CommitmentView[]>> {
    const recs = await store.listCommitments(scope);
    if (!recs.ok) return recs;
    const evs = await store.eventsFor(scope, recs.value.map((r) => r.id));
    if (!evs.ok) return evs;
    const byId = new Map<string, CommitmentEvent[]>();
    for (const e of evs.value) {
      const on = byId.get(e.commitmentId);
      if (on) on.push(e);
      else byId.set(e.commitmentId, [e]);
    }
    return ok(recs.value.map((r) => derived(scope, r, byId.get(r.id) ?? [], lens)).filter((v): v is CommitmentView => v !== null));
  }

  /**
   * Derivation, remembered per reader and commitment for the reading of everything recorded (the console's): a view
   * depends only on the record, the events it sees and the lens, and history only grows, so the same record with the
   * same number of events ending in the same event derives the same view. A reading at an earlier lens is derived
   * afresh. What is remembered is a copy of a derivation — dropping it changes nothing.
   */
  const memo = new Map<string, { readonly signature: string; readonly view: CommitmentView }>();
  function derived(scope: Scope, record: CommitmentRecord, events: readonly CommitmentEvent[], lens: Lens): CommitmentView | null {
    if (lens.recordedThrough !== END_OF_RECORD) return deriveView(record, events, lens);
    const key = `${readerKey(scope)}|${record.id}`;
    const signature = `${record.recordedAt}|${events.length}|${events.at(-1)?.id ?? ''}`;
    const hit = memo.get(key);
    if (hit && hit.signature === signature) return hit.view.lens === lens ? hit.view : { ...hit.view, lens };
    const view = deriveView(record, events, lens);
    if (view !== null) memo.set(key, { signature, view });
    return view;
  }

  async function authorize(scope: Scope, act: AuthorityAct, view: CommitmentView | null): Promise<Result<AuthorityVerdict>> {
    const verdict = await authority.evaluate(scope, act, view);
    if (verdict.outcome === 'REFUSED') {
      return fail('authority.refused', verdict.statement, { policy: verdict.policy, rule: verdict.rule });
    }
    if (deps.requireTrustedAuthority && isConsequential(act) && !verdict.trusted) {
      return fail(
        'authority.untrusted',
        'This act changes what someone is accountable for, and only Helm’s trusted authority service may allow it here. Forge’s interim policy is not enough.',
        { policy: verdict.policy, rule: verdict.rule },
      );
    }
    return ok(verdict);
  }

  const basis = (v: AuthorityVerdict, approvalRequestId: string | null = null): AuthorityBasis => ({
    policy: v.policy,
    rule: v.rule,
    statement: v.statement,
    approvalRequestId,
    trusted: v.trusted,
    ...(v.attestation ? { attestation: v.attestation } : {}),
  });

  function event<T extends EventType>(
    scope: Scope,
    commitmentId: string,
    type: T,
    payload: EventPayloads[T],
    opts: { reason?: string | null; authority?: AuthorityBasis | null; effectiveAt?: string; idempotencyKey?: string | null; raise?: Protection } = {},
  ): NewEvent {
    const raised = protectionOf(opts.raise ?? []);
    return {
      id: ids.next('evt'),
      orgId: scope.orgId,
      commitmentId,
      type,
      effectiveAt: opts.effectiveAt ?? now(),
      actor: scope.actor,
      reason: opts.reason ?? null,
      ...(raised.length > 0 ? { textProtection: raised } : {}),
      authority: opts.authority ?? null,
      idempotencyKey: opts.idempotencyKey ?? null,
      payload,
    } as NewEvent;
  }

  async function append(scope: Scope, id: string, events: NewEvent[]): Promise<Result<CommitmentView>> {
    if (events.length > 0) {
      const stamped = await stampText(scope, events);
      if (!stamped.ok) return stamped;
      const written = await store.appendEvents(scope, stamped.value);
      if (!written.ok) return written;
    }
    return load(scope, id);
  }

  /**
   * Words people write take the ceiling of the commitment they are written on (ADR-0017): every class it rests on
   * when they are written, joined with whatever the writer raised it to. Nobody classifies a sentence; nothing lowers.
   */
  async function stampText(scope: Scope, events: NewEvent[]): Promise<Result<NewEvent[]>> {
    if (!events.some(hasText)) return ok(events);
    const out: NewEvent[] = [];
    const seen = new Map<string, { record: CommitmentRecord; events: readonly (CommitmentEvent | NewEvent)[] }>();
    for (const e of events) {
      let on = seen.get(e.commitmentId);
      if (!on) {
        const rec = await store.getCommitment(scope, e.commitmentId);
        if (!rec.ok) return rec;
        if (rec.value === null) return fail('commitment.not_found', 'That commitment does not exist, or you cannot see it.', { id: e.commitmentId });
        const evs = await store.eventsFor(scope, [e.commitmentId]);
        if (!evs.ok) return evs;
        on = { record: rec.value, events: evs.value };
      }
      // ADR-0024: the ceiling, as far as the writer could read it — words carry only what their writer could have seen.
      // A scope that does not say what its reader is cleared for writes at the full ceiling: unknown is not uncleared.
      const ceiling = textCeiling(on.record, on.events);
      const textProtection = hasText(e) ? joinProtection(scope.clearances === undefined ? ceiling : readableBy(scope.clearances, ceiling), e.textProtection) : [];
      const rest = { ...e } as Record<string, unknown>;
      delete rest.textProtection;
      const stamped = (textProtection.length > 0 ? { ...rest, textProtection } : rest) as NewEvent;
      out.push(stamped);
      seen.set(e.commitmentId, { record: on.record, events: [...on.events, stamped] });
    }
    return ok(out);
  }

  /** The act was already recorded under this key: report the commitment as it stands. */
  async function replayed(scope: Scope, key: string | null | undefined): Promise<Result<boolean>> {
    if (!key) return ok(false);
    const found = await store.findByIdempotencyKey(scope, key);
    if (!found.ok) return found;
    return ok(found.value !== null);
  }

  // ------------------------------------------------------------ proposing

  async function propose(scope: Scope, input: ProposeInput): Promise<Result<CommitmentView>> {
    const termsOk = validateTerms(input.terms, false);
    if (!termsOk.ok) return termsOk;
    if (input.origin.kind !== 'DIRECT' && blank(input.origin.ref)) {
      return fail('commitment.origin_unreferenced', 'A commitment that answers to something must say what — the origin needs a reference.');
    }
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      const parent = await store.getCommitment(scope, parentId);
      if (!parent.ok) return parent;
      if (parent.value === null) return fail('commitment.parent_not_found', 'The parent commitment does not exist.');
    }
    const verdict = await authorize(scope, { kind: 'PROPOSE' }, null);
    if (!verdict.ok) return verdict;

    const capture = Object.fromEntries(termFields.map((f) => [f, input.capture?.[f] ?? 'MANUAL'])) as Record<TermField, CaptureMode>;
    const record: Omit<CommitmentRecord, 'recordedAt'> = {
      id: ids.next('cmt'),
      orgId: scope.orgId,
      parentId,
      origin: input.origin,
      terms: input.terms,
      capture,
      context: input.context ?? [],
      proposedBy: scope.actor,
      proposedAt: input.effectiveAt ?? now(),
      fingerprint: fingerprint('cfp', { origin: input.origin, parentId, terms: input.terms }),
    };
    const inserted = await store.insertCommitment(scope, record);
    if (!inserted.ok) return inserted;

    const b = basis(verdict.value);
    const follow: NewEvent[] = [
      ...(input.dependencies ?? []).map((dependency) =>
        event(scope, record.id, 'DEPENDENCY_DECLARED', { dependency }, { authority: b, effectiveAt: record.proposedAt }),
      ),
      ...(input.links ?? []).map((l) =>
        event(scope, record.id, 'EXECUTION_LINKED', { link: { ...l, id: ids.next('lnk') } }, { authority: b, effectiveAt: record.proposedAt }),
      ),
    ];
    return append(scope, record.id, follow);
  }

  // -------------------------------------------------------- accountability

  async function accept(
    scope: Scope,
    id: string,
    input: { readonly evidence?: readonly EvidenceRequirement[]; readonly reason?: string | null } & ActOptions = {},
  ): Promise<Result<CommitmentView>> {
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    const v = loaded.value;
    if (v.phase !== 'PROPOSED') return fail('commitment.not_proposed', 'Only a proposed commitment can be accepted.', { phase: v.phase });
    const verdict = await authorize(scope, { kind: 'ACCEPT' }, v);
    if (!verdict.ok) return verdict;

    const finalEvidence = input.evidence ?? v.terms.evidence;
    const evOk = validateRequirements(finalEvidence);
    if (!evOk.ok) return evOk;
    if (finalEvidence.length === 0) {
      return fail('commitment.evidence_required', 'Say what will prove this commitment before accepting it — Forge could not infer it.');
    }
    const evidenceChanged = input.evidence !== undefined && canonicalJson(input.evidence) !== canonicalJson(v.terms.evidence);
    // Accepting is reviewing: whatever Forge inferred and the owner lets stand is now confirmed by them.
    const confirmed = termFields.filter((f) => v.capture[f] === 'INFERRED' && !(f === 'evidence' && evidenceChanged));
    return append(scope, id, [
      event(
        scope,
        id,
        'ACCEPTED',
        { party: v.terms.owner, confirmed, evidence: evidenceChanged ? finalEvidence : null },
        { reason: input.reason ?? null, authority: basis(verdict.value), effectiveAt: input.effectiveAt },
      ),
    ]);
  }

  async function decline(scope: Scope, id: string, reason: string, opts: ActOptions = {}): Promise<Result<CommitmentView>> {
    if (blank(reason)) return fail('reason.required', 'Say why you are declining — the principal needs it to decide what happens next.');
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    const v = loaded.value;
    if (v.phase !== 'PROPOSED') return fail('commitment.not_proposed', 'Only a proposed commitment can be declined.', { phase: v.phase });
    const verdict = await authorize(scope, { kind: 'DECLINE' }, v);
    if (!verdict.ok) return verdict;
    return append(scope, id, [
      event(scope, id, 'DECLINED', { party: v.terms.owner }, { reason, authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection }),
    ]);
  }

  // ---------------------------------------------------------------- change

  async function change(scope: Scope, id: string, c: Change, reason: string, opts: ActOptions = {}): Promise<Result<ChangeOutcome>> {
    if (blank(reason)) return fail('reason.required', 'Say why. Forge keeps the reason with the change, for whoever reads this later.');
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    const v = loaded.value;
    const valid = await validateChange(scope, v, c);
    if (!valid.ok) return valid;
    const verdict = await authorize(scope, { kind: 'CHANGE', change: c }, v);
    if (!verdict.ok) return verdict;

    if (verdict.value.outcome === 'REQUIRES_APPROVAL') {
      if (v.changeRequests.some((r) => r.decided === null && r.change.kind === c.kind)) {
        return fail('change.already_requested', 'A change of this kind is already waiting for a decision.');
      }
      const requestId = ids.next('chg');
      const written = await append(scope, id, [
        event(
          scope,
          id,
          'CHANGE_REQUESTED',
          { requestId, change: c, approver: verdict.value.approver },
          { reason, authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection },
        ),
      ]);
      return written.ok ? ok({ applied: false, requestId, view: written.value }) : written;
    }
    const written = await append(scope, id, [applied(scope, id, c, null, reason, basis(verdict.value), opts.effectiveAt)]);
    return written.ok ? ok({ applied: true, requestId: null, view: written.value }) : written;
  }

  function applied(scope: Scope, id: string, c: Change, requestId: string | null, reason: string | null, b: AuthorityBasis, effectiveAt?: string): NewEvent {
    return c.kind === 'CLOSE'
      ? event(
          scope,
          id,
          'CLOSED',
          { resolution: c.resolution, supersededBy: c.supersededBy, confirmedWithoutEvidence: c.confirmedWithoutEvidence, requestId },
          { reason, authority: b, effectiveAt },
        )
      : event(scope, id, 'TERMS_CHANGED', { change: c, requestId }, { reason, authority: b, effectiveAt });
  }

  async function decideChange(
    scope: Scope,
    id: string,
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string | null,
    opts: ActOptions = {},
  ): Promise<Result<CommitmentView>> {
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    const v = loaded.value;
    const req = v.changeRequests.find((r) => r.requestId === requestId);
    if (!req) return fail('change.not_found', 'There is no such change request on this commitment.');
    if (req.decided !== null) return fail('change.already_decided', 'That change has already been decided.');
    if (decision === 'REJECTED' && blank(reason)) return fail('reason.required', 'Say why you are rejecting the change.');
    const verdict = await authorize(scope, { kind: 'DECIDE_CHANGE', approver: req.approver }, v);
    if (!verdict.ok) return verdict;

    const decided = event(scope, id, 'CHANGE_DECIDED', { requestId, decision }, { reason, authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection });
    if (decision === 'REJECTED') return append(scope, id, [decided]);
    const stillValid = await validateChange(scope, v, req.change);
    if (!stillValid.ok) return stillValid;
    return append(scope, id, [decided, applied(scope, id, req.change, requestId, req.reason, basis(verdict.value, requestId), opts.effectiveAt)]);
  }

  async function close(
    scope: Scope,
    id: string,
    input: { readonly resolution: Extract<Change, { kind: 'CLOSE' }>['resolution']; readonly supersededBy?: string | null; readonly confirmedWithoutEvidence?: boolean },
    reason: string,
    opts: ActOptions = {},
  ): Promise<Result<ChangeOutcome>> {
    return change(
      scope,
      id,
      { kind: 'CLOSE', resolution: input.resolution, supersededBy: input.supersededBy ?? null, confirmedWithoutEvidence: input.confirmedWithoutEvidence ?? false },
      reason,
      opts,
    );
  }

  async function reopen(scope: Scope, id: string, reason: string, opts: ActOptions = {}): Promise<Result<CommitmentView>> {
    if (blank(reason)) return fail('reason.required', 'Say why the commitment is reopened.');
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    if (loaded.value.phase !== 'CLOSED') return fail('commitment.not_closed', 'Only a closed commitment can be reopened.');
    const verdict = await authorize(scope, { kind: 'REOPEN' }, loaded.value);
    if (!verdict.ok) return verdict;
    return append(scope, id, [event(scope, id, 'REOPENED', {}, { reason, authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection })]);
  }

  async function validateChange(scope: Scope, v: CommitmentView, c: Change): Promise<Result<true>> {
    if (v.phase === 'CLOSED') return fail('commitment.closed', 'This commitment is closed. Reopen it first if the record is wrong.');
    switch (c.kind) {
      case 'REDATE':
        if (!isIsoDate(c.dueBy)) return fail('terms.invalid_date', 'The new due date is not a date.');
        if (c.dueBy === v.terms.dueBy) return fail('change.no_effect', 'That is already the due date.');
        return ok(true);
      case 'RESCOPE': {
        if (c.statement === null && c.intendedOutcome === null && c.evidence === null && c.measures === null) {
          return fail('change.no_effect', 'A rescope has to change something.');
        }
        if (c.statement !== null && blank(c.statement)) return fail('terms.statement_required', 'The commitment needs a statement.');
        if (c.evidence !== null) {
          const r = validateRequirements(c.evidence);
          if (!r.ok) return r;
          if (v.phase === 'ACTIVE' && c.evidence.length === 0) return fail('commitment.evidence_required', 'An accepted commitment has to keep saying what proves it.');
        }
        if (c.measures !== null) {
          const r = validateMeasures(c.measures);
          if (!r.ok) return r;
        }
        return ok(true);
      }
      case 'REASSIGN':
        if (blank(c.owner.label)) return fail('terms.owner_required', 'Name who takes the commitment over.');
        if (sameParty(c.owner, v.terms.owner)) return fail('change.no_effect', `${c.owner.label} already owns this commitment.`);
        return ok(true);
      case 'CLOSE':
        return validateClose(scope, v, c);
    }
  }

  async function validateClose(scope: Scope, v: CommitmentView, c: Extract<Change, { kind: 'CLOSE' }>): Promise<Result<true>> {
    const delivery = c.resolution === 'FULFILLED' || c.resolution === 'PARTIALLY_FULFILLED' || c.resolution === 'MISSED';
    if (delivery && v.phase !== 'ACTIVE') {
      return fail('commitment.not_active', 'Only an accepted commitment can be closed as delivered, partly delivered or missed.');
    }
    if (c.resolution === 'FULFILLED') {
      const required = v.requirements.filter((r) => r.requirement.required);
      const disputed = required.filter((r) => r.status === 'CONFLICTED' || r.status === 'CONTRADICTED');
      if (disputed.length > 0) {
        return fail('commitment.evidence_disputed', 'The evidence disagrees. Settle which source is right before closing this as fulfilled.', {
          requirements: disputed.map((r) => r.requirement.key),
        });
      }
      const missing = required.filter((r) => r.status !== 'EVIDENCED');
      if (missing.length > 0 && !c.confirmedWithoutEvidence) {
        return fail(
          'commitment.evidence_missing',
          `Nothing yet proves ${missing.map((r) => `“${r.requirement.description}”`).join(' or ')}. Close it on your own confirmation, or wait for the evidence.`,
          { requirements: missing.map((r) => r.requirement.key) },
        );
      }
    }
    if (c.resolution === 'SUPERSEDED') {
      if (blank(c.supersededBy)) return fail('commitment.superseded_by_required', 'Say which commitment supersedes this one.');
      const other = await store.getCommitment(scope, c.supersededBy as string);
      if (!other.ok) return other;
      if (other.value === null || other.value.id === v.record.id) return fail('commitment.superseded_by_invalid', 'The superseding commitment does not exist.');
    }
    if (c.resolution === 'INVALIDATED' && !v.contextChanges.some((cc) => cc.material)) {
      return fail('commitment.no_context_change', 'Record what changed in the world before closing this as invalidated by it.');
    }
    return ok(true);
  }

  // ------------------------------------------------------------- evidence

  async function recordEvidence(scope: Scope, id: string, input: EvidenceInput, opts: ActOptions = {}): Promise<Result<CommitmentView>> {
    const seen = await replayed(scope, opts.idempotencyKey);
    if (!seen.ok) return seen;
    if (seen.value) return load(scope, id);
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    const v = loaded.value;
    const valid = validateEvidence(v, input);
    if (!valid.ok) return valid;
    const verdict = await authorize(scope, { kind: 'RECORD_EVIDENCE', evidence: input }, v);
    if (!verdict.ok) return verdict;
    return append(scope, id, [
      event(scope, id, 'EVIDENCE_RECORDED', { evidence: { ...input, id: ids.next('evd') } }, {
        authority: basis(verdict.value),
        effectiveAt: opts.effectiveAt, raise: opts.textProtection,
        idempotencyKey: opts.idempotencyKey,
      }),
    ]);
  }

  async function disputeEvidence(scope: Scope, id: string, evidenceId: string, reason: string, opts: ActOptions = {}): Promise<Result<CommitmentView>> {
    if (blank(reason)) return fail('reason.required', 'Say why the evidence is wrong — it stays on the record with your reason.');
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    const entry = loaded.value.evidence.find((e) => e.item.id === evidenceId);
    if (!entry) return fail('evidence.not_found', 'There is no such evidence on this commitment.');
    if (entry.disputed !== null) return fail('evidence.already_disputed', 'That evidence is already disputed.');
    const verdict = await authorize(scope, { kind: 'DISPUTE_EVIDENCE' }, loaded.value);
    if (!verdict.ok) return verdict;
    return append(scope, id, [event(scope, id, 'EVIDENCE_DISPUTED', { evidenceId }, { reason, authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection })]);
  }

  // ------------------------------------------------------------ execution

  async function linkExecution(scope: Scope, id: string, link: Omit<ExecutionLink, 'id'>, opts: ActOptions = {}): Promise<Result<CommitmentView>> {
    if (blank(link.system) || blank(link.ref)) return fail('link.invalid', 'An execution link names a system and the object in it.');
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    if (loaded.value.links.some((l) => l.link.system === link.system && l.link.ref === link.ref)) return ok(loaded.value);
    const verdict = await authorize(scope, { kind: 'LINK_EXECUTION' }, loaded.value);
    if (!verdict.ok) return verdict;
    return append(scope, id, [
      event(scope, id, 'EXECUTION_LINKED', { link: { ...link, id: ids.next('lnk') } }, { authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection }),
    ]);
  }

  async function observeActivity(
    scope: Scope,
    id: string,
    input: { readonly linkId: string; readonly done: number; readonly total: number; readonly unit: string; readonly observationId: string | null },
    opts: ActOptions = {},
  ): Promise<Result<CommitmentView>> {
    const seen = await replayed(scope, opts.idempotencyKey);
    if (!seen.ok) return seen;
    if (seen.value) return load(scope, id);
    if (!Number.isInteger(input.done) || !Number.isInteger(input.total) || input.done < 0 || input.total < 0 || input.done > input.total) {
      return fail('activity.invalid', 'Activity counts must be whole numbers, with done no greater than the total.');
    }
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    if (!loaded.value.links.some((l) => l.link.id === input.linkId)) return fail('link.not_found', 'There is no such execution link on this commitment.');
    const verdict = await authorize(scope, { kind: 'OBSERVE_ACTIVITY' }, loaded.value);
    if (!verdict.ok) return verdict;
    return append(scope, id, [
      event(scope, id, 'ACTIVITY_OBSERVED', input, { authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection, idempotencyKey: opts.idempotencyKey }),
    ]);
  }

  async function declareDependency(scope: Scope, id: string, dependency: Dependency, opts: ActOptions = {}): Promise<Result<CommitmentView>> {
    if (blank(dependency.key) || blank(dependency.description)) return fail('dependency.invalid', 'A dependency needs a key and a description.');
    if (dependency.neededBy !== null && !isIsoDate(dependency.neededBy)) return fail('dependency.invalid_date', 'The needed-by date is not a date.');
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    if (loaded.value.dependencies.some((d) => d.dependency.key === dependency.key)) return fail('dependency.duplicate', 'That dependency is already declared.');
    if (dependency.on.kind === 'COMMITMENT') {
      if (dependency.on.commitmentId === id) return fail('dependency.self', 'A commitment cannot depend on itself.');
      const other = await store.getCommitment(scope, dependency.on.commitmentId);
      if (!other.ok) return other;
      if (other.value === null) return fail('dependency.not_found', 'The commitment it depends on does not exist.');
    }
    const verdict = await authorize(scope, { kind: 'DECLARE_DEPENDENCY' }, loaded.value);
    if (!verdict.ok) return verdict;
    return append(scope, id, [event(scope, id, 'DEPENDENCY_DECLARED', { dependency }, { authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection })]);
  }

  async function settleDependency(
    scope: Scope,
    id: string,
    key: string,
    input: { readonly observationId: string | null; readonly reason?: string | null },
    opts: ActOptions = {},
  ): Promise<Result<CommitmentView>> {
    const seen = await replayed(scope, opts.idempotencyKey);
    if (!seen.ok) return seen;
    if (seen.value) return load(scope, id);
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    const dep = loaded.value.dependencies.find((d) => d.dependency.key === key);
    if (!dep) return fail('dependency.not_found', 'There is no such dependency on this commitment.');
    if (dep.settled !== null) return ok(loaded.value);
    const verdict = await authorize(scope, { kind: 'SETTLE_DEPENDENCY' }, loaded.value);
    if (!verdict.ok) return verdict;
    return append(scope, id, [
      event(scope, id, 'DEPENDENCY_SETTLED', { key, observationId: input.observationId }, {
        reason: input.reason ?? null,
        authority: basis(verdict.value),
        effectiveAt: opts.effectiveAt, raise: opts.textProtection,
        idempotencyKey: opts.idempotencyKey,
      }),
    ]);
  }

  // -------------------------------------------------------------- outcome

  async function recordOutcome(scope: Scope, id: string, outcome: ObservedOutcome, opts: ActOptions = {}): Promise<Result<CommitmentView>> {
    if (blank(outcome.statement)) return fail('outcome.statement_required', 'Say what actually happened.');
    if (outcome.achievedOn !== null && !isIsoDate(outcome.achievedOn)) return fail('outcome.invalid_date', 'The achieved-on date is not a date.');
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    const v = loaded.value;
    const unknownMeasure = outcome.measures.find((m) => !v.terms.measures.some((x) => x.key === m.key));
    if (unknownMeasure) return fail('outcome.unknown_measure', `“${unknownMeasure.key}” is not one of this commitment’s measures.`);
    const badActual = outcome.measures.find((m) => {
      const def = v.terms.measures.find((x) => x.key === m.key);
      return def !== undefined && def.comparator !== 'QUALITATIVE' && m.actual !== null && !isDecimal(m.actual);
    });
    if (badActual) return fail('outcome.invalid_measure', `The actual value for “${badActual.key}” must be a number.`);
    const unknownBasis = outcome.basis.find((b) => !v.evidence.some((e) => e.item.id === b));
    if (unknownBasis) return fail('outcome.unknown_basis', 'An outcome can only rest on evidence recorded on this commitment.');
    const verdict = await authorize(scope, { kind: 'RECORD_OUTCOME' }, v);
    if (!verdict.ok) return verdict;
    // ADR-0017: an actual carries its measure's class; the outcome carries the classes of the evidence it rests on.
    const stamped: ObservedOutcome = {
      ...outcome,
      measures: outcome.measures.map((m) => ({ ...m, protection: protectionOf(v.terms.measures.find((x) => x.key === m.key)?.protection ?? []) })),
      protection: joinProtection(...outcome.basis.map((b) => v.evidence.find((e) => e.item.id === b)?.item.protection)),
    };
    return append(scope, id, [event(scope, id, 'OUTCOME_OBSERVED', { outcome: stamped }, { authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection })]);
  }

  // -------------------------------------------------------------- context

  async function recordContextChange(
    scope: Scope,
    id: string,
    input: { readonly source: SourceRef; readonly statement: string; readonly material: boolean },
    opts: ActOptions = {},
  ): Promise<Result<CommitmentView>> {
    if (blank(input.statement)) return fail('context.statement_required', 'Say what changed.');
    const seen = await replayed(scope, opts.idempotencyKey);
    if (!seen.ok) return seen;
    if (seen.value) return load(scope, id);
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    const verdict = await authorize(scope, { kind: 'RECORD_CONTEXT_CHANGE' }, loaded.value);
    if (!verdict.ok) return verdict;
    return append(scope, id, [
      event(scope, id, 'CONTEXT_CHANGED', input, { authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection, idempotencyKey: opts.idempotencyKey }),
    ]);
  }

  async function reaffirm(scope: Scope, id: string, contextEventId: string, reason: string, opts: ActOptions = {}): Promise<Result<CommitmentView>> {
    if (blank(reason)) return fail('reason.required', 'Say why the commitment still stands.');
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    const cc = loaded.value.contextChanges.find((c) => c.eventId === contextEventId);
    if (!cc) return fail('context.not_found', 'There is no such context change on this commitment.');
    if (cc.reaffirmed !== null) return fail('context.already_reaffirmed', 'The commitment was already reaffirmed after this change.');
    const verdict = await authorize(scope, { kind: 'REAFFIRM' }, loaded.value);
    if (!verdict.ok) return verdict;
    return append(scope, id, [event(scope, id, 'CONTEXT_REAFFIRMED', { contextEventId }, { reason, authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection })]);
  }

  // ------------------------------------------------------------- learning

  async function recordLearning(scope: Scope, id: string, input: Omit<Learning, 'id'>, opts: ActOptions = {}): Promise<Result<CommitmentView>> {
    if (blank(input.statement)) return fail('learning.statement_required', 'Say what the enterprise should remember.');
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    const verdict = await authorize(scope, { kind: 'RECORD_LEARNING' }, loaded.value);
    if (!verdict.ok) return verdict;
    return append(scope, id, [
      event(scope, id, 'LEARNING_RECORDED', { learning: { ...input, id: ids.next('lrn') } }, { authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection }),
    ]);
  }

  // ------------------------------------------------------------ publication

  /** Publish a verified outcome for Helm's enterprise memory. Re-publishing unchanged content changes nothing. */
  async function publishOutcome(scope: Scope, id: string, opts: ActOptions = {}): Promise<Result<{ view: CommitmentView; publication: OutcomePublication }>> {
    const loaded = await load(scope, id);
    if (!loaded.ok) return loaded;
    const verified = verifyOutcome(loaded.value);
    if (!verified.ok) return fail(verified.error.code, verified.error.message, verified.error.details);
    const publication = verified.value;
    const verdict = await authorize(scope, { kind: 'PUBLISH_OUTCOME' }, loaded.value);
    if (!verdict.ok) return verdict;
    const key = `publish:${id}:${publication.fingerprint}`;
    const seen = await replayed(scope, key);
    if (!seen.ok) return seen;
    if (seen.value) return ok({ view: loaded.value, publication });
    const written = await append(scope, id, [
      event(scope, id, 'OUTCOME_PUBLISHED', { publication }, { authority: basis(verdict.value), effectiveAt: opts.effectiveAt, raise: opts.textProtection, idempotencyKey: key }),
    ]);
    return written.ok ? ok({ view: written.value, publication }) : written;
  }

  // ------------------------------------------------------------- candidates

  function candidateStore(): Result<CandidateStore> {
    return deps.candidates ? ok(deps.candidates) : fail('candidates.unavailable', 'This Forge has no candidate store configured.');
  }

  async function listCandidates(scope: Scope): Promise<Result<CandidateView[]>> {
    const cs = candidateStore();
    if (!cs.ok) return cs;
    const recs = await cs.value.listCandidates(scope);
    if (!recs.ok) return recs;
    const disps = await cs.value.listDispositions(scope);
    if (!disps.ok) return disps;
    return ok(candidateViews(recs.value, disps.value));
  }

  /** Suggest candidates. Anything already read from the same source sentence or promise is returned, not duplicated. */
  async function suggestCandidates(scope: Scope, inputs: readonly SuggestCandidateInput[]): Promise<Result<CandidateView[]>> {
    const cs = candidateStore();
    if (!cs.ok) return cs;
    const verdict = await authorize(scope, { kind: 'SUGGEST_CANDIDATE' }, null);
    if (!verdict.ok) return verdict;
    for (const c of inputs) {
      const valid = validateCandidate(c);
      if (!valid.ok) return valid;
    }
    const existing = await listCandidates(scope);
    if (!existing.ok) return existing;
    const known = new Set(existing.value.map((v) => v.record.dedupeKey));
    const fresh: Omit<CandidateRecord, 'recordedAt'>[] = [];
    for (const c of inputs) {
      if (known.has(c.dedupeKey)) continue;
      known.add(c.dedupeKey);
      fresh.push({ ...c, id: ids.next('cnd'), orgId: scope.orgId, epistemic: 'INFERENCE', suggestedBy: scope.actor, suggestedAt: now(), fingerprint: candidateFingerprint(c) });
    }
    if (fresh.length > 0) {
      const written = await cs.value.insertCandidates(scope, fresh);
      if (!written.ok) return written;
    }
    const after = await listCandidates(scope);
    if (!after.ok) return after;
    const keys = new Set(inputs.map((c) => c.dedupeKey));
    return ok(after.value.filter((v) => keys.has(v.record.dedupeKey)));
  }

  async function pendingCandidate(scope: Scope, candidateId: string): Promise<Result<CandidateView>> {
    const all = await listCandidates(scope);
    if (!all.ok) return all;
    const c = all.value.find((v) => v.record.id === candidateId);
    if (!c) return fail('candidate.not_found', 'There is no such candidate.');
    if (c.state !== 'PENDING') return fail('candidate.already_disposed', `That candidate was already ${c.state.toLowerCase()}.`);
    return ok(c);
  }

  async function dismissCandidate(scope: Scope, candidateId: string, reason: string): Promise<Result<CandidateView>> {
    if (blank(reason)) return fail('reason.required', 'Say why this is not a commitment — the reason is kept with what was read.');
    const cs = candidateStore();
    if (!cs.ok) return cs;
    if (scope.actor.kind !== 'PERSON') return fail('authority.refused', 'Only a person decides that what was read is not a commitment.');
    const verdict = await authorize(scope, { kind: 'DISPOSE_CANDIDATE' }, null);
    if (!verdict.ok) return verdict;
    const c = await pendingCandidate(scope, candidateId);
    if (!c.ok) return c;
    const d = await cs.value.insertDisposition(scope, {
      id: ids.next('dsp'),
      orgId: scope.orgId,
      candidateId,
      kind: 'DISMISSED',
      actor: scope.actor,
      at: now(),
      reason,
      commitmentId: null,
      edited: [],
    });
    if (!d.ok) return d;
    return ok({ record: c.value.record, state: 'DISMISSED', disposition: d.value });
  }

  /**
   * A person confirms a candidate — as read, or edited — which PROPOSES a commitment linked to the candidate's
   * source. The commitment still binds nobody until its owner accepts it: two people stand between a sentence
   * and an obligation.
   */
  async function confirmCandidate(
    scope: Scope,
    candidateId: string,
    input: Pick<ProposeInput, 'terms' | 'parentId' | 'dependencies' | 'links'> & { readonly reason?: string | null },
  ): Promise<Result<{ candidate: CandidateView; commitment: CommitmentView }>> {
    const cs = candidateStore();
    if (!cs.ok) return cs;
    if (scope.actor.kind !== 'PERSON') return fail('authority.refused', 'Only a person turns what was read into a commitment. A model proposes; it never confirms.');
    const verdict = await authorize(scope, { kind: 'DISPOSE_CANDIDATE' }, null);
    if (!verdict.ok) return verdict;
    const c = await pendingCandidate(scope, candidateId);
    if (!c.ok) return c;
    const rec = c.value.record;
    const edited = editedTerms(rec.proposal, input.terms);
    const fromSource: CaptureMode = rec.source.kind === 'MEMOIRE_PROMISE' ? 'INHERITED' : 'EXTRACTED';
    const capture: Partial<Record<TermField, CaptureMode>> = {};
    for (const f of ['statement', 'intendedOutcome', 'owner', 'principal', 'dueBy', 'evidence'] as const) capture[f] = edited.includes(f) ? 'MANUAL' : fromSource;
    const conversation = rec.source.kind !== 'MEMOIRE_PROMISE';
    const proposed = await propose(scope, {
      origin: {
        kind: conversation ? 'COMMUNICATION' : 'OBLIGATION',
        system: rec.source.system,
        ref: rec.source.ref,
        label: rec.source.label,
        fingerprint: rec.fingerprint,
        snapshot: {
          candidateId: rec.id,
          quote: rec.source.quote,
          locator: rec.source.locator,
          utteranceClass: rec.utteranceClass,
          confidence: rec.confidence,
          extractor: rec.extractor,
          observedAt: rec.source.observedAt,
        },
      },
      parentId: input.parentId ?? null,
      terms: input.terms,
      capture,
      context: [
        {
          key: 'context.source',
          label: conversation ? 'Said in' : 'Promised in',
          value: `${rec.source.label}${rec.source.locator ? ` (${rec.source.locator})` : ''}${rec.source.quote ? ` — “${rec.source.quote}”` : ''}`,
          capture: 'INHERITED',
          epistemic: 'FACT',
          source: { system: rec.source.system, ref: rec.source.ref, url: null },
          entityRef: rec.source.entityRef,
        },
        {
          key: 'context.candidate',
          label: 'Read by',
          value: `${rec.extractor.name}${rec.extractor.model ? ` (${rec.extractor.model})` : ''} as a ${rec.utteranceClass.toLowerCase()}, confidence ${rec.confidence.toFixed(2)}; confirmed by ${scope.actor.label}`,
          capture: 'INFERRED',
          epistemic: 'INFERENCE',
          source: { system: 'forge', ref: rec.id, url: null },
          entityRef: null,
        },
      ],
      dependencies: input.dependencies,
      links: input.links,
    });
    if (!proposed.ok) return proposed;
    const d = await cs.value.insertDisposition(scope, {
      id: ids.next('dsp'),
      orgId: scope.orgId,
      candidateId,
      kind: 'CONFIRMED',
      actor: scope.actor,
      at: now(),
      reason: input.reason ?? null,
      commitmentId: proposed.value.record.id,
      edited,
    });
    if (!d.ok) return d;
    return ok({ candidate: { record: rec, state: 'CONFIRMED', disposition: d.value }, commitment: proposed.value });
  }

  // ----------------------------------------------------------------- reads

  async function list(scope: Scope, opts: { readonly lens?: Lens; readonly parentId?: string | null; readonly originRef?: string } = {}): Promise<Result<CommitmentView[]>> {
    const all = await loadAll(scope, opts.lens ?? latestAt(now()));
    if (!all.ok) return all;
    return ok(
      all.value.filter(
        (v) =>
          (opts.parentId === undefined || v.record.parentId === opts.parentId) &&
          (opts.originRef === undefined || v.record.origin.ref === opts.originRef),
      ),
    );
  }

  async function conditions(scope: Scope, lens: Lens = latestAt(now())): Promise<Result<Condition[]>> {
    const all = await loadAll(scope, lens);
    if (!all.ok) return all;
    const byId = new Map(all.value.map((v) => [v.record.id, v]));
    const lookup = (cid: string) => byId.get(cid) ?? null;
    return ok(all.value.flatMap((v) => conditionsOf(v, lookup)).sort(bySeverity));
  }

  async function asks(scope: Scope, lens: Lens = latestAt(now()), actsAs: readonly Party[] = scope.actsAs): Promise<Result<Condition[]>> {
    const all = await conditions(scope, lens);
    return all.ok ? ok(asksFor(all.value, actsAs)) : all;
  }

  async function trace(scope: Scope, id: string, lens: Lens = latestAt(now())): Promise<Result<Trace>> {
    const all = await loadAll(scope, lens);
    if (!all.ok) return all;
    const byId = new Map(all.value.map((v) => [v.record.id, v]));
    const self = byId.get(id);
    if (!self) return fail('commitment.not_found', 'That commitment does not exist, or you cannot see it at this moment.');
    const ancestors: CommitmentView[] = [];
    let cursor = self.record.parentId;
    const guard = new Set<string>([id]);
    while (cursor !== null && !guard.has(cursor)) {
      const parent = byId.get(cursor);
      if (!parent) break;
      ancestors.unshift(parent);
      guard.add(cursor);
      cursor = parent.record.parentId;
    }
    const root = ancestors[0] ?? self;
    return ok({ ancestors, self: buildNode(self, all.value, byId), origin: root.record.origin });
  }

  /** Downward from a decision (or any origin) to what happened (§14): every commitment answering to it, with their descendants. */
  async function traceOrigin(scope: Scope, originRef: string, lens: Lens = latestAt(now())): Promise<Result<TraceNode[]>> {
    const all = await loadAll(scope, lens);
    if (!all.ok) return all;
    const byId = new Map(all.value.map((v) => [v.record.id, v]));
    return ok(
      all.value
        .filter((v) => v.record.origin.ref === originRef && (v.record.parentId === null || byId.get(v.record.parentId)?.record.origin.ref !== originRef))
        .map((v) => buildNode(v, all.value, byId)),
    );
  }

  function buildNode(v: CommitmentView, all: readonly CommitmentView[], byId: Map<string, CommitmentView>, seen = new Set<string>()): TraceNode {
    seen.add(v.record.id);
    const lookup = (cid: string) => byId.get(cid) ?? null;
    return {
      view: v,
      conditions: conditionsOf(v, lookup).sort(bySeverity),
      variance: varianceOf(v),
      children: all.filter((c) => c.record.parentId === v.record.id && !seen.has(c.record.id)).map((c) => buildNode(c, all, byId, seen)),
    };
  }

  async function episode(scope: Scope, id: string, lens: Lens = latestAt(now())): Promise<Result<ExecutionEpisode>> {
    const v = await load(scope, id, lens);
    return v.ok ? ok(assembleEpisode(v.value)) : v;
  }

  return {
    propose,
    accept,
    decline,
    change,
    decideChange,
    close,
    reopen,
    recordEvidence,
    disputeEvidence,
    linkExecution,
    observeActivity,
    declareDependency,
    settleDependency,
    recordOutcome,
    recordContextChange,
    reaffirm,
    recordLearning,
    publishOutcome,
    suggestCandidates,
    listCandidates,
    dismissCandidate,
    confirmCandidate,
    view: (scope: Scope, id: string, lens?: Lens) => load(scope, id, lens),
    list,
    conditions,
    asks,
    trace,
    traceOrigin,
    episode,
    now,
  };
}

// ------------------------------------------------------------- validation

export function validateTerms(t: Terms, requireEvidence: boolean): Result<true> {
  if (blank(t.statement)) return fail('terms.statement_required', 'Say what is being promised, in one sentence.');
  if (blank(t.intendedOutcome)) return fail('terms.outcome_required', 'Say what changes in the world when this promise is kept.');
  if (blank(t.why)) return fail('terms.why_required', 'Say why it matters.');
  if (blank(t.owner.label)) return fail('terms.owner_required', 'Name who promises.');
  if (blank(t.principal.label)) return fail('terms.principal_required', 'Name who the promise is made to.');
  if (!isIsoDate(t.dueBy)) return fail('terms.invalid_date', 'The due date is not a date.');
  const r = validateRequirements(t.evidence);
  if (!r.ok) return r;
  if (requireEvidence && t.evidence.length === 0) return fail('commitment.evidence_required', 'Say what will prove this commitment.');
  const m = validateMeasures(t.measures);
  if (!m.ok) return m;
  for (const claim of t.value) {
    if (blank(claim.statement)) return fail('value.statement_required', 'Say why the value matters.');
    if (claim.precision === 'POINT' && !isDecimal(claim.low)) return fail('value.invalid', 'A point value needs a number.');
    if (claim.precision === 'RANGE' && (!isDecimal(claim.low) || !isDecimal(claim.high))) return fail('value.invalid', 'A range needs two numbers.');
    if (claim.precision === 'UNQUANTIFIED' && (claim.low !== null || claim.high !== null)) {
      return fail('value.false_precision', 'An unquantified value carries no number. Forge does not manufacture precision.');
    }
  }
  return ok(true);
}

function validateRequirements(reqs: readonly EvidenceRequirement[]): Result<true> {
  const keys = new Set<string>();
  for (const r of reqs) {
    if (blank(r.key) || blank(r.description)) return fail('evidence.requirement_invalid', 'Each piece of required evidence needs a key and a description.');
    if (keys.has(r.key)) return fail('evidence.requirement_duplicate', `Two evidence requirements share the key “${r.key}”.`);
    keys.add(r.key);
    if (r.matcher !== null && (blank(r.matcher.system) || blank(r.matcher.eventType))) {
      return fail('evidence.matcher_invalid', 'A matcher names the system and the event type it waits for.');
    }
  }
  return ok(true);
}

function validateMeasures(measures: readonly OutcomeMeasure[]): Result<true> {
  const keys = new Set<string>();
  for (const m of measures) {
    if (blank(m.key) || blank(m.label)) return fail('measure.invalid', 'Each measure needs a key and a label.');
    if (keys.has(m.key)) return fail('measure.duplicate', `Two measures share the key “${m.key}”.`);
    keys.add(m.key);
    if (m.comparator === 'QUALITATIVE' && m.expected !== null) return fail('measure.false_precision', 'A qualitative measure carries no number.');
    if (m.comparator !== 'QUALITATIVE' && m.expected !== null && !isDecimal(m.expected)) return fail('measure.invalid', `“${m.label}” expects a number.`);
  }
  return ok(true);
}

function validateEvidence(v: CommitmentView, e: EvidenceInput): Result<true> {
  if (blank(e.statement)) return fail('evidence.statement_required', 'Say what the evidence shows.');
  if (e.requirementKey !== null && !v.terms.evidence.some((r) => r.key === e.requirementKey)) {
    return fail('evidence.unknown_requirement', 'That is not one of this commitment’s evidence requirements.');
  }
  if (e.epistemic === 'FACT' && e.confidence !== null) return fail('evidence.fact_with_confidence', 'A fact carries no confidence score; an inference does.');
  if (e.epistemic === 'INFERENCE' && (e.confidence === null || e.confidence < 0 || e.confidence > 1)) {
    return fail('evidence.inference_without_confidence', 'An inference states its confidence, between 0 and 1.');
  }
  if ((e.channel === 'INFERENCE') !== (e.epistemic === 'INFERENCE')) {
    return fail('evidence.class_mismatch', 'Only an inference arrives through the inference channel, and an inference arrives through nothing else.');
  }
  if ((e.channel === 'SYSTEM_EVENT' || e.channel === 'API') && blank(e.source.ref) && blank(e.observationId)) {
    return fail('evidence.unsourced', 'A system’s record names the object it is about.');
  }
  return ok(true);
}
