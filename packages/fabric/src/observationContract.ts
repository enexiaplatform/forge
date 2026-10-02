/**
 * forge.observation.v1 — the open door for execution surfaces (§8 "Forge should not become another closed system",
 * §24 "external systems are first-class citizens"; ADR-0027).
 *
 * Any system where work happens — a tracker, an ERP, a warehouse, an HRIS — reports what it recorded to Forge in one
 * signed envelope, without Forge writing a connector for it. The contract is deliberately narrow:
 *
 *   * a surface reports only ITS OWN records: the envelope names its system, and that system's secret signs it;
 *   * Helm, Memoire and Forge itself have their own contracts and cannot be claimed here;
 *   * observations are facts of that system, recorded by its connector — never a status, never "progress";
 *   * each observation is accepted once, by its id; re-delivery changes nothing;
 *   * a class the source gives a fact is carried onto everything derived from it (ADR-0017), and nothing lowers it.
 *
 * Signing is the same as Memoire's webhooks v1: `Forge-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`
 * with `Forge-Timestamp` (Unix seconds) within five minutes, and `Forge-Surface` naming the system.
 */

import { fail, ok, protectionOf, type Result, sensitivityClasses } from '@forge/kernel';
import type { Observation, ObservationValue } from './surfaces.ts';

export const OBSERVATION_CONTRACT = 'forge.observation.v1';

/** Systems with their own contracts: they never report through this door. */
export const RESERVED_SYSTEMS = ['helm', 'memoire', 'forge'] as const;

export const OBSERVATION_LIMITS = { perBatch: 500, payloadKeys: 50, futureSkewSeconds: 300 } as const;

export type ObservationBatch = { readonly contract: typeof OBSERVATION_CONTRACT; readonly system: string; readonly observations: readonly Observation[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const SYSTEM = /^[a-z][a-z0-9-]{1,39}$/;
const EVENT_TYPE = /^[a-z][a-z0-9_.-]{0,119}$/;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** Everything wrong with an observation, in the order a sender would fix it. Empty: it is well-formed. */
function problemsOf(o: unknown, nowSeconds: number): string[] {
  if (!isObject(o)) return ['is not an object'];
  const out: string[] = [];
  if (!text(o.id, 200)) out.push('needs an id (1–200 characters), stable in the source');
  if (typeof o.eventType !== 'string' || !EVENT_TYPE.test(o.eventType)) out.push('needs an eventType like "stock_transfer.received"');
  if (!text(o.objectRef, 300)) out.push('needs an objectRef — the record it is about, as the source names it');
  if (o.entityRef !== undefined && o.entityRef !== null && !text(o.entityRef, 300)) out.push('entityRef, when given, is a reference');
  const at = typeof o.occurredAt === 'string' ? Date.parse(o.occurredAt) : Number.NaN;
  if (Number.isNaN(at)) out.push('needs occurredAt, an ISO instant');
  else if (at / 1000 > nowSeconds + OBSERVATION_LIMITS.futureSkewSeconds) out.push('occurredAt is in the future');
  if (!text(o.summary, 2000)) out.push('needs a summary — the source’s own words for what it recorded');
  if (o.url !== undefined && o.url !== null && (typeof o.url !== 'string' || !/^https:\/\/\S{1,2000}$/.test(o.url))) out.push('url, when given, is https');
  if (o.payload !== undefined) {
    if (!isObject(o.payload)) out.push('payload is a flat object');
    else {
      const entries = Object.entries(o.payload);
      if (entries.length > OBSERVATION_LIMITS.payloadKeys) out.push(`payload has more than ${OBSERVATION_LIMITS.payloadKeys} fields`);
      if (entries.some(([, v]) => v !== null && !['string', 'number', 'boolean'].includes(typeof v))) out.push('payload values are strings, numbers, booleans or null — nothing nested');
    }
  }
  if (o.protection !== undefined) {
    const known = new Set<string>(sensitivityClasses);
    if (!Array.isArray(o.protection) || o.protection.some((c) => typeof c !== 'string' || !known.has(c))) out.push(`protection lists classes Helm knows: ${sensitivityClasses.join(', ')}`);
  }
  return out;
}

/**
 * Parse a signed body for `surface` (the system the signing secret belongs to). Refuses, by name, an envelope for
 * another system, a reserved system, a batch too large, and every malformed observation — the whole batch or nothing.
 */
export function parseObservationBatch(rawBody: string, surface: string, nowSeconds: number): Result<ObservationBatch> {
  let v: unknown;
  try {
    v = JSON.parse(rawBody);
  } catch {
    return fail('observation.invalid', 'The body is not JSON.');
  }
  if (!isObject(v) || v.contract !== OBSERVATION_CONTRACT) return fail('observation.unsupported', `Forge reads ${OBSERVATION_CONTRACT}.`);
  if (typeof v.system !== 'string' || !SYSTEM.test(v.system)) return fail('observation.invalid', 'The envelope names no system.');
  if ((RESERVED_SYSTEMS as readonly string[]).includes(v.system)) return fail('observation.reserved_system', `${v.system} reports through its own contract, not this one.`);
  if (v.system !== surface) return fail('observation.not_your_system', `This surface signs for ${surface}; it cannot report ${v.system}'s records.`);
  if (!Array.isArray(v.observations) || v.observations.length === 0) return fail('observation.invalid', 'The batch holds no observations.');
  if (v.observations.length > OBSERVATION_LIMITS.perBatch) return fail('observation.too_many', `At most ${OBSERVATION_LIMITS.perBatch} observations per batch.`);
  const problems = v.observations.flatMap((o, i) => problemsOf(o, nowSeconds).map((p) => `observation ${i + 1} ${p}`));
  if (problems.length > 0) return fail('observation.invalid', problems.slice(0, 20).join('; ') + '.', { problems });
  const system = v.system;
  const ids = new Set<string>();
  const observations: Observation[] = [];
  for (const raw of v.observations as Record<string, unknown>[]) {
    const id = String(raw.id);
    if (ids.has(id)) continue; // the same observation twice in one batch is one observation
    ids.add(id);
    observations.push({
      id,
      system,
      eventType: String(raw.eventType),
      objectRef: String(raw.objectRef),
      entityRef: typeof raw.entityRef === 'string' ? raw.entityRef : null,
      occurredAt: new Date(String(raw.occurredAt)).toISOString(),
      payload: (isObject(raw.payload) ? raw.payload : {}) as Readonly<Record<string, ObservationValue>>,
      summary: String(raw.summary),
      url: typeof raw.url === 'string' ? raw.url : null,
      ...(Array.isArray(raw.protection) && raw.protection.length > 0 ? { protection: protectionOf(raw.protection as string[]) } : {}),
    });
  }
  return ok({ contract: OBSERVATION_CONTRACT, system, observations });
}
