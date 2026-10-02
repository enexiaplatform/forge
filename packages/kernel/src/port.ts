/**
 * The persistence port. Two implementations answer it and pass one conformance
 * suite (conformance.ts): an in-memory reference the demo and tests run on, and
 * a Postgres adapter (postgres.ts) — the only I/O boundary in the kernel.
 *
 * The store is append-only. A commitment record is written once; events are
 * appended in batches that land whole or not at all. The store — not the
 * caller — stamps `recordedAt` and assigns each event's per-commitment `seq`.
 */

import type { Result, Scope } from './primitives.ts';
import type { CommitmentEvent, CommitmentRecord, NewCommitmentRecord, NewEvent } from './types.ts';

export type CommitmentFilter = {
  readonly parentId?: string | null;
  readonly originRef?: string;
};

export interface CommitmentStore {
  insertCommitment(scope: Scope, record: NewCommitmentRecord): Promise<Result<CommitmentRecord>>;
  /** Atomic: every event lands, or none does. Events may belong to different commitments of one org. */
  appendEvents(scope: Scope, events: readonly NewEvent[]): Promise<Result<CommitmentEvent[]>>;
  getCommitment(scope: Scope, id: string): Promise<Result<CommitmentRecord | null>>;
  listCommitments(scope: Scope, filter?: CommitmentFilter): Promise<Result<CommitmentRecord[]>>;
  /** Events of the given commitments, in recorded order. */
  eventsFor(scope: Scope, commitmentIds: readonly string[]): Promise<Result<CommitmentEvent[]>>;
  /** The event already recorded under an idempotency key, if any. */
  findByIdempotencyKey(scope: Scope, key: string): Promise<Result<CommitmentEvent | null>>;
}
