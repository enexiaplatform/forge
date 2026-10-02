/**
 * The Postgres store — the kernel's one I/O boundary.
 *
 * It speaks to the database through a narrow `TableClient` port (insert rows,
 * select rows), so the same store runs on supabase-js in the browser — under
 * the signed-in user's own row-level security — and on raw SQL in tests, where
 * PGlite applies the real migration (packages/kernel/test/postgres.test.mjs).
 *
 * What the database guarantees, the store relies on rather than repeats:
 * recorded_at and seq are stamped by triggers, append-only is a guard, the
 * tenant wall is RLS. The store maps rows to kernel types and database refusals
 * to kernel error codes.
 */

import { fail, ok, type Result, type Scope } from './primitives.ts';
import type { CommitmentFilter, CommitmentStore } from './port.ts';
import type { CandidateDisposition, CandidateRecord, CandidateStore, NewCandidate, NewDisposition } from './candidates.ts';
import type { CommitmentEvent, CommitmentRecord, NewCommitmentRecord, NewEvent } from './types.ts';
import { type Sealed, sealEvent, unsealEvent } from './sensitivity.ts';

export type Row = Record<string, unknown>;

export type SelectQuery = {
  readonly eq?: Readonly<Record<string, string | number | null>>;
  readonly in?: { readonly column: string; readonly values: readonly string[] };
  /** Strictly after / at most — for checkpointed reads. */
  readonly gt?: { readonly column: string; readonly value: string };
  readonly lte?: { readonly column: string; readonly value: string };
  readonly order?: readonly { readonly column: string; readonly ascending: boolean }[];
  /** The columns to return; all when omitted. */
  readonly columns?: readonly string[];
  readonly limit?: number;
};

/** The two operations the store needs. Errors carry the database's message and SQLSTATE in `details.sqlstate`. */
export interface TableClient {
  insert(table: string, rows: readonly Row[]): Promise<Result<Row[]>>;
  select(table: string, query: SelectQuery): Promise<Result<Row[]>>;
}

const COMMITMENTS = 'forge_commitments';
const EVENTS = 'forge_commitment_events';

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const json = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));

function commitmentRow(r: NewCommitmentRecord): Row {
  return {
    id: r.id,
    org_id: r.orgId,
    parent_id: r.parentId,
    origin_kind: r.origin.kind,
    origin_system: r.origin.system,
    origin_ref: r.origin.ref,
    origin: r.origin,
    terms: r.terms,
    capture: r.capture,
    context: r.context,
    proposed_by: r.proposedBy,
    proposed_at: r.proposedAt,
    fingerprint: r.fingerprint,
  };
}

function toCommitment(row: Row): CommitmentRecord {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    parentId: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
    origin: json(row.origin),
    terms: json(row.terms),
    capture: json(row.capture),
    context: json(row.context),
    proposedBy: json(row.proposed_by),
    proposedAt: iso(row.proposed_at),
    recordedAt: iso(row.recorded_at),
    fingerprint: String(row.fingerprint),
  };
}

/**
 * ADR-0017: a protected event is written open — protected values removed and marked withheld — with its sealed part
 * alongside; the database moves the sealed part into `forge_sealed_values`, where only cleared readers reach it.
 */
function eventRow(e: NewEvent): Row {
  const s = sealEvent(e);
  return {
    id: e.id,
    org_id: e.orgId,
    commitment_id: e.commitmentId,
    event_type: e.type,
    effective_at: e.effectiveAt,
    actor: e.actor,
    reason: e.reason,
    authority: e.authority,
    idempotency_key: e.idempotencyKey,
    payload: s.open.payload,
    protection: [...s.protection],
    sealed: s.sealed,
  };
}

function toEvent(row: Row): CommitmentEvent {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    commitmentId: String(row.commitment_id),
    seq: Number(row.seq),
    type: row.event_type,
    effectiveAt: iso(row.effective_at),
    recordedAt: iso(row.recorded_at),
    actor: json(row.actor),
    reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    authority: row.authority === null || row.authority === undefined ? null : json(row.authority),
    idempotencyKey: row.idempotency_key === null || row.idempotency_key === undefined ? null : String(row.idempotency_key),
    payload: json(row.payload),
  } as CommitmentEvent;
}

/** Database refusals become kernel errors; a guard's message names its code ('forge.parent_not_found: …'). */
function translate<T>(r: Result<T>, fallback: string): Result<T> {
  if (r.ok) return r;
  const guard = /\b(forge\.[a-z_]+):/.exec(r.error.message);
  if (guard) {
    const code =
      guard[1] === 'forge.parent_not_found'
        ? 'commitment.parent_not_found'
        : guard[1] === 'forge.commitment_not_found'
          ? 'commitment.not_found'
          : guard[1] === 'forge.candidate_not_found'
            ? 'candidate.not_found'
            : guard[1] === 'forge.helm_origin_not_found'
              ? 'commitment.origin_not_found'
              : guard[1];
    return fail(code, r.error.message.replace(/^.*?forge\.[a-z_]+:\s*/, ''), r.error.details as Record<string, unknown>);
  }
  if (r.error.details?.sqlstate === '23505') {
    if (/idempotency/.test(r.error.message)) return fail('event.duplicate_idempotency_key', 'That event has already been recorded.');
    if (/dedupe/.test(r.error.message)) return fail('candidate.duplicate', 'That candidate has already been read.');
    if (/dispositions_once/.test(r.error.message)) return fail('candidate.already_disposed', 'That candidate has already been confirmed or dismissed.');
    return fail(fallback === 'commitment' ? 'commitment.duplicate' : 'event.duplicate', 'That record already exists.');
  }
  if (r.error.details?.sqlstate === '42501') return fail('store.refused', 'The database refused the write for this reader.', r.error.details as Record<string, unknown>);
  return r;
}

const SEALED = 'forge_sealed_values';

/** Merge back the sealed values the database lets this reader see (Helm's clearance decides); the rest stay withheld. */
async function unsealRows(db: TableClient, scope: Scope, rows: readonly Row[]): Promise<Result<CommitmentEvent[]>> {
  const events = rows.map(toEvent);
  const protectedIds = rows.filter((row) => Array.isArray(json(row.protection ?? [])) && (json(row.protection ?? []) as unknown[]).length > 0).map((row) => String(row.id));
  if (protectedIds.length === 0) return ok(events);
  const sealed = await db.select(SEALED, { eq: { org_id: scope.orgId }, in: { column: 'event_id', values: protectedIds } });
  if (!sealed.ok) return sealed;
  const byId = new Map(sealed.value.map((row) => [String(row.event_id), json(row.payload) as Sealed]));
  return ok(events.map((e) => unsealEvent(e, byId.get(e.id) ?? null)));
}

export function createPostgresStore(db: TableClient): CommitmentStore {
  return {
    async insertCommitment(scope, record) {
      if (record.orgId !== scope.orgId) return fail('tenant.mismatch', 'A commitment can only be written into the reader’s own organization.');
      const r = translate(await db.insert(COMMITMENTS, [commitmentRow(record)]), 'commitment');
      if (!r.ok) return r;
      if (r.value.length !== 1) return fail('store.not_returned', 'The database did not return the commitment it wrote.');
      return ok(toCommitment(r.value[0]));
    },

    async appendEvents(scope, events) {
      if (events.length === 0) return ok([]);
      if (events.some((e) => e.orgId !== scope.orgId)) return fail('tenant.mismatch', 'An event can only be written into the reader’s own organization.');
      const r = translate(await db.insert(EVENTS, events.map(eventRow)), 'event');
      if (!r.ok) return r;
      // The writer supplied the protected values; they get back what they wrote.
      const sealedBy = new Map(events.map((e) => [e.id, sealEvent(e).sealed]));
      return ok(
        r.value
          .map(toEvent)
          .map((e) => unsealEvent(e, sealedBy.get(e.id) ?? null))
          .sort((a, b) => (a.recordedAt === b.recordedAt ? a.seq - b.seq : a.recordedAt < b.recordedAt ? -1 : 1)),
      );
    },

    async getCommitment(scope, id) {
      const r = await db.select(COMMITMENTS, { eq: { org_id: scope.orgId, id } });
      if (!r.ok) return r;
      return ok(r.value.length === 0 ? null : toCommitment(r.value[0]));
    },

    async listCommitments(scope, filter: CommitmentFilter = {}) {
      const eq: Record<string, string | null> = { org_id: scope.orgId };
      if (filter.parentId !== undefined) eq.parent_id = filter.parentId;
      if (filter.originRef !== undefined) eq.origin_ref = filter.originRef;
      const r = await db.select(COMMITMENTS, { eq, order: [{ column: 'recorded_at', ascending: true }, { column: 'id', ascending: true }] });
      return r.ok ? ok(r.value.map(toCommitment)) : r;
    },

    async eventsFor(scope, ids) {
      if (ids.length === 0) return ok([]);
      const r = await db.select(EVENTS, {
        eq: { org_id: scope.orgId },
        in: { column: 'commitment_id', values: ids },
        order: [{ column: 'recorded_at', ascending: true }, { column: 'seq', ascending: true }],
      });
      if (!r.ok) return r;
      return unsealRows(db, scope, r.value);
    },

    async findByIdempotencyKey(scope, key) {
      const r = await db.select(EVENTS, { eq: { org_id: scope.orgId, idempotency_key: key } });
      if (!r.ok) return r;
      if (r.value.length === 0) return ok(null);
      const events = await unsealRows(db, scope, r.value.slice(0, 1));
      return events.ok ? ok(events.value[0]) : events;
    },
  };
}

// -------------------------------------------------------- candidate store

const CANDIDATES = 'forge_candidates';
const DISPOSITIONS = 'forge_candidate_dispositions';

const candidateRow = (c: NewCandidate): Row => ({
  id: c.id,
  org_id: c.orgId,
  source_kind: c.source.kind,
  source_ref: c.source.ref,
  source: c.source,
  utterance_class: c.utteranceClass,
  proposal: c.proposal,
  confidence: c.confidence,
  epistemic: c.epistemic,
  extractor: c.extractor,
  suggested_by: c.suggestedBy,
  suggested_at: c.suggestedAt,
  dedupe_key: c.dedupeKey,
  fingerprint: c.fingerprint,
});

const toCandidate = (r: Row): CandidateRecord => ({
  id: String(r.id),
  orgId: String(r.org_id),
  source: json(r.source),
  utteranceClass: r.utterance_class as CandidateRecord['utteranceClass'],
  proposal: json(r.proposal),
  confidence: Number(r.confidence),
  epistemic: 'INFERENCE',
  extractor: json(r.extractor),
  suggestedBy: json(r.suggested_by),
  suggestedAt: iso(r.suggested_at),
  recordedAt: iso(r.recorded_at),
  dedupeKey: String(r.dedupe_key),
  fingerprint: String(r.fingerprint),
});

const dispositionRow = (d: NewDisposition): Row => ({
  id: d.id,
  org_id: d.orgId,
  candidate_id: d.candidateId,
  kind: d.kind,
  actor: d.actor,
  at: d.at,
  reason: d.reason,
  commitment_id: d.commitmentId,
  edited: d.edited,
});

const toDisposition = (r: Row): CandidateDisposition => ({
  id: String(r.id),
  orgId: String(r.org_id),
  candidateId: String(r.candidate_id),
  kind: r.kind as CandidateDisposition['kind'],
  actor: json(r.actor),
  at: iso(r.at),
  recordedAt: iso(r.recorded_at),
  reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
  commitmentId: r.commitment_id === null || r.commitment_id === undefined ? null : String(r.commitment_id),
  edited: json(r.edited),
});

export function createPostgresCandidateStore(db: TableClient): CandidateStore {
  return {
    async insertCandidates(scope, records) {
      if (records.length === 0) return ok([]);
      if (records.some((c) => c.orgId !== scope.orgId)) return fail('tenant.mismatch', 'A candidate can only be written into the reader’s own organization.');
      const r = translate(await db.insert(CANDIDATES, records.map(candidateRow)), 'candidate');
      return r.ok ? ok(r.value.map(toCandidate)) : r;
    },
    async insertDisposition(scope, d) {
      if (d.orgId !== scope.orgId) return fail('tenant.mismatch', 'A disposition can only be written into the reader’s own organization.');
      const r = translate(await db.insert(DISPOSITIONS, [dispositionRow(d)]), 'disposition');
      if (!r.ok) return r;
      return r.value.length === 1 ? ok(toDisposition(r.value[0])) : fail('store.not_returned', 'The database did not return the disposition it wrote.');
    },
    async listCandidates(scope) {
      const r = await db.select(CANDIDATES, { eq: { org_id: scope.orgId }, order: [{ column: 'recorded_at', ascending: true }, { column: 'id', ascending: true }] });
      return r.ok ? ok(r.value.map(toCandidate)) : r;
    },
    async listDispositions(scope) {
      const r = await db.select(DISPOSITIONS, { eq: { org_id: scope.orgId }, order: [{ column: 'recorded_at', ascending: true }] });
      return r.ok ? ok(r.value.map(toDisposition)) : r;
    },
  };
}

// ------------------------------------------------------------- SQL client

/** Anything that runs a parameterized query — PGlite, node-postgres. */
export type SqlRunner = (sql: string, params: readonly unknown[]) => Promise<{ rows: Row[] }>;

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (name: string): string => {
  if (!IDENT.test(name)) throw new Error(`Not a plain identifier: ${name}`);
  return `"${name}"`;
};

/** A TableClient over raw SQL. Identifiers are checked against a plain-identifier pattern; values are always parameters. */
export function createSqlTableClient(run: SqlRunner): TableClient {
  const wrap = async (sql: string, params: readonly unknown[]): Promise<Result<Row[]>> => {
    try {
      return ok((await run(sql, params)).rows);
    } catch (e) {
      const err = e as { message?: string; code?: string; constraint?: string };
      return fail('db.error', err.message ?? String(e), { sqlstate: err.code ?? null, constraint: err.constraint ?? null });
    }
  };
  return {
    insert(table, rows) {
      if (rows.length === 0) return Promise.resolve(ok([]));
      const columns = Object.keys(rows[0]);
      const params: unknown[] = [];
      const tuples = rows.map((row) => {
        const slots = columns.map((c) => {
          const v = row[c];
          params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
          return `$${params.length}`;
        });
        return `(${slots.join(', ')})`;
      });
      return wrap(`INSERT INTO ${ident(table)} (${columns.map(ident).join(', ')}) VALUES ${tuples.join(', ')} RETURNING *`, params);
    },
    select(table, query) {
      const params: unknown[] = [];
      const where: string[] = [];
      for (const [column, value] of Object.entries(query.eq ?? {})) {
        if (value === null) where.push(`${ident(column)} IS NULL`);
        else {
          params.push(value);
          where.push(`${ident(column)} = $${params.length}`);
        }
      }
      if (query.in) {
        params.push([...query.in.values]);
        where.push(`${ident(query.in.column)} = ANY($${params.length})`);
      }
      if (query.gt) {
        params.push(query.gt.value);
        where.push(`${ident(query.gt.column)} > $${params.length}`);
      }
      if (query.lte) {
        params.push(query.lte.value);
        where.push(`${ident(query.lte.column)} <= $${params.length}`);
      }
      const order = (query.order ?? []).map((o) => `${ident(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`);
      const columns = query.columns && query.columns.length > 0 ? query.columns.map(ident).join(', ') : '*';
      const limit = query.limit !== undefined && Number.isInteger(query.limit) && query.limit > 0 ? ` LIMIT ${query.limit}` : '';
      return wrap(
        `SELECT ${columns} FROM ${ident(table)}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}${order.length ? ` ORDER BY ${order.join(', ')}` : ''}${limit}`,
        params,
      );
    },
  };
}

// -------------------------------------------------------- supabase-js client

/**
 * The query-builder surface of supabase-js this client uses — structural, so the kernel imports no SDK. A real
 * `SupabaseClient` satisfies it, and so does the PostgREST-shaped test transport the integration suite runs on.
 */
export type PostgrestLike = {
  from(table: string): PostgrestQuery;
};
export type PostgrestQuery = {
  select(columns?: string): PostgrestFilter;
  insert(rows: readonly Row[]): { select(columns?: string): PromiseLike<{ data: Row[] | null; error: PostgrestError | null }> };
};
export type PostgrestFilter = PromiseLike<{ data: Row[] | null; error: PostgrestError | null }> & {
  eq(column: string, value: unknown): PostgrestFilter;
  is(column: string, value: null): PostgrestFilter;
  in(column: string, values: readonly unknown[]): PostgrestFilter;
  gt(column: string, value: unknown): PostgrestFilter;
  lte(column: string, value: unknown): PostgrestFilter;
  order(column: string, options: { ascending: boolean }): PostgrestFilter;
  limit(count: number): PostgrestFilter;
};
export type PostgrestError = { message: string; code?: string; details?: string | null };

/** A TableClient over supabase-js — the browser's path, under the signed-in user's own RLS. */
export function createSupabaseTableClient(client: PostgrestLike): TableClient {
  const settle = async (q: PromiseLike<{ data: Row[] | null; error: PostgrestError | null }>): Promise<Result<Row[]>> => {
    const { data, error } = await q;
    if (error) return fail('db.error', error.message, { sqlstate: error.code ?? null });
    return ok(data ?? []);
  };
  return {
    insert(table, rows) {
      if (rows.length === 0) return Promise.resolve(ok([]));
      return settle(client.from(table).insert(rows).select());
    },
    select(table, query) {
      let q = client.from(table).select(query.columns && query.columns.length > 0 ? query.columns.join(', ') : '*');
      for (const [column, value] of Object.entries(query.eq ?? {})) q = value === null ? q.is(column, null) : q.eq(column, value);
      if (query.in) q = q.in(query.in.column, query.in.values);
      if (query.gt) q = q.gt(query.gt.column, query.gt.value);
      if (query.lte) q = q.lte(query.lte.column, query.lte.value);
      for (const o of query.order ?? []) q = q.order(o.column, { ascending: o.ascending });
      if (query.limit !== undefined) q = q.limit(query.limit);
      return settle(q);
    },
  };
}
