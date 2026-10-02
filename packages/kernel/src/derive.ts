/**
 * Derivation — a commitment's state at a lens, computed from its identity
 * record and its events. Nothing here is stored: phase, current terms, whether
 * the evidence holds, who must act. A later event never changes an earlier
 * reading, because a reading only sees what was recorded through its lens.
 */

import { type Actor, humanDate, type Party, sameParty } from './primitives.ts';
import type { OutcomePublication } from './publication.ts';
import type {
  AuthorityBasis,
  CaptureMode,
  Change,
  CommitmentEvent,
  CommitmentRecord,
  Dependency,
  EventType,
  EvidenceItem,
  EvidenceMatcher,
  EvidenceRequirement,
  ExecutionLink,
  Learning,
  Lens,
  ObservedOutcome,
  Resolution,
  SourceRef,
  TermField,
  Terms,
} from './types.ts';

export const phases = ['PROPOSED', 'ACTIVE', 'DECLINED', 'CLOSED'] as const;
export type Phase = (typeof phases)[number];

/**
 * OPEN — nothing bears on it yet. INFERRED — only an inference supports it; a
 * person has to confirm. EVIDENCED — a fact supports it and none contradicts.
 * CONTRADICTED — a fact says otherwise and none supports it. CONFLICTED — facts
 * disagree; a person has to say which is right.
 */
export const requirementStatuses = ['OPEN', 'INFERRED', 'EVIDENCED', 'CONTRADICTED', 'CONFLICTED'] as const;
export type RequirementStatus = (typeof requirementStatuses)[number];

export type EvidenceEntry = {
  readonly item: EvidenceItem;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly actor: Actor;
  readonly disputed: { readonly eventId: string; readonly at: string; readonly actor: Actor; readonly reason: string | null } | null;
  /** A later observation of the same object from the same system replaced this one. */
  readonly supersededBy: string | null;
};

export type RequirementState = {
  readonly requirement: EvidenceRequirement;
  readonly status: RequirementStatus;
  /** What an EVIDENCED status rests on: a system's record, or only a person's confirmation. */
  readonly basis: 'SYSTEM' | 'PERSON' | null;
  readonly supporting: readonly string[];
  readonly contradicting: readonly string[];
  readonly inferred: readonly string[];
  /** Forge watches its execution surfaces for this requirement only when the matcher is specific (isWatchable). */
  readonly watched: boolean;
};

export type DependencyState = {
  readonly dependency: Dependency;
  readonly declaredAt: string;
  readonly settled: { readonly at: string; readonly eventId: string; readonly observationId: string | null } | null;
};

export type LinkState = {
  readonly link: ExecutionLink;
  readonly linkedAt: string;
  readonly activity: {
    readonly done: number;
    readonly total: number;
    readonly unit: string;
    readonly observedAt: string;
    readonly eventId: string;
  } | null;
};

export type ChangeRequestState = {
  readonly requestId: string;
  readonly change: Change;
  readonly approver: Party;
  readonly requestedBy: Actor;
  readonly requestedAt: string;
  readonly reason: string | null;
  readonly eventId: string;
  readonly decided: { readonly decision: 'APPROVED' | 'REJECTED'; readonly by: Actor; readonly at: string; readonly reason: string | null } | null;
};

export type ContextChangeState = {
  readonly eventId: string;
  readonly at: string;
  readonly source: SourceRef;
  readonly statement: string;
  readonly material: boolean;
  readonly reaffirmed: { readonly at: string; readonly by: Actor; readonly reason: string | null } | null;
};

export type HistoryEntry = {
  readonly eventId: string | null;
  readonly type: EventType | 'PROPOSED';
  readonly at: string;
  readonly recordedAt: string;
  readonly actor: Actor;
  readonly reason: string | null;
  readonly authority: AuthorityBasis | null;
  readonly summary: string;
};

export type CommitmentView = {
  readonly record: CommitmentRecord;
  readonly lens: Lens;
  readonly phase: Phase;
  readonly terms: Terms;
  readonly capture: Readonly<Record<TermField, CaptureMode>>;
  readonly originalDueBy: string;
  readonly redates: readonly { readonly from: string; readonly to: string; readonly at: string; readonly reason: string | null; readonly eventId: string }[];
  readonly rescopes: readonly { readonly at: string; readonly reason: string | null; readonly eventId: string }[];
  readonly reassignments: readonly { readonly from: Party; readonly to: Party; readonly at: string; readonly reason: string | null; readonly eventId: string }[];
  readonly acceptance: { readonly party: Party; readonly actor: Actor; readonly at: string; readonly eventId: string } | null;
  readonly declined: { readonly party: Party; readonly actor: Actor; readonly at: string; readonly reason: string | null; readonly eventId: string } | null;
  readonly changeRequests: readonly ChangeRequestState[];
  readonly dependencies: readonly DependencyState[];
  readonly links: readonly LinkState[];
  readonly evidence: readonly EvidenceEntry[];
  readonly requirements: readonly RequirementState[];
  readonly outcome: { readonly outcome: ObservedOutcome; readonly at: string; readonly actor: Actor; readonly eventId: string } | null;
  readonly contextChanges: readonly ContextChangeState[];
  readonly resolution: {
    readonly resolution: Resolution;
    readonly at: string;
    readonly actor: Actor;
    readonly reason: string | null;
    readonly supersededBy: string | null;
    readonly confirmedWithoutEvidence: boolean;
    readonly eventId: string;
  } | null;
  readonly learnings: readonly { readonly learning: Learning; readonly at: string; readonly actor: Actor; readonly eventId: string }[];
  /** Verified outcomes published for Helm's enterprise memory, oldest first. */
  readonly publications: readonly { readonly publication: OutcomePublication; readonly at: string; readonly actor: Actor; readonly eventId: string }[];
  readonly history: readonly HistoryEntry[];
  readonly events: readonly CommitmentEvent[];
};

/** Recorded order: when Forge learned it, then the store's sequence. */
export function orderEvents(events: readonly CommitmentEvent[]): CommitmentEvent[] {
  return [...events].sort((a, b) =>
    a.recordedAt === b.recordedAt ? a.seq - b.seq : a.recordedAt < b.recordedAt ? -1 : 1,
  );
}

const visibleAt = (recordedAt: string, lens: Lens): boolean => recordedAt <= lens.recordedThrough;

/** The commitment as it stood at `lens`, or null if Forge had not yet recorded it. */
export function deriveView(record: CommitmentRecord, allEvents: readonly CommitmentEvent[], lens: Lens): CommitmentView | null {
  if (!visibleAt(record.recordedAt, lens)) return null;
  const events = orderEvents(allEvents.filter((e) => e.commitmentId === record.id && visibleAt(e.recordedAt, lens)));

  let phase: Phase = 'PROPOSED';
  let terms: Terms = record.terms;
  const capture: Record<TermField, CaptureMode> = { ...record.capture };
  const redates: CommitmentView['redates'][number][] = [];
  const rescopes: CommitmentView['rescopes'][number][] = [];
  const reassignments: CommitmentView['reassignments'][number][] = [];
  let acceptance: CommitmentView['acceptance'] = null;
  let declined: CommitmentView['declined'] = null;
  const requests = new Map<string, ChangeRequestState>();
  const dependencies = new Map<string, DependencyState>();
  const links = new Map<string, LinkState>();
  const evidence = new Map<string, EvidenceEntry>();
  let outcome: CommitmentView['outcome'] = null;
  const contextChanges = new Map<string, ContextChangeState>();
  let resolution: CommitmentView['resolution'] = null;
  const learnings: CommitmentView['learnings'][number][] = [];
  const publications: CommitmentView['publications'][number][] = [];
  const history: HistoryEntry[] = [
    {
      eventId: null,
      type: 'PROPOSED',
      at: record.proposedAt,
      recordedAt: record.recordedAt,
      actor: record.proposedBy,
      reason: null,
      authority: null,
      summary: `Proposed: ${record.terms.statement}`,
    },
  ];

  for (const e of events) {
    switch (e.type) {
      case 'ACCEPTED': {
        phase = 'ACTIVE';
        declined = null;
        acceptance = { party: e.payload.party, actor: e.actor, at: e.effectiveAt, eventId: e.id };
        for (const field of e.payload.confirmed) capture[field] = 'CONFIRMED';
        if (e.payload.evidence !== null) {
          terms = { ...terms, evidence: e.payload.evidence };
          if (!e.payload.confirmed.includes('evidence')) capture.evidence = 'MANUAL';
        }
        break;
      }
      case 'DECLINED':
        phase = 'DECLINED';
        declined = { party: e.payload.party, actor: e.actor, at: e.effectiveAt, reason: e.reason, eventId: e.id };
        break;
      case 'CHANGE_REQUESTED':
        requests.set(e.payload.requestId, {
          requestId: e.payload.requestId,
          change: e.payload.change,
          approver: e.payload.approver,
          requestedBy: e.actor,
          requestedAt: e.effectiveAt,
          reason: e.reason,
          eventId: e.id,
          decided: null,
        });
        break;
      case 'CHANGE_DECIDED': {
        const req = requests.get(e.payload.requestId);
        if (req) requests.set(req.requestId, { ...req, decided: { decision: e.payload.decision, by: e.actor, at: e.effectiveAt, reason: e.reason } });
        break;
      }
      case 'TERMS_CHANGED': {
        const c = e.payload.change;
        if (c.kind === 'REDATE') {
          redates.push({ from: terms.dueBy, to: c.dueBy, at: e.effectiveAt, reason: e.reason, eventId: e.id });
          terms = { ...terms, dueBy: c.dueBy };
        } else if (c.kind === 'RESCOPE') {
          rescopes.push({ at: e.effectiveAt, reason: e.reason, eventId: e.id });
          terms = {
            ...terms,
            statement: c.statement ?? terms.statement,
            intendedOutcome: c.intendedOutcome ?? terms.intendedOutcome,
            evidence: c.evidence ?? terms.evidence,
            measures: c.measures ?? terms.measures,
          };
        } else {
          reassignments.push({ from: terms.owner, to: c.owner, at: e.effectiveAt, reason: e.reason, eventId: e.id });
          terms = { ...terms, owner: c.owner };
          // Ownership is not assignment: the new owner has to accept.
          acceptance = null;
          declined = null;
          if (phase !== 'CLOSED') phase = 'PROPOSED';
        }
        break;
      }
      case 'DEPENDENCY_DECLARED':
        dependencies.set(e.payload.dependency.key, { dependency: e.payload.dependency, declaredAt: e.effectiveAt, settled: null });
        break;
      case 'DEPENDENCY_SETTLED': {
        const dep = dependencies.get(e.payload.key);
        if (dep && dep.settled === null) {
          dependencies.set(dep.dependency.key, { ...dep, settled: { at: e.effectiveAt, eventId: e.id, observationId: e.payload.observationId } });
        }
        break;
      }
      case 'EXECUTION_LINKED':
        links.set(e.payload.link.id, { link: e.payload.link, linkedAt: e.effectiveAt, activity: null });
        break;
      case 'ACTIVITY_OBSERVED': {
        const link = links.get(e.payload.linkId);
        if (link && (link.activity === null || link.activity.observedAt <= e.effectiveAt)) {
          links.set(link.link.id, {
            ...link,
            activity: { done: e.payload.done, total: e.payload.total, unit: e.payload.unit, observedAt: e.effectiveAt, eventId: e.id },
          });
        }
        break;
      }
      case 'EVIDENCE_RECORDED':
        evidence.set(e.payload.evidence.id, {
          item: e.payload.evidence,
          eventId: e.id,
          recordedAt: e.recordedAt,
          actor: e.actor,
          disputed: null,
          supersededBy: null,
        });
        break;
      case 'EVIDENCE_DISPUTED': {
        const entry = evidence.get(e.payload.evidenceId);
        if (entry && entry.disputed === null) {
          evidence.set(entry.item.id, { ...entry, disputed: { eventId: e.id, at: e.effectiveAt, actor: e.actor, reason: e.reason } });
        }
        break;
      }
      case 'OUTCOME_OBSERVED':
        outcome = { outcome: e.payload.outcome, at: e.effectiveAt, actor: e.actor, eventId: e.id };
        break;
      case 'CONTEXT_CHANGED':
        contextChanges.set(e.id, {
          eventId: e.id,
          at: e.effectiveAt,
          source: e.payload.source,
          statement: e.payload.statement,
          material: e.payload.material,
          reaffirmed: null,
        });
        break;
      case 'CONTEXT_REAFFIRMED': {
        const cc = contextChanges.get(e.payload.contextEventId);
        if (cc) contextChanges.set(cc.eventId, { ...cc, reaffirmed: { at: e.effectiveAt, by: e.actor, reason: e.reason } });
        break;
      }
      case 'CLOSED':
        phase = 'CLOSED';
        resolution = {
          resolution: e.payload.resolution,
          at: e.effectiveAt,
          actor: e.actor,
          reason: e.reason,
          supersededBy: e.payload.supersededBy,
          confirmedWithoutEvidence: e.payload.confirmedWithoutEvidence,
          eventId: e.id,
        };
        break;
      case 'REOPENED':
        phase = acceptance === null ? 'PROPOSED' : 'ACTIVE';
        resolution = null;
        break;
      case 'LEARNING_RECORDED':
        learnings.push({ learning: e.payload.learning, at: e.effectiveAt, actor: e.actor, eventId: e.id });
        break;
      case 'OUTCOME_PUBLISHED':
        publications.push({ publication: e.payload.publication, at: e.effectiveAt, actor: e.actor, eventId: e.id });
        break;
    }
    history.push({
      eventId: e.id,
      type: e.type,
      at: e.effectiveAt,
      recordedAt: e.recordedAt,
      actor: e.actor,
      reason: e.reason,
      authority: e.authority,
      summary: describeEvent(e),
    });
  }

  const evidenceEntries = supersede([...evidence.values()]);

  return {
    record,
    lens,
    phase,
    terms,
    capture,
    originalDueBy: record.terms.dueBy,
    redates,
    rescopes,
    reassignments,
    acceptance,
    declined,
    changeRequests: [...requests.values()],
    dependencies: [...dependencies.values()],
    links: [...links.values()],
    evidence: evidenceEntries,
    requirements: terms.evidence.map((r) => requirementState(r, evidenceEntries)),
    outcome,
    contextChanges: [...contextChanges.values()],
    resolution,
    learnings,
    publications,
    history,
    events,
  };
}

/**
 * A system that records the same object twice has changed its mind, not
 * contradicted itself: only its latest observation of that object counts.
 */
function supersede(entries: EvidenceEntry[]): EvidenceEntry[] {
  const latest = new Map<string, EvidenceEntry>();
  const keyOf = (e: EvidenceEntry): string | null =>
    (e.item.channel === 'SYSTEM_EVENT' || e.item.channel === 'API') && e.item.source.ref !== null
      ? `${e.item.requirementKey ?? ''}|${e.item.source.system}|${e.item.source.ref}`
      : null;
  for (const e of entries) {
    const k = keyOf(e);
    if (k === null) continue;
    const cur = latest.get(k);
    if (!cur || cur.item.observedAt < e.item.observedAt || (cur.item.observedAt === e.item.observedAt && cur.recordedAt <= e.recordedAt)) {
      latest.set(k, e);
    }
  }
  return entries.map((e) => {
    const k = keyOf(e);
    const winner = k === null ? null : latest.get(k);
    return winner && winner.item.id !== e.item.id ? { ...e, supersededBy: winner.item.id } : e;
  });
}

export const isLive = (e: EvidenceEntry): boolean => e.disputed === null && e.supersededBy === null;

function requirementState(requirement: EvidenceRequirement, entries: readonly EvidenceEntry[]): RequirementState {
  const live = entries.filter((e) => e.item.requirementKey === requirement.key && isLive(e));
  const facts = live.filter((e) => e.item.epistemic === 'FACT');
  const supporting = facts.filter((e) => e.item.stance === 'SUPPORTS');
  const contradicting = facts.filter((e) => e.item.stance === 'CONTRADICTS');
  const inferred = live.filter((e) => e.item.epistemic !== 'FACT' && e.item.stance === 'SUPPORTS');
  let status: RequirementStatus = 'OPEN';
  if (supporting.length > 0 && contradicting.length > 0) status = 'CONFLICTED';
  else if (contradicting.length > 0) status = 'CONTRADICTED';
  else if (supporting.length > 0) status = 'EVIDENCED';
  else if (inferred.length > 0) status = 'INFERRED';
  const bySystem = supporting.some((e) => e.item.channel === 'SYSTEM_EVENT' || e.item.channel === 'API');
  return {
    requirement,
    status,
    basis: status === 'EVIDENCED' ? (bySystem ? 'SYSTEM' : 'PERSON') : null,
    supporting: supporting.map((e) => e.item.id),
    contradicting: contradicting.map((e) => e.item.id),
    inferred: inferred.map((e) => e.item.id),
    watched: isWatchable(requirement.matcher),
  };
}

/**
 * A matcher Forge may act on without a person: it names the object it is about,
 * or at least filters on the payload. "Any stock transfer anywhere" is not
 * evidence of this one.
 */
export const isWatchable = (m: EvidenceMatcher | null): boolean =>
  m !== null && (m.objectRef !== null || Object.keys(m.where).length > 0);

/** One plain sentence per event, for histories and exported episodes. */
export function describeEvent(e: CommitmentEvent): string {
  switch (e.type) {
    case 'ACCEPTED':
      return `Accepted by ${e.payload.party.label}${e.payload.confirmed.length > 0 ? `, confirming ${e.payload.confirmed.join(', ')}` : ''}`;
    case 'DECLINED':
      return `Declined by ${e.payload.party.label}`;
    case 'CHANGE_REQUESTED':
      return `${describeChange(e.payload.change)} requested of ${e.payload.approver.label}`;
    case 'CHANGE_DECIDED':
      return `Change ${e.payload.decision === 'APPROVED' ? 'approved' : 'rejected'}`;
    case 'TERMS_CHANGED':
      return describeChange(e.payload.change);
    case 'DEPENDENCY_DECLARED':
      return `Depends on: ${e.payload.dependency.description}`;
    case 'DEPENDENCY_SETTLED':
      return `Dependency settled: ${e.payload.key}`;
    case 'EXECUTION_LINKED':
      return `Executed through ${e.payload.link.system} ${e.payload.link.kind.toLowerCase()} ${e.payload.link.ref}`;
    case 'ACTIVITY_OBSERVED':
      return `Activity: ${e.payload.done} of ${e.payload.total} ${e.payload.unit} done`;
    case 'EVIDENCE_RECORDED':
      return `Evidence (${e.payload.evidence.epistemic.toLowerCase()}, ${e.payload.evidence.stance.toLowerCase()}): ${e.payload.evidence.statement}`;
    case 'EVIDENCE_DISPUTED':
      return 'Evidence disputed';
    case 'OUTCOME_OBSERVED':
      return `Outcome: ${e.payload.outcome.statement}`;
    case 'CONTEXT_CHANGED':
      return `Context changed${e.payload.material ? ' materially' : ''}: ${e.payload.statement}`;
    case 'CONTEXT_REAFFIRMED':
      return 'Commitment reaffirmed after the context changed';
    case 'CLOSED':
      return `Closed ${e.payload.resolution.toLowerCase().replace(/_/g, ' ')}${e.payload.confirmedWithoutEvidence ? ' on a person’s confirmation, without system evidence' : ''}`;
    case 'REOPENED':
      return 'Reopened';
    case 'LEARNING_RECORDED':
      return `${e.payload.learning.kind === 'LESSON' ? 'Lesson' : 'Explanation'}: ${e.payload.learning.statement}`;
    case 'OUTCOME_PUBLISHED':
      return `Verified outcome published for Helm (${e.payload.publication.fingerprint})`;
  }
}

export function describeChange(c: Change): string {
  switch (c.kind) {
    case 'REDATE':
      return `Due date moved to ${humanDate(c.dueBy)}`;
    case 'RESCOPE':
      return 'Scope changed';
    case 'REASSIGN':
      return `Ownership moved to ${c.owner.label}`;
    case 'CLOSE':
      return `Close as ${c.resolution.toLowerCase().replace(/_/g, ' ')}`;
  }
}

/** Is `party` the owner or the principal of this commitment? */
export const isOwner = (v: CommitmentView, p: Party): boolean => sameParty(v.terms.owner, p);
export const isPrincipal = (v: CommitmentView, p: Party): boolean => sameParty(v.terms.principal, p);
