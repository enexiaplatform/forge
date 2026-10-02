/**
 * The in-memory reference store: what the demo, the tests and the contracts run
 * on. It keeps the same promises the database does — tenant wall, append-only,
 * record time stamped by the store, idempotency keys unique per organization.
 */

import { type Clock, fail, ok, type Result } from './primitives.ts';
import type { CommitmentFilter, CommitmentStore } from './port.ts';
import type { CommitmentEvent, CommitmentRecord } from './types.ts';
import { readAs, textCeiling, textMeetsCeiling } from './sensitivity.ts';
import { orderEvents } from './derive.ts';

export function createInMemoryStore(clock: Clock): CommitmentStore & { snapshot(): { records: CommitmentRecord[]; events: CommitmentEvent[] } } {
  const records = new Map<string, CommitmentRecord>();
  const events: CommitmentEvent[] = [];
  const keys = new Map<string, string>();
  const seqs = new Map<string, number>();

  const freeze = <T>(v: T): T => structuredClone(v);

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
      return ok(freeze(stored));
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
        const before = [...events.filter((x) => x.commitmentId === e.commitmentId), ...batch.slice(0, i).filter((x) => x.commitmentId === e.commitmentId)];
        if (!textMeetsCeiling(e, textCeiling(rec, before))) {
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
        if (e.idempotencyKey !== null) keys.set(`${e.orgId}|${e.idempotencyKey}`, e.id);
        written.push(freeze(stored));
      }
      return ok(written);
    },

    async getCommitment(scope, id) {
      const rec = records.get(id);
      return ok(rec && rec.orgId === scope.orgId ? freeze(rec) : null);
    },

    async listCommitments(scope, filter: CommitmentFilter = {}) {
      const out = [...records.values()].filter(
        (r) =>
          r.orgId === scope.orgId &&
          (filter.parentId === undefined || r.parentId === filter.parentId) &&
          (filter.originRef === undefined || r.origin.ref === filter.originRef),
      );
      out.sort((a, b) => (a.recordedAt === b.recordedAt ? (a.id < b.id ? -1 : 1) : a.recordedAt < b.recordedAt ? -1 : 1));
      return ok(freeze(out));
    },

    async eventsFor(scope, ids) {
      const wanted = new Set(ids);
      // ADR-0017: what a reader is not cleared for is withheld, never silently dropped.
      return ok(freeze(orderEvents(events.filter((e) => e.orgId === scope.orgId && wanted.has(e.commitmentId)).map((e) => readAs(e, scope.clearances)))));
    },

    async findByIdempotencyKey(scope, key): Promise<Result<CommitmentEvent | null>> {
      const id = keys.get(`${scope.orgId}|${key}`);
      const found = id ? (events.find((e) => e.id === id) ?? null) : null;
      return ok(found ? freeze(readAs(found, scope.clearances)) : null);
    },

    snapshot() {
      return { records: freeze([...records.values()]), events: freeze(events) };
    },
  };
}

