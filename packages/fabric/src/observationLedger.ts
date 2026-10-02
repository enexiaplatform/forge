/**
 * The observation ledger — what each execution surface reported, once (ADR-0027).
 *
 * Every observation a surface delivers is kept, whether or not anything in Forge was waiting for it: an observation
 * nothing matches today may be what a commitment proposed tomorrow names as its evidence, and a reader can always see
 * what a system said and when. Accepted once per organization, system and id — re-delivery changes nothing — and never
 * edited or removed. A surface's checkpoint is derived from it (the latest occurredAt), never stored beside it.
 *
 * In Postgres this is `forge_observations`: written only by the service role (a surface's connector), read by members
 * under Helm's clearance for the classes a fact carries (ADR-0017).
 */

import { ok, type Result, type Scope } from '@forge/kernel';
import type { Row, TableClient } from '@forge/kernel/postgres';
import type { Observation, ObservationValue } from './surfaces.ts';

export interface ObservationLedger {
  /** Keep what is new; report what was already held. */
  record(scope: Scope, observations: readonly Observation[]): Promise<Result<{ readonly fresh: readonly Observation[]; readonly duplicates: number }>>;
  /** What a system reported, oldest first; after an instant when given. */
  list(scope: Scope, filter?: { readonly system?: string; readonly after?: string | null }): Promise<Result<readonly Observation[]>>;
}

const key = (orgId: string, o: Pick<Observation, 'system' | 'id'>) => `${orgId}|${o.system}|${o.id}`;
const byTime = (a: Observation, b: Observation) => (a.occurredAt === b.occurredAt ? (a.id < b.id ? -1 : 1) : a.occurredAt < b.occurredAt ? -1 : 1);

export function createInMemoryObservationLedger(): ObservationLedger {
  const held = new Map<string, { orgId: string; o: Observation }>();
  return {
    async record(scope, observations) {
      const fresh: Observation[] = [];
      for (const o of observations) {
        const k = key(scope.orgId, o);
        if (held.has(k)) continue;
        held.set(k, { orgId: scope.orgId, o: structuredClone(o) });
        fresh.push(o);
      }
      return ok({ fresh, duplicates: observations.length - fresh.length });
    },
    async list(scope, filter = {}) {
      return ok(
        [...held.values()]
          .filter((h) => h.orgId === scope.orgId && (filter.system === undefined || h.o.system === filter.system) && (filter.after == null || h.o.occurredAt > filter.after))
          .map((h) => h.o)
          .sort(byTime),
      );
    },
  };
}

const TABLE = 'forge_observations';
const SLICE = 150;
const chunks = <T>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

const toRow = (orgId: string, o: Observation): Row => ({
  org_id: orgId,
  source_system: o.system,
  id: o.id,
  event_type: o.eventType,
  object_ref: o.objectRef,
  entity_ref: o.entityRef,
  occurred_at: o.occurredAt,
  payload: o.payload,
  summary: o.summary,
  url: o.url,
  protection: [...(o.protection ?? [])],
});

const json = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));

const toObservation = (r: Row): Observation => {
  const protection = json<string[]>(r.protection ?? []) ?? [];
  return {
    id: String(r.id),
    system: String(r.source_system),
    eventType: String(r.event_type),
    objectRef: String(r.object_ref),
    entityRef: r.entity_ref === null || r.entity_ref === undefined ? null : String(r.entity_ref),
    occurredAt: new Date(String(r.occurred_at)).toISOString(),
    payload: json<Record<string, ObservationValue>>(r.payload ?? {}),
    summary: String(r.summary),
    url: r.url === null || r.url === undefined ? null : String(r.url),
    ...(protection.length > 0 ? { protection: protection as Observation['protection'] } : {}),
  };
};

/** The ledger over `forge_observations`, through a TableClient — written as the service role, as a connector. */
export function createTableObservationLedger(db: TableClient): ObservationLedger {
  return {
    async record(scope, observations) {
      const fresh: Observation[] = [];
      const bySystem = new Map<string, Observation[]>();
      for (const o of observations) bySystem.set(o.system, [...(bySystem.get(o.system) ?? []), o]);
      for (const [system, list] of bySystem) {
        for (const slice of chunks(list, SLICE)) {
          const existing = await db.select(TABLE, { eq: { org_id: scope.orgId, source_system: system }, in: { column: 'id', values: slice.map((o) => o.id) }, columns: ['id'] });
          if (!existing.ok) return existing;
          const have = new Set(existing.value.map((r) => String(r.id)));
          const missing = slice.filter((o) => !have.has(o.id));
          if (missing.length === 0) continue;
          const inserted = await db.insert(TABLE, missing.map((o) => toRow(scope.orgId, o)));
          if (inserted.ok) {
            fresh.push(...missing);
            continue;
          }
          // Another delivery raced this one: keep each row on its own, and count the ones already held as duplicates.
          if (inserted.error.details?.sqlstate !== '23505') return inserted;
          for (const o of missing) {
            const one = await db.insert(TABLE, [toRow(scope.orgId, o)]);
            if (one.ok) fresh.push(o);
            else if (one.error.details?.sqlstate !== '23505') return one;
          }
        }
      }
      return ok({ fresh, duplicates: observations.length - fresh.length });
    },
    async list(scope, filter = {}) {
      const eq: Record<string, string> = { org_id: scope.orgId };
      if (filter.system) eq.source_system = filter.system;
      const r = await db.select(TABLE, {
        eq,
        ...(filter.after ? { gt: { column: 'occurred_at', value: filter.after } } : {}),
        order: [{ column: 'occurred_at', ascending: true }, { column: 'id', ascending: true }],
      });
      return r.ok ? ok(r.value.map(toObservation)) : r;
    },
  };
}
