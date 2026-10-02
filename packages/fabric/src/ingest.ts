/**
 * Ingestion — observations in, evidence and activity out (§12).
 *
 * For every observation, Forge asks four questions of the commitments it holds:
 *
 *   1. ACTIVITY — is it about an object a commitment is executed through, with
 *      done/total counts? Recorded as activity on that link. Never evidence.
 *   2. EVIDENCE — does it match a requirement's matcher? When the matcher pins
 *      an object (`objectRef`), the observation is about that very object, so
 *      its payload either agrees with `where` (SUPPORTS) or does not
 *      (CONTRADICTS: the source said something, and it was not this). When the
 *      matcher pins no object, `where` only filters which observations count.
 *   3. DEPENDENCY — does it settle something a commitment waits on?
 *      A matcher that names no object and filters on nothing is never acted on:
 *      "any stock transfer anywhere" is not evidence of this one.
 *   4. CONTEXT — does it change the world a commitment rests on (a lost
 *      opportunity, a reconsidered decision)?
 *
 * Everything is recorded by the source system's connector as a SYSTEM actor,
 * as FACTs of that system, with an idempotency key per observation and effect,
 * so delivering the same observation twice changes nothing.
 */

import { type CommitmentView, type EvidenceMatcher, type ForgeRuntime, isWatchable, ok, type Result, type Scope } from '@forge/kernel';
import type { Observation } from './surfaces.ts';

export type IngestEffect = {
  readonly observationId: string;
  readonly commitmentId: string;
  readonly kind: 'ACTIVITY' | 'EVIDENCE_SUPPORTS' | 'EVIDENCE_CONTRADICTS' | 'DEPENDENCY_SETTLED' | 'CONTEXT_CHANGED';
  readonly detail: string;
};

export type IngestReport = {
  readonly effects: readonly IngestEffect[];
  /** Observations nothing in Forge was waiting for — kept on the ledger, attached to nothing. */
  readonly unmatched: readonly string[];
  readonly failures: readonly { readonly observationId: string; readonly message: string }[];
};

/** Source events that change the world a commitment rests on, by system. */
export const CONTEXT_EVENTS: Readonly<Record<string, readonly string[]>> = {
  memoire: ['opportunity.lost', 'opportunity.cancelled', 'account.churned', 'commitment.cancelled'],
  helm: ['decision.reconsidered', 'decision.revised'],
};

export const connectorScope = (orgId: string, system: string): Scope => ({
  orgId,
  actor: { kind: 'SYSTEM', id: `${system}-connector`, label: `${system} connector` },
  role: 'member',
  actsAs: [],
});

/** Does the observation fall under this matcher at all, and if so does it agree? */
export function matchObservation(m: EvidenceMatcher, o: Observation): 'SUPPORTS' | 'CONTRADICTS' | null {
  if (!isWatchable(m)) return null;
  if (m.system !== o.system || m.eventType !== o.eventType) return null;
  if (m.objectRef !== null && m.objectRef !== o.objectRef) return null;
  const agrees = Object.entries(m.where).every(([k, v]) => k in o.payload && String(o.payload[k]) === String(v));
  if (m.objectRef === null) return agrees ? 'SUPPORTS' : null;
  return agrees ? 'SUPPORTS' : 'CONTRADICTS';
}

export async function ingestObservations(runtime: ForgeRuntime, orgId: string, observations: readonly Observation[]): Promise<Result<IngestReport>> {
  const effects: IngestEffect[] = [];
  const unmatched: string[] = [];
  const failures: { observationId: string; message: string }[] = [];

  for (const o of observations) {
    const scope = connectorScope(orgId, o.system);
    const views = await runtime.list(scope);
    if (!views.ok) return views;
    const before = effects.length;
    for (const v of views.value) {
      if (v.phase === 'DECLINED') continue;
      const r = await applyTo(runtime, scope, v, o, effects);
      if (!r.ok) failures.push({ observationId: o.id, message: r.error.message });
    }
    if (effects.length === before) unmatched.push(o.id);
  }
  return ok({ effects, unmatched, failures });
}

async function applyTo(runtime: ForgeRuntime, scope: Scope, v: CommitmentView, o: Observation, effects: IngestEffect[]): Promise<Result<true>> {
  const id = v.record.id;
  const key = (purpose: string) => `obs:${o.system}:${o.id}:${id}:${purpose}`;

  // 1. activity on an execution link
  const done = o.payload.done;
  const total = o.payload.total;
  for (const l of v.links) {
    if (l.link.system !== o.system || l.link.ref !== o.objectRef) continue;
    if (typeof done !== 'number' || typeof total !== 'number') continue;
    const r = await runtime.observeActivity(
      scope,
      id,
      { linkId: l.link.id, done, total, unit: typeof o.payload.unit === 'string' ? o.payload.unit : 'items', observationId: o.id },
      { effectiveAt: o.occurredAt, idempotencyKey: key(`activity:${l.link.id}`) },
    );
    if (!r.ok) return r;
    effects.push({ observationId: o.id, commitmentId: id, kind: 'ACTIVITY', detail: `${done} of ${total} on ${l.link.ref}` });
  }

  // 2. evidence for a requirement
  for (const req of v.terms.evidence) {
    if (req.matcher === null) continue;
    const stance = matchObservation(req.matcher, o);
    if (stance === null) continue;
    const r = await runtime.recordEvidence(
      scope,
      id,
      {
        requirementKey: req.key,
        stance,
        epistemic: 'FACT',
        channel: 'SYSTEM_EVENT',
        source: { system: o.system, ref: o.objectRef, url: o.url },
        statement: o.summary,
        observedAt: o.occurredAt,
        confidence: null,
        observationId: o.id,
        // The source's classes travel with the fact (ADR-0017).
        protection: o.protection ?? [],
      },
      { effectiveAt: o.occurredAt, idempotencyKey: key(`evidence:${req.key}`) },
    );
    if (!r.ok) return r;
    effects.push({ observationId: o.id, commitmentId: id, kind: stance === 'SUPPORTS' ? 'EVIDENCE_SUPPORTS' : 'EVIDENCE_CONTRADICTS', detail: req.description });
  }

  // 3. a dependency settles
  for (const d of v.dependencies) {
    if (d.settled !== null || d.dependency.matcher === null) continue;
    if (matchObservation(d.dependency.matcher, o) !== 'SUPPORTS') continue;
    const r = await runtime.settleDependency(scope, id, d.dependency.key, { observationId: o.id }, { effectiveAt: o.occurredAt, idempotencyKey: key(`dependency:${d.dependency.key}`) });
    if (!r.ok) return r;
    effects.push({ observationId: o.id, commitmentId: id, kind: 'DEPENDENCY_SETTLED', detail: d.dependency.description });
  }

  // 4. the world it rests on changes
  if (v.phase !== 'CLOSED' && (CONTEXT_EVENTS[o.system] ?? []).includes(o.eventType) && o.entityRef !== null) {
    const touches = v.record.origin.ref === o.entityRef || v.record.context.some((c) => c.entityRef === o.entityRef) || v.links.some((l) => l.link.ref === o.entityRef);
    if (touches) {
      const r = await runtime.recordContextChange(
        scope,
        id,
        { source: { system: o.system, ref: o.objectRef, url: o.url }, statement: o.summary, material: true },
        { effectiveAt: o.occurredAt, idempotencyKey: key('context') },
      );
      if (!r.ok) return r;
      effects.push({ observationId: o.id, commitmentId: id, kind: 'CONTEXT_CHANGED', detail: o.summary });
    }
  }
  return ok(true);
}
