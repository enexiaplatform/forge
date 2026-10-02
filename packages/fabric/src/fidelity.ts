/**
 * Decision fidelity — where execution departed from what management decided (§13, §14, §15: "Where do decisions
 * lose fidelity during execution?").
 *
 * Helm's committed decision is the reference: its action intents, its expected outcomes, its fingerprint. Forge's
 * commitments that answer to it are the execution. Every place they part is a departure, stated as what the record
 * holds — when, by whom, the reason given, and the authority the act rested on. Nothing is stored: departures are
 * derived from the same events as everything else, at the same lens.
 *
 * A departure is not a fault. Redating with an approval, adding a commitment the decision did not name, ending
 * short — management may well have been right each time. Fidelity is a record to learn from, never a score: no
 * percentage, no rating, no ranking (ADR-0014).
 */

import { type CommitmentView, daysBetween, decimalCompare, isDecimal, type Party, type Protection, textCeiling } from '@forge/kernel';
import { helmCommitmentRef, type HelmActionIntent, type HelmCommittedDecision, type HelmExpectedOutcome } from './helm.ts';

/** The context field intake writes on a commitment drafted from a Helm action intent: the intent, by reference. */
export const HELM_ACTION_INTENT_CONTEXT = 'decision.action_intent';
export const helmActionIntentRef = (intentId: string): string => `helm:action-intent:${intentId}`;

export const departureKinds = [
  'RECOMMITTED',
  'INTENT_NOT_TAKEN_UP',
  'OUTCOME_NOT_COMPARABLE',
  'OUTCOME_NOT_PROVABLE',
  'NOT_OWNED',
  'DECLINED',
  'REDATED',
  'RESCOPED',
  'TARGET_MOVED',
  'REASSIGNED',
  'ADDED',
  'CONTEXT_CHANGED',
  'ENDED_SHORT',
] as const;
export type DepartureKind = (typeof departureKinds)[number];

export type Departure = {
  readonly kind: DepartureKind;
  /** What departed, in a manager's words. */
  readonly statement: string;
  readonly commitmentId: string | null;
  /** When it happened; null for what the decision and the execution differ in from the start. */
  readonly at: string | null;
  readonly by: string | null;
  readonly reason: string | null;
  /** The authority the act rested on, as recorded: whose policy, whether it was Helm's, and who approved it. */
  readonly authority: { readonly statement: string; readonly trusted: boolean; readonly approvedBy: string | null; readonly approvalReason: string | null } | null;
  /**
   * The classes the departure carries wherever it goes (ADR-0017, ADR-0020): its commitment's ceiling — a reason, an
   * approval's reason or a moved target can state a protected value. Empty for what holds from the start.
   */
  readonly protection: Protection;
};

export type DecisionFidelity = {
  readonly decisionRef: string;
  /** What the decision named, and how much of it execution still holds as decided. */
  readonly decided: { readonly intents: number; readonly outcomes: number };
  readonly heldAsDecided: readonly { readonly statement: string; readonly commitmentId: string | null }[];
  /** Structural departures first (they hold from the start), then the rest in the order they happened. */
  readonly departures: readonly Departure[];
  /** A computed sentence: the answer, not a label. */
  readonly headline: string;
};

const ENDING: Record<string, string> = {
  PARTIALLY_FULFILLED: 'partly fulfilled',
  MISSED: 'missed',
  SUPERSEDED: 'superseded',
  CANCELLED: 'cancelled',
  INVALIDATED: 'invalidated by changed context',
  ABANDONED: 'abandoned',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The Helm intent a commitment was drafted from: by the reference intake records, else by the title it copied. */
export function intentOf(v: CommitmentView, intents: readonly HelmActionIntent[]): HelmActionIntent | null {
  const field = v.record.context.find((c) => c.key === HELM_ACTION_INTENT_CONTEXT);
  if (field) return intents.find((i) => helmActionIntentRef(i.id) === field.source.ref) ?? null;
  return intents.find((i) => i.title === v.record.terms.statement && i.ownerLabel === v.record.terms.owner.label) ?? null;
}

/**
 * Who acted and on what authority. A change that needed an approval is applied when it is approved; the person who
 * asked for it is the one who departed, and the approver is the authority it rested on.
 */
function actOf(v: CommitmentView, eventId: string): Pick<Departure, 'by' | 'authority'> {
  const h = v.history.find((x) => x.eventId === eventId);
  const request = h?.authority?.approvalRequestId ? v.changeRequests.find((r) => r.requestId === h.authority?.approvalRequestId) : undefined;
  const approved = request?.decided?.decision === 'APPROVED' ? request.decided : null;
  return {
    by: request ? request.requestedBy.label : (h?.actor.label ?? null),
    authority: h?.authority
      ? { statement: h.authority.statement, trusted: h.authority.trusted === true, approvedBy: approved?.by.label ?? null, approvalReason: approved?.reason ?? null }
      : null,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2 Oct 2026". */
const day = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

const partyLabel = (p: Party) => p.label;

/**
 * Compare a Helm committed decision with the Forge commitments that answer to it. `views` may hold any commitments;
 * only those whose origin is this Helm commitment count. `later` are other Helm commitments the reader can see — a
 * later one for the same decision means Helm has recommitted it.
 */
export function decisionFidelity(hc: HelmCommittedDecision, views: readonly CommitmentView[], later: readonly HelmCommittedDecision[] = []): DecisionFidelity {
  const ref = helmCommitmentRef(hc.commitment.id);
  const tree = views.filter((v) => v.record.origin.ref === ref);
  // Found first, then given the classes they carry.
  const structural: Omit<Departure, 'protection'>[] = [];
  const dated: Omit<Departure, 'protection'>[] = [];

  // ----------------------------------------------------------- Helm moved on
  const recommitted = later
    .filter((x) => x.decision.id === hc.decision.id && x.commitment.id !== hc.commitment.id && x.commitment.committedAt > hc.commitment.committedAt)
    .sort((a, b) => a.commitment.committedAt.localeCompare(b.commitment.committedAt))
    .at(-1);
  if (recommitted && tree.length > 0) {
    dated.push({
      kind: 'RECOMMITTED',
      statement: `Helm recommitted this decision (${recommitted.commitment.fingerprint}); these commitments still execute the version committed ${day(hc.commitment.committedAt)} (${hc.commitment.fingerprint}).`,
      commitmentId: null,
      at: recommitted.commitment.committedAt,
      by: recommitted.commitment.committedBy.label,
      reason: recommitted.commitment.summary,
      authority: null,
    });
  }

  // ----------------------------------------------------------- the outcome
  const outcome = tree.find((v) => v.record.parentId === null) ?? null;
  for (const o of hc.commitment.expectedOutcomes) {
    const measure = outcome?.record.terms.measures.find((m) => (o.metricKey ? m.metricKey === o.metricKey : m.label === o.label)) ?? null;
    if (!outcome) continue;
    if (!measure) {
      structural.push({
        kind: 'OUTCOME_NOT_COMPARABLE',
        statement: `Helm expected ${describeExpected(o)}; Forge holds no measure for it — the metric is not one-sided, so a person will have to judge what happened.`,
        commitmentId: outcome.record.id,
        at: null, by: null, reason: null, authority: null,
      });
      continue;
    }
    if (o.kind === 'MODELLED' && !o.nodeId) {
      structural.push({
        kind: 'OUTCOME_NOT_PROVABLE',
        statement: `Helm expected ${describeExpected(o)} without naming a value node, so no actual Helm records can prove it; a person must confirm it.`,
        commitmentId: outcome.record.id,
        at: null, by: null, reason: null, authority: null,
      });
    }
    const now = outcome.terms.measures.find((m) => m.key === measure.key);
    if (o.expectedValue && isDecimal(o.expectedValue) && now?.expected && isDecimal(now.expected) && decimalCompare(now.expected, o.expectedValue) !== 0) {
      const rescope = [...outcome.events]
        .filter((e) => e.type === 'TERMS_CHANGED' && e.payload.change.kind === 'RESCOPE' && e.payload.change.measures?.some((m) => m.key === measure.key))
        .at(-1);
      dated.push({
        kind: 'TARGET_MOVED',
        statement: `${o.label}: execution now aims at ${now.expected}${now.unit ? ` ${now.unit}` : ''}, where Helm committed to ${o.expectedValue}${measure.unit ? ` ${measure.unit}` : ''}.`,
        commitmentId: outcome.record.id,
        at: rescope?.effectiveAt ?? null,
        ...(rescope ? actOf(outcome, rescope.id) : { by: null, authority: null }),
        reason: rescope?.reason ?? null,
      });
    }
  }

  // ----------------------------------------------------------- the intents
  const answered = new Map<string, CommitmentView>();
  for (const v of tree) {
    if (v === outcome) continue;
    const intent = intentOf(v, hc.actionIntents);
    if (intent && !answered.has(intent.id)) answered.set(intent.id, v);
    else
      dated.push({
        kind: 'ADDED',
        statement: `Execution added “${v.record.terms.statement}” (${partyLabel(v.record.terms.owner)}), which the decision did not name.`,
        commitmentId: v.record.id,
        at: v.record.proposedAt,
        by: v.record.proposedBy.label,
        reason: null,
        authority: null,
      });
  }
  for (const intent of hc.actionIntents) {
    if (outcome && !answered.has(intent.id)) {
      structural.push({
        kind: 'INTENT_NOT_TAKEN_UP',
        statement: `Helm’s intent “${intent.title}” (${intent.ownerLabel}) has no commitment in Forge.`,
        commitmentId: null,
        at: null, by: null, reason: null, authority: null,
      });
    }
  }

  // ----------------------------------------------------------- each commitment's own record
  for (const v of tree) {
    const intent = v === outcome ? null : intentOf(v, hc.actionIntents);
    const name = `“${v.record.terms.statement}”`;

    if (v.declined) {
      dated.push({ kind: 'DECLINED', statement: `${v.declined.party.label} declined ${name}.`, commitmentId: v.record.id, at: v.declined.at, ...actOf(v, v.declined.eventId), reason: v.declined.reason });
    } else if (v.phase === 'PROPOSED' && !v.resolution) {
      dated.push({ kind: 'NOT_OWNED', statement: `Nobody has accepted ${name}; it waits on ${v.terms.owner.label}.`, commitmentId: v.record.id, at: v.reassignments.at(-1)?.at ?? v.record.proposedAt, by: null, reason: null, authority: null });
    }
    for (const r of v.redates) {
      const decided = intent?.dueDate && r.from === intent.dueDate ? ' (the date Helm’s intent carried)' : '';
      const days = daysBetween(r.from, r.to);
      dated.push({
        kind: 'REDATED',
        statement: `${name} moved from ${day(r.from)}${decided} to ${day(r.to)}, ${plural(Math.abs(days), 'day')} ${days > 0 ? 'later' : 'earlier'}.`,
        commitmentId: v.record.id, at: r.at, ...actOf(v, r.eventId), reason: r.reason,
      });
    }
    for (const r of v.rescopes) {
      dated.push({ kind: 'RESCOPED', statement: `What ${name} promises was changed.`, commitmentId: v.record.id, at: r.at, ...actOf(v, r.eventId), reason: r.reason });
    }
    for (const r of v.reassignments) {
      dated.push({ kind: 'REASSIGNED', statement: `${name} passed from ${r.from.label} to ${r.to.label}.`, commitmentId: v.record.id, at: r.at, ...actOf(v, r.eventId), reason: r.reason });
    }
    for (const c of v.contextChanges.filter((x) => x.material)) {
      dated.push({
        kind: 'CONTEXT_CHANGED',
        statement: `The world ${name} rests on changed: ${c.statement}${c.reaffirmed ? ` — reaffirmed by ${c.reaffirmed.by.label}` : ' — not yet reaffirmed'}.`,
        commitmentId: v.record.id, at: c.at, by: c.reaffirmed?.by.label ?? null, reason: c.reaffirmed?.reason ?? null, authority: null,
      });
    }
    if (v.resolution && v.resolution.resolution !== 'FULFILLED') {
      dated.push({
        kind: 'ENDED_SHORT',
        statement: `${name} ended ${ENDING[v.resolution.resolution] ?? v.resolution.resolution.toLowerCase()}.`,
        commitmentId: v.record.id, at: v.resolution.at, ...actOf(v, v.resolution.eventId), reason: v.resolution.reason,
      });
    }
  }

  // Each departure carries its commitment's ceiling: what it quotes travels at least as protected as what it is about.
  const ceilingOf = (id: string | null): Protection => {
    const v = id === null ? undefined : tree.find((x) => x.record.id === id);
    return v ? textCeiling(v.record, v.events) : [];
  };
  const departures = [...structural, ...dated.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))].map((d) => ({ ...d, protection: ceilingOf(d.commitmentId) }));
  // Held as decided: the outcome and every commitment drafted from an intent that no departure names.
  const departed = new Set(departures.map((d) => d.commitmentId));
  const held = tree
    .filter((v) => (v === outcome || intentOf(v, hc.actionIntents) !== null) && !departed.has(v.record.id))
    .map((v) => ({ statement: v.terms.statement, commitmentId: v.record.id }));
  const decided = { intents: hc.actionIntents.length, outcomes: hc.commitment.expectedOutcomes.length };
  const heldIntents = held.filter((h) => h.commitmentId !== outcome?.record.id).length;
  const headline =
    tree.length === 0
      ? 'Nothing executes this decision in Forge yet.'
      : departures.length === 0
        ? `Execution holds the decision as Helm committed it: ${plural(decided.intents, 'intent')} and ${plural(decided.outcomes, 'expected outcome')}, unchanged.`
        : `Execution differs from the decision in ${plural(departures.length, 'place')}; ${heldIntents} of ${plural(decided.intents, 'intent')} still stand${heldIntents === 1 ? 's' : ''} as decided.`;
  return { decisionRef: ref, decided, heldAsDecided: held, departures, headline };
}

function describeExpected(o: HelmExpectedOutcome): string {
  if (o.kind === 'QUALITATIVE' || !o.expectedValue) return `“${o.statement ?? o.label}”`;
  return `${o.label} at ${o.expectedValue}${o.unit === 'percentage' ? ' %' : o.currency ? ` ${o.currency}` : ''}`;
}
