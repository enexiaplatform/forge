/**
 * The in-memory reference store: what the demo, the tests and the contracts run
 * on. It keeps the same promises the database does — tenant wall, append-only,
 * record time stamped by the store, idempotency keys unique per organization.
 */

import { type Clock, fail, ok, type Result } from './primitives.ts';
import type { CommitmentFilter, CommitmentStore } from './port.ts';
import type { CommitmentEvent, CommitmentRecord } from './types.ts';
import { hasText, readAs, textCeiling, textMeetsCeiling } from './sensitivity.ts';
import { orderEvents } from './derive.ts';

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

export function createInMemoryStore(clock: Clock): CommitmentStore & { snapshot(): { records: CommitmentRecord[]; events: CommitmentEvent[] } } {
  const records = new Map<string, CommitmentRecord>();
  const events: CommitmentEvent[] = [];
  const byCommitment = new Map<string, CommitmentEvent[]>();
  const keys = new Map<string, string>();
  const seqs = new Map<string, number>();

  // Copied once on the way in, then frozen all the way down: what a reader receives cannot change the record, so it
  // is handed out as it is rather than copied on every read.
  const freeze = <T>(v: T): T => deepFreeze(structuredClone(v));
  const hand = <T>(v: T): T => deepFreeze(v);

  return {
    async insertCommitment(scope, record) {
      if (record.orgId !== scope.orgId) return fail('tenant.mismatch', 'A commitment can only be written into the reader’s own organization.');
      if (records.has(record.id)) return fail('commitment.duplicate', 'That commitment already exists.');
      if (record.parentId !== null) {
        const parent = records.get(record.parentId);
        if (!parent || parent.orgId !== scope.orgId) return fail('commitment.parent_not_found', 'The parent commitment does not exist.');
      }
      const stored: CommitmentRecord = freeze({ ...record, recordedAt: clock.now() });
      records.set(stored.id, stored);
      return ok(hand(stored));
    },

    async appendEvents(scope, batch) {
      // Validate the whole batch before writing any of it.
      const batchKeys = new Set<string>();
      for (const [i, e] of batch.entries()) {
        if (e.orgId !== scope.orgId) return fail('tenant.mismatch', 'An event can only be written into the reader’s own organization.');
        const rec = records.get(e.commitmentId);
        if (!rec || rec.orgId !== scope.orgId) return fail('commitment.not_found', 'The commitment does not exist.');
        if (e.idempotencyKey !== null) {
          const k = `${e.orgId}|${e.idempotencyKey}`;
          if (keys.has(k) || batchKeys.has(k)) return fail('event.duplicate_idempotency_key', 'That event has already been recorded.');
          batchKeys.add(k);
        }
        // ADR-0017: words are protected at least as well as the commitment they are written on.
        if (hasText(e) && !textMeetsCeiling(e, textCeiling(rec, [...(byCommitment.get(e.commitmentId) ?? []), ...batch.slice(0, i).filter((x) => x.commitmentId === e.commitmentId)]))) {
          return fail('event.text_below_ceiling', 'Words written on this commitment must carry every class it rests on; they cannot be stored less protected.');
        }
      }
      const now = clock.now();
      const written: CommitmentEvent[] = [];
      for (const e of batch) {
        const seq = (seqs.get(e.commitmentId) ?? 0) + 1;
        seqs.set(e.commitmentId, seq);
        const stored = freeze({ ...e, seq, recordedAt: now }) as CommitmentEvent;
        events.push(stored);
        const on = byCommitment.get(e.commitmentId);
        if (on) on.push(stored);
        else byCommitment.set(e.commitmentId, [stored]);
        if (e.idempotencyKey !== null) keys.set(`${e.orgId}|${e.idempotencyKey}`, e.id);
        written.push(hand(stored));
      }
      return ok(written);
    },

    async getCommitment(scope, id) {
      const rec = records.get(id);
      return ok(rec && rec.orgId === scope.orgId ? hand(rec) : null);
    },

    async listCommitments(scope, filter: CommitmentFilter = {}) {
      const out = [...records.values()].filter(
        (r) =>
          r.orgId === scope.orgId &&
          (filter.parentId === undefined || r.parentId === filter.parentId) &&
          (filter.originRef === undefined || r.origin.ref === filter.originRef),
      );
      out.sort((a, b) => (a.recordedAt === b.recordedAt ? (a.id < b.id ? -1 : 1) : a.recordedAt < b.recordedAt ? -1 : 1));
      return ok(hand(out));
    },

    async eventsFor(scope, ids) {
      // ADR-0017: what a reader is not cleared for is withheld, never silently dropped.
      const found = [...new Set(ids)].flatMap((id) => (byCommitment.get(id) ?? []).filter((e) => e.orgId === scope.orgId));
      return ok(hand(orderEvents(found.map((e) => readAs(e, scope.clearances)))));
    },

    async findByIdempotencyKey(scope, key): Promise<Result<CommitmentEvent | null>> {
      const id = keys.get(`${scope.orgId}|${key}`);
      const found = id ? (events.find((e) => e.id === id) ?? null) : null;
      return ok(found ? hand(readAs(found, scope.clearances)) : null);
    },

    async recordedAfter(scope, after, known = () => false) {
      const later = (at: string) => after === null || at > after;
      const recs = [...records.values()].filter((r) => r.orgId === scope.orgId && later(r.recordedAt) && !known(r.id));
      const evs = events.filter((e) => e.orgId === scope.orgId && later(e.recordedAt) && !known(e.id)).map((e) => readAs(e, scope.clearances));
      return ok({ records: hand(recs), events: hand(orderEvents(evs)) });
    },

    snapshot() {
      return { records: freeze([...records.values()]), events: freeze(events) };
    },
  };
}

