/**
 * Execution surfaces — where work actually happens (§8, §24).
 *
 * Forge does not ask anyone to move their work into it. An execution surface
 * is any system that records work or its results — a work tracker, an ERP, a
 * warehouse, an HRIS, Memoire, Helm's own value graph — reached through one
 * port. A surface reports OBSERVATIONS: what it recorded, about which object,
 * when. It never reports "progress": activity counts arrive as activity, and
 * only an observation that matches what a commitment said would prove it
 * becomes evidence (ingest.ts).
 */

import type { Protection } from '@forge/kernel';

export type ObservationValue = string | number | boolean | null;

export type Observation = {
  /** Stable in the source system; re-delivery of the same id changes nothing. */
  readonly id: string;
  readonly system: string;
  readonly eventType: string;
  /** The object in the source system the observation is about: 'TR-0412', 'LOG-88'. */
  readonly objectRef: string;
  /** The shared enterprise entity it concerns, when known: 'memoire:opportunity:rohto-q4-tender'. */
  readonly entityRef: string | null;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, ObservationValue>>;
  /** The source's own description, shown as the evidence statement. */
  readonly summary: string;
  readonly url: string | null;
  /** The classes the source gave this fact (Helm's value classes). Carried onto anything derived from it (ADR-0017). */
  readonly protection?: Protection;
};

export interface ExecutionSurface {
  readonly system: string;
  readonly label: string;
  /** What the surface records, in a sentence — for the Surfaces instrument page. */
  readonly describes: string;
  /** Observations that occurred after `since` (all when null) and no later than `until`, oldest first. */
  pull(since: string | null, until: string): Promise<readonly Observation[]>;
}

/** A surface over a fixed list of observations — the demo's ERP, warehouse, tracker and Memoire. */
export function createFixtureSurface(system: string, label: string, describes: string, observations: readonly Observation[]): ExecutionSurface {
  const sorted = [...observations].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  return {
    system,
    label,
    describes,
    async pull(since, until) {
      return sorted.filter((o) => (since === null || o.occurredAt > since) && o.occurredAt <= until);
    },
  };
}

/** Which surface a checkpoint belongs to. Two surfaces of one system (Memoire's opportunities and its promises) keep separate checkpoints. */
export type SurfaceKey = Pick<ExecutionSurface, 'system' | 'label'>;

/** Ingestion checkpoints, derived from what was ingested — never stored separately from it. */
export type IngestionLedger = {
  record(surface: SurfaceKey, observations: readonly Observation[]): void;
  checkpoint(surface: SurfaceKey): string | null;
  entries(): readonly { readonly system: string; readonly observation: Observation }[];
};

export function createIngestionLedger(): IngestionLedger {
  const seen: { system: string; label: string; observation: Observation }[] = [];
  const ids = new Set<string>();
  return {
    record({ system, label }, observations) {
      for (const o of observations) {
        if (ids.has(`${system}|${o.id}`)) continue;
        ids.add(`${system}|${o.id}`);
        seen.push({ system, label, observation: o });
      }
    },
    checkpoint({ system, label }) {
      const mine = seen.filter((s) => s.system === system && s.label === label).map((s) => s.observation.occurredAt);
      return mine.length === 0 ? null : mine.reduce((a, b) => (a > b ? a : b));
    },
    entries: () => seen.map(({ system, observation }) => ({ system, observation })),
  };
}
