/**
 * The Forge vocabulary.
 *
 * One central object — the COMMITMENT: an accountable promise, made by an owner
 * to a principal, to produce an outcome, by a date, proven by evidence. Tasks are
 * not modelled here: work happens wherever the enterprise already does it, and
 * reaches Forge as execution links, activity and evidence.
 *
 * Everything that happens to a commitment is an append-only EVENT carrying who
 * acted, when, under what authority and why. A commitment's state — its phase,
 * its current terms, whether its evidence holds, what needs a person — is
 * DERIVED from the record and its events at a lens (derive.ts) and never stored.
 */

import type { Actor, Party } from './primitives.ts';
import type { Protection } from './sensitivity.ts';
import type { Epistemic } from './epistemic.ts';
import type { OutcomePublication } from './publication.ts';

// --------------------------------------------------------------- references

/** Where something came from, in the source system's own terms. */
export type SourceRef = {
  /** 'helm' · 'memoire' · 'erp' · 'scm' · 'wms' · 'finance' · 'hris' · 'jira' · 'forge' · 'manual' … */
  readonly system: string;
  /** The object in that system: 'TR-0412', 'memoire:opportunity:rohto-q4-tender'. */
  readonly ref: string | null;
  readonly url: string | null;
};

// ------------------------------------------------------------------- origin

export const originKinds = ['DECISION', 'OBJECTIVE', 'OBLIGATION', 'RISK', 'OPPORTUNITY', 'COMMITMENT', 'COMMUNICATION', 'DIRECT'] as const;
export type OriginKind = (typeof originKinds)[number];

/**
 * Why a commitment exists. A commitment always answers to something: a decision
 * management committed in Helm, an objective, an obligation (a customer promise
 * in Memoire that became an enterprise obligation), a risk, an opportunity, a
 * parent commitment it decomposes, a communication where it was made (a
 * meeting, a message) — or, when nothing upstream is modelled yet, a direct
 * promise.
 *
 * Reference + immutable snapshot, never a copy: `ref` keeps Forge current with
 * the origin system; `snapshot` keeps Forge honest about what was known when
 * the commitment was made (the rule Helm keeps for Memoire).
 */
export type Origin = {
  readonly kind: OriginKind;
  readonly system: string;
  /** Canonical reference, e.g. 'helm:decision-commitment:dcm_…'. Null only for DIRECT. */
  readonly ref: string | null;
  readonly label: string;
  /** The origin's own content fingerprint where it has one (a Helm commitment's `dfp_…`). */
  readonly fingerprint: string | null;
  readonly snapshot: Readonly<Record<string, unknown>> | null;
};

// -------------------------------------------------------------------- terms

/** How a piece of information reached Forge — §9's priority order, best first. */
export const captureModes = ['INHERITED', 'SYSTEM_EVENT', 'EXTRACTED', 'INFERRED', 'CONFIRMED', 'MANUAL'] as const;
export type CaptureMode = (typeof captureModes)[number];

export const termFields = [
  'statement',
  'intendedOutcome',
  'why',
  'owner',
  'principal',
  'dueBy',
  'evidence',
  'measures',
  'value',
] as const;
export type TermField = (typeof termFields)[number];

/**
 * What proves the commitment real. OUTPUT: something was produced. OUTCOME:
 * something in the world changed. Activity is never evidence (§7) — it arrives
 * separately, on execution links.
 */
export type EvidenceRequirement = {
  readonly key: string;
  readonly level: 'OUTPUT' | 'OUTCOME';
  readonly description: string;
  readonly required: boolean;
  /** How an observation satisfies it without anyone reporting it. Null when only a person can confirm. */
  readonly matcher: EvidenceMatcher | null;
};

/**
 * Matches observations from an execution surface. An observation of the right
 * system, event type and object that FAILS `where` is recorded as
 * contradicting evidence — the source said something, and it was not this.
 */
export type EvidenceMatcher = {
  readonly system: string;
  readonly eventType: string;
  readonly objectRef: string | null;
  readonly where: Readonly<Record<string, string | number | boolean>>;
};

/** A quantified (or explicitly qualitative) intended outcome. */
export type OutcomeMeasure = {
  readonly key: string;
  readonly label: string;
  readonly comparator: 'AT_LEAST' | 'AT_MOST' | 'EQUALS' | 'QUALITATIVE';
  /** Exact decimal as text; null for a qualitative measure. */
  readonly expected: string | null;
  readonly unit: string | null;
  readonly statement: string | null;
  /** Where the expectation came from — a Helm value node and period read from the committed future state, or a person. */
  readonly source: SourceRef;
  /** The origin system's own metric key ('GrossMarginPct'), when the expectation is about one. */
  readonly metricKey?: string | null;
  /** The classes an actual for this measure carries — the source's own (Helm's value class), never Forge's guess (ADR-0017). */
  readonly protection?: Protection;
};

export const valueDimensions = [
  'REVENUE',
  'MARGIN',
  'CASH',
  'CUSTOMER',
  'RISK',
  'CAPACITY',
  'STRATEGIC_POSITION',
  'RESILIENCE',
  'CAPABILITY',
] as const;
export type ValueDimension = (typeof valueDimensions)[number];

/**
 * Why the outcome matters to the enterprise. Precision is explicit so Forge
 * never manufactures a number (§17): UNQUANTIFIED is a first-class answer.
 */
export type ValueClaim = {
  readonly dimension: ValueDimension;
  readonly intent: 'CREATE' | 'PROTECT';
  readonly statement: string;
  readonly precision: 'UNQUANTIFIED' | 'RANGE' | 'POINT';
  readonly low: string | null;
  readonly high: string | null;
  readonly unit: string | null;
  readonly source: SourceRef;
};

export type Terms = {
  /** The promise, in one sentence. */
  readonly statement: string;
  /** What changes in the world when it is kept — not the work that gets it there. */
  readonly intendedOutcome: string;
  /** Why it matters, in the words of whoever decided it. */
  readonly why: string;
  /** Who promises. Accountable once they accept. */
  readonly owner: Party;
  /** To whom the promise is made — the decision owner, the parent commitment's owner. */
  readonly principal: Party;
  /** ISO date. */
  readonly dueBy: string;
  readonly evidence: readonly EvidenceRequirement[];
  readonly measures: readonly OutcomeMeasure[];
  readonly value: readonly ValueClaim[];
};

/**
 * A piece of inherited context: a fact the enterprise already knew, carried
 * with its source so nobody types it again (§9, §11).
 */
export type ContextField = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly capture: CaptureMode;
  readonly epistemic: Epistemic;
  readonly source: SourceRef;
  /** The shared enterprise entity it is about, when there is one: 'memoire:account:rohto-vn'. */
  readonly entityRef: string | null;
};

// --------------------------------------------------------------- commitment

/**
 * The identity record, written once when a commitment is proposed and never
 * changed. Everything after that is an event.
 */
export type CommitmentRecord = {
  readonly id: string;
  readonly orgId: string;
  readonly parentId: string | null;
  readonly origin: Origin;
  /** The terms as proposed. Current terms are derived from these and the events. */
  readonly terms: Terms;
  /** How each term was captured — the friction Forge put on people, measured. */
  readonly capture: Readonly<Record<TermField, CaptureMode>>;
  readonly context: readonly ContextField[];
  readonly proposedBy: Actor;
  readonly proposedAt: string;
  /** Stamped by the store (by the database in Postgres), never by the caller. */
  readonly recordedAt: string;
  readonly fingerprint: string;
};

export type NewCommitmentRecord = Omit<CommitmentRecord, 'recordedAt'>;

// --------------------------------------------------------------- dependency

export type DependencyTarget =
  | { readonly kind: 'COMMITMENT'; readonly commitmentId: string }
  | { readonly kind: 'EXTERNAL'; readonly source: SourceRef; readonly label: string }
  | { readonly kind: 'PARTY'; readonly party: Party };

export type Dependency = {
  readonly key: string;
  readonly description: string;
  readonly on: DependencyTarget;
  readonly neededBy: string | null;
  /** For an external dependency: the observation that settles it. */
  readonly matcher: EvidenceMatcher | null;
  /** The Helm review trigger this dependency stands for, when the origin decision named one. */
  readonly helmTriggerKey: string | null;
};

// ---------------------------------------------------------------- execution

/** A first-class link to work done elsewhere — a Jira epic, a SAP purchase order, a Memoire opportunity. */
export type ExecutionLink = {
  readonly id: string;
  readonly system: string;
  readonly kind: string;
  readonly ref: string;
  readonly label: string;
  readonly url: string | null;
};

// ----------------------------------------------------------------- evidence

export const evidenceChannels = [
  'SYSTEM_EVENT',
  'API',
  'DOCUMENT',
  'COMMUNICATION',
  'HUMAN_CONFIRMATION',
  'INFERENCE',
] as const;
export type EvidenceChannel = (typeof evidenceChannels)[number];

export type EvidenceItem = {
  readonly id: string;
  /** The requirement it bears on; null for evidence that only gives context. */
  readonly requirementKey: string | null;
  readonly stance: 'SUPPORTS' | 'CONTRADICTS' | 'CONTEXT';
  /** FACT for what a system recorded or a person confirmed; INFERENCE for what Forge or an AI concluded. */
  readonly epistemic: Extract<Epistemic, 'FACT' | 'INFERENCE' | 'ASSUMPTION'>;
  readonly channel: EvidenceChannel;
  readonly source: SourceRef;
  readonly statement: string;
  /** When it was true in the world. */
  readonly observedAt: string;
  /** Required for an INFERENCE, refused for a FACT. */
  readonly confidence: number | null;
  readonly observationId: string | null;
  /** The classes of the fact it rests on, carried from the source (ADR-0017). Absent or empty: general management. */
  readonly protection?: Protection;
  /** Set only on what a reader without clearance receives: the statement was withheld from them. */
  readonly withheld?: Protection;
};

// ------------------------------------------------------------------ outcome

/** What actually happened to the enterprise's value, never inferred: someone states it. */
export type RealizedValue = {
  readonly dimension: ValueDimension;
  readonly effect: 'CREATED' | 'PROTECTED' | 'DELAYED' | 'DESTROYED' | 'NONE' | 'UNKNOWN';
  readonly statement: string;
  readonly amount: string | null;
  readonly unit: string | null;
};

export type ObservedOutcome = {
  /** What actually happened, in a sentence. */
  readonly statement: string;
  readonly achievedOn: string | null;
  readonly measures: readonly {
    readonly key: string;
    readonly actual: string | null;
    readonly note: string | null;
    /** Stamped from the measure's terms when the outcome is recorded (ADR-0017). */
    readonly protection?: Protection;
    /** True only on what a reader without clearance receives. */
    readonly withheld?: boolean;
  }[];
  readonly realizedValue: readonly RealizedValue[];
  /** Evidence ids the statement rests on. */
  readonly basis: readonly string[];
  /** The classes of the evidence the statement rests on, stamped when it is recorded (ADR-0017). */
  readonly protection?: Protection;
  /** Set only on what a reader without clearance receives: the narrative and the protected actuals were withheld. */
  readonly withheld?: Protection;
};

// -------------------------------------------------------------- resolution

/**
 * How a commitment ended (§13). Delay and re-scoping are not endings — they are
 * facts about the path, kept as events and read back as variance.
 */
export const resolutions = [
  'FULFILLED',
  'PARTIALLY_FULFILLED',
  'MISSED',
  'SUPERSEDED',
  'CANCELLED',
  'INVALIDATED',
  'ABANDONED',
] as const;
export type Resolution = (typeof resolutions)[number];

/** Endings that speak to delivery, which the owner may record; the rest change the promise itself. */
export const deliveryResolutions: readonly Resolution[] = ['FULFILLED', 'PARTIALLY_FULFILLED', 'MISSED'];

export type Change =
  | { readonly kind: 'REDATE'; readonly dueBy: string }
  | {
      readonly kind: 'RESCOPE';
      readonly statement: string | null;
      readonly intendedOutcome: string | null;
      readonly evidence: readonly EvidenceRequirement[] | null;
      readonly measures: readonly OutcomeMeasure[] | null;
    }
  | { readonly kind: 'REASSIGN'; readonly owner: Party }
  | {
      readonly kind: 'CLOSE';
      readonly resolution: Resolution;
      readonly supersededBy: string | null;
      readonly confirmedWithoutEvidence: boolean;
    };

export type ChangeKind = Change['kind'];

// ------------------------------------------------------------------ learning

export type Learning = {
  readonly id: string;
  /** EXPLANATION: why the outcome differed. LESSON: what the enterprise should do differently. */
  readonly kind: 'EXPLANATION' | 'LESSON';
  readonly statement: string;
  /** Where it should apply next time, in words: 'transfers of consignment stock'. */
  readonly appliesTo: string | null;
};

// ---------------------------------------------------------------- authority

export type AuthorityBasis = {
  readonly policy: string;
  readonly rule: string;
  readonly statement: string;
  /** The approval this act rests on, when it needed one. */
  readonly approvalRequestId: string | null;
  /** Whether the verdict came from a trusted authority service (Helm's), not Forge's interim policy. */
  readonly trusted?: boolean;
};

// -------------------------------------------------------------------- events

export type EventPayloads = {
  ACCEPTED: { readonly party: Party; readonly confirmed: readonly TermField[]; readonly evidence: readonly EvidenceRequirement[] | null };
  DECLINED: { readonly party: Party };
  CHANGE_REQUESTED: { readonly requestId: string; readonly change: Change; readonly approver: Party };
  CHANGE_DECIDED: { readonly requestId: string; readonly decision: 'APPROVED' | 'REJECTED' };
  TERMS_CHANGED: { readonly change: Exclude<Change, { kind: 'CLOSE' }>; readonly requestId: string | null };
  DEPENDENCY_DECLARED: { readonly dependency: Dependency };
  DEPENDENCY_SETTLED: { readonly key: string; readonly observationId: string | null };
  EXECUTION_LINKED: { readonly link: ExecutionLink };
  ACTIVITY_OBSERVED: {
    readonly linkId: string;
    readonly done: number;
    readonly total: number;
    readonly unit: string;
    readonly observationId: string | null;
  };
  EVIDENCE_RECORDED: { readonly evidence: EvidenceItem };
  EVIDENCE_DISPUTED: { readonly evidenceId: string };
  OUTCOME_OBSERVED: { readonly outcome: ObservedOutcome };
  CONTEXT_CHANGED: { readonly source: SourceRef; readonly statement: string; readonly material: boolean };
  CONTEXT_REAFFIRMED: { readonly contextEventId: string };
  CLOSED: { readonly resolution: Resolution; readonly supersededBy: string | null; readonly confirmedWithoutEvidence: boolean; readonly requestId: string | null };
  REOPENED: Record<string, never>;
  LEARNING_RECORDED: { readonly learning: Learning };
  OUTCOME_PUBLISHED: { readonly publication: OutcomePublication };
};

export type EventType = keyof EventPayloads;
export const eventTypes = [
  'ACCEPTED',
  'DECLINED',
  'CHANGE_REQUESTED',
  'CHANGE_DECIDED',
  'TERMS_CHANGED',
  'DEPENDENCY_DECLARED',
  'DEPENDENCY_SETTLED',
  'EXECUTION_LINKED',
  'ACTIVITY_OBSERVED',
  'EVIDENCE_RECORDED',
  'EVIDENCE_DISPUTED',
  'OUTCOME_OBSERVED',
  'CONTEXT_CHANGED',
  'CONTEXT_REAFFIRMED',
  'CLOSED',
  'REOPENED',
  'LEARNING_RECORDED',
  'OUTCOME_PUBLISHED',
] as const satisfies readonly EventType[];

type EventOf<T extends EventType> = {
  readonly id: string;
  readonly orgId: string;
  readonly commitmentId: string;
  /** Per-commitment order, assigned by the store. */
  readonly seq: number;
  readonly type: T;
  /** When it happened in the world. */
  readonly effectiveAt: string;
  /** When Forge learned it — stamped by the store, never by the caller. */
  readonly recordedAt: string;
  readonly actor: Actor;
  /** Why. Required wherever the act changes the promise. */
  readonly reason: string | null;
  /**
   * The class of the words written with this event — its reason, and a learning's statement: the commitment's
   * ceiling when they were written, or higher if the writer raised it (ADR-0017). Absent: general management.
   */
  readonly textProtection?: Protection;
  /** Set only on what a reader without clearance receives: the words were withheld from them. */
  readonly textWithheld?: Protection;
  readonly authority: AuthorityBasis | null;
  /** Makes re-delivery of the same observation a no-op. */
  readonly idempotencyKey: string | null;
  readonly payload: EventPayloads[T];
};

export type CommitmentEvent = { [T in EventType]: EventOf<T> }[EventType];

export type NewEvent = { [T in EventType]: Omit<EventOf<T>, 'seq' | 'recordedAt'> }[EventType];

export type EventOfType<T extends EventType> = EventOf<T>;

// ---------------------------------------------------------------------- lens

/**
 * A reading position. `recordedThrough` hides what Forge had not yet learned;
 * `asOf` is the moment conditions are judged at (is it past due *then*?).
 * Reading at an earlier lens reproduces what was known — a later fact never
 * changes an earlier reading.
 */
export type Lens = { readonly asOf: string; readonly recordedThrough: string };

/** Read as Forge knew things at `iso` — the time machine. */
export const lensAt = (iso: string): Lens => ({ asOf: iso, recordedThrough: iso });

export const END_OF_RECORD = '9999-12-31T23:59:59.999Z';

/**
 * Everything Forge has recorded, judged as of `asOf` — the default reading.
 * Record time is stamped by the store (by the database in Postgres), so a reader
 * whose clock runs behind the database's must still see what it just wrote.
 */
export const latestAt = (asOf: string): Lens => ({ asOf, recordedThrough: END_OF_RECORD });
