/**
 * A reader's ledger, kept warm (development plan 2.4).
 *
 * Every Forge reading derives from the whole ledger of an organization: the asks, the conditions, a trace. Reading
 * it whole on every call is what stops scaling — not the derivation, the transfer: at ten thousand commitments the
 * events alone are tens of megabytes. This store wraps another and keeps, per reader, what it has already read; each
 * reading asks only for what was recorded since, and merges it.
 *
 * What it keeps is a COPY OF READS, never state: nothing derived is stored, nothing is written anywhere but through
 * the store it wraps, and dropping it changes no answer. It is keyed by the reader — organization, person and
 * clearances — because what a reader may read differs (ADR-0015, ADR-0017).
 *
 * Record time is stamped by the database when a transaction begins and becomes visible when it commits, so a write
 * can appear with a record time a little older than the newest one already read. Each catch-up therefore re-reads an
 * overlap window behind the newest record time it has seen — as ids, reading whole only what it does not hold. A transaction that
 * stays open longer than the window could be missed until `forget`; Forge writes one statement per transaction.
 */

import { ok, type Result, type Scope } from './primitives.ts';
import type { CommitmentFilter, CommitmentStore } from './port.ts';
import type { CommitmentEvent, CommitmentRecord } from './types.ts';
import { orderEvents } from './derive.ts';

export type LedgerCacheOptions = {
  /** How far behind the newest record time each catch-up re-reads. Default: five minutes. */
  readonly overlapMs?: number;
};

type Ledger = {
  readonly records: Map<string, CommitmentRecord>;
  readonly events: Map<string, CommitmentEvent[]>;
  readonly seen: Set<string>;
  newest: string | null;
  /** Set by a listing, spent by the next events read: one reading sees one catch-up, its records and their events. */
  listed: boolean;
};

/** Who is reading, as far as what they may read goes: organization, person, clearances. */
export const readerKey = (s: Scope): string => `${s.orgId}|${s.actor.kind}:${s.actor.id}|${s.clearances === 'ALL' ? 'ALL' : [...(s.clearances ?? [])].sort().join(',')}`;

const recordOrder = (a: CommitmentRecord, b: CommitmentRecord): number => (a.recordedAt === b.recordedAt ? (a.id < b.id ? -1 : 1) : a.recordedAt < b.recordedAt ? -1 : 1);

export function createLedgerCache(inner: CommitmentStore, options: LedgerCacheOptions = {}): CommitmentStore & { forget(scope?: Scope): void } {
  const overlap = options.overlapMs ?? 5 * 60_000;
  const ledgers = new Map<string, Ledger>();

  const behind = (iso: string): string => new Date(Date.parse(iso) - overlap).toISOString();

  /** Catch the reader's ledger up with the store: everything at first, then only what was recorded since. */
  async function caughtUp(scope: Scope): Promise<Result<Ledger | null>> {
    if (!inner.recordedAfter) return ok(null);
    const key = readerKey(scope);
    const ledger = ledgers.get(key) ?? { records: new Map(), events: new Map(), seen: new Set(), newest: null, listed: false };
    const fresh = await inner.recordedAfter(scope, ledger.newest === null ? null : behind(ledger.newest), (id) => ledger.seen.has(id) || ledger.records.has(id));
    if (!fresh.ok) return fresh;
    for (const r of fresh.value.records) {
      if (!ledger.records.has(r.id)) ledger.records.set(r.id, r);
      if (ledger.newest === null || r.recordedAt > ledger.newest) ledger.newest = r.recordedAt;
    }
    for (const e of fresh.value.events) {
      if (ledger.newest === null || e.recordedAt > ledger.newest) ledger.newest = e.recordedAt;
      if (ledger.seen.has(e.id)) continue;
      ledger.seen.add(e.id);
      const on = ledger.events.get(e.commitmentId);
      if (on) on.push(e);
      else ledger.events.set(e.commitmentId, [e]);
    }
    ledgers.set(key, ledger);
    return ok(ledger);
  }

  return {
    insertCommitment: (scope, record) => inner.insertCommitment(scope, record),
    appendEvents: (scope, events) => inner.appendEvents(scope, events),
    getCommitment: (scope, id) => inner.getCommitment(scope, id),
    findByIdempotencyKey: (scope, key) => inner.findByIdempotencyKey(scope, key),
    recordedAfter: inner.recordedAfter ? (scope, after, known) => inner.recordedAfter!(scope, after, known) : undefined,

    async listCommitments(scope, filter: CommitmentFilter = {}) {
      const ledger = await caughtUp(scope);
      if (!ledger.ok) return ledger;
      if (ledger.value === null) return inner.listCommitments(scope, filter);
      ledger.value.listed = true;
      const out = [...ledger.value.records.values()].filter(
        (r) => (filter.parentId === undefined || r.parentId === filter.parentId) && (filter.originRef === undefined || r.origin.ref === filter.originRef),
      );
      return ok(out.sort(recordOrder));
    },

    async eventsFor(scope, ids) {
      const held = ledgers.get(readerKey(scope));
      const ledger = held?.listed ? ok(held) : await caughtUp(scope);
      if (held) held.listed = false;
      if (!ledger.ok) return ledger;
      if (ledger.value === null) return inner.eventsFor(scope, ids);
      const l = ledger.value;
      return ok(orderEvents([...new Set(ids)].flatMap((id) => l.events.get(id) ?? [])));
    },

    /** Drop what a reader (or every reader) has read; the next reading reads whole. */
    forget(scope?: Scope) {
      if (scope) ledgers.delete(readerKey(scope));
      else ledgers.clear();
    },
  };
}
