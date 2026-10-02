/**
 * Forge, published — what Helm reads back (§5, §18).
 *
 * Forge never writes into Helm. It publishes execution reality as events in
 * the same envelope Helm's integration fabric already reads from Memoire —
 * `{ eventType, occurredAt, sourceSystem, sourceRef, payload, idempotencyKey }`
 * — so Helm can take Forge on as one more source through its `SourceAdapter`
 * port without learning Forge's vocabulary. The events are derived from the
 * ledger at a lens; re-deriving them yields the same keys.
 *
 * `review_trigger.observed` is how execution reaches management: when a
 * dependency that stands for one of the decision's own review triggers goes
 * late, Helm hears that the condition it asked to be told about has happened.
 */

import { type CommitmentView, dateOf, type Condition, conditionsOf, varianceOf } from '@forge/kernel';

export const outboundEventTypes = [
  'commitment.proposed',
  'commitment.accepted',
  'commitment.declined',
  'commitment.redated',
  'commitment.rescoped',
  'commitment.reassigned',
  'commitment.closed',
  'outcome.observed',
  'learning.recorded',
  'outcome.published',
  'review_trigger.observed',
] as const;
export type OutboundEventType = (typeof outboundEventTypes)[number];

export type ForgeOutboundEvent = {
  readonly eventType: OutboundEventType;
  readonly occurredAt: string;
  readonly sourceSystem: 'forge';
  /** forge:commitment:<id> */
  readonly sourceRef: string;
  /** The origin the commitment answers to — for a Helm decision, Helm's own reference. */
  readonly originRef: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
};

export function outboundEvents(views: readonly CommitmentView[]): ForgeOutboundEvent[] {
  const byId = new Map(views.map((v) => [v.record.id, v]));
  const out: ForgeOutboundEvent[] = [];
  for (const v of views) {
    const sourceRef = `forge:commitment:${v.record.id}`;
    const base = { sourceSystem: 'forge' as const, sourceRef, originRef: v.record.origin.ref };
    const push = (eventType: OutboundEventType, occurredAt: string, key: string, payload: Record<string, unknown>) =>
      out.push({ ...base, eventType, occurredAt, payload, idempotencyKey: `forge:${v.record.id}:${key}` });

    push('commitment.proposed', v.record.proposedAt, 'proposed', {
      statement: v.record.terms.statement,
      owner: v.record.terms.owner.label,
      principal: v.record.terms.principal.label,
      dueBy: v.record.terms.dueBy,
      parentRef: v.record.parentId ? `forge:commitment:${v.record.parentId}` : null,
    });
    for (const h of v.history) {
      if (h.eventId === null) continue;
      const e = v.events.find((x) => x.id === h.eventId);
      if (!e) continue;
      switch (e.type) {
        case 'ACCEPTED':
          push('commitment.accepted', e.effectiveAt, e.id, { owner: e.payload.party.label });
          break;
        case 'DECLINED':
          push('commitment.declined', e.effectiveAt, e.id, { owner: e.payload.party.label, reason: e.reason });
          break;
        case 'TERMS_CHANGED': {
          const c = e.payload.change;
          const type = c.kind === 'REDATE' ? 'commitment.redated' : c.kind === 'RESCOPE' ? 'commitment.rescoped' : 'commitment.reassigned';
          push(type, e.effectiveAt, e.id, { change: c, reason: e.reason });
          break;
        }
        case 'CLOSED': {
          const variance = varianceOf(v);
          push('commitment.closed', e.effectiveAt, e.id, {
            resolution: e.payload.resolution,
            reason: e.reason,
            confirmedWithoutEvidence: e.payload.confirmedWithoutEvidence,
            daysAgainstOriginal: variance.time.daysAgainstOriginal,
          });
          break;
        }
        case 'OUTCOME_OBSERVED':
          push('outcome.observed', e.effectiveAt, e.id, {
            statement: e.payload.outcome.statement,
            measures: varianceOf(v).measures.filter((m) => m.actual !== null).map((m) => ({ key: m.key, expected: m.expected, actual: m.actual, difference: m.difference })),
          });
          break;
        case 'LEARNING_RECORDED':
          push('learning.recorded', e.effectiveAt, e.id, { kind: e.payload.learning.kind, statement: e.payload.learning.statement, author: e.actor.label });
          break;
        case 'OUTCOME_PUBLISHED':
          // The verified outcome itself — the record Helm turns into an outcome review and an episode reference.
          push('outcome.published', e.effectiveAt, e.id, { publication: e.payload.publication, publishedBy: e.actor.label });
          break;
        default:
          break;
      }
    }

    const lookup = (cid: string) => byId.get(cid) ?? null;
    const late = conditionsOf(v, lookup).filter((c: Condition) => c.code === 'DEPENDENCY_LATE');
    for (const d of v.dependencies) {
      if (d.dependency.helmTriggerKey === null || d.dependency.neededBy === null) continue;
      const lateNow = late.some((c) => c.ask?.subject === d.dependency.key);
      const settledLate = d.settled !== null && dateOf(d.settled.at) > d.dependency.neededBy;
      if (!lateNow && !settledLate) continue;
      push('review_trigger.observed', `${nextDay(d.dependency.neededBy)}T00:00:00.000Z`, `trigger:${d.dependency.helmTriggerKey}`, {
        triggerKey: d.dependency.helmTriggerKey,
        dependency: d.dependency.description,
        neededBy: d.dependency.neededBy,
        settledAt: d.settled?.at ?? null,
      });
    }
  }
  return out.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
