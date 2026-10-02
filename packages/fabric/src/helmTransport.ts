/**
 * Delivering verified outcomes to Helm (ADR-0018's transport; development plan 2.2).
 *
 * A published outcome reaches Helm through Helm's governed intake — its own host, run as the person who sends it,
 * under Helm's rules. Forge writes nothing of Helm's: it composes the submission (`toHelmExecutionOutcome`), sends it
 * with the sender's session, and reads Helm's receipts back by reference to know what has arrived.
 *
 * Nothing about delivery is stored in Forge. What is pending is DERIVED: a commitment's latest publication whose
 * fingerprint Helm holds no receipt for. Sending is idempotent on Helm's side (one receipt per publication
 * fingerprint, a duplicate answered with the receipt it already holds), so a sender may drain its outbox again after
 * a dropped connection and lose or double nothing. A refusal is returned for the person to read — Helm's words, with
 * Helm's reasons — never retried as if it were a failure to connect.
 */

import { ok, type CommitmentView, type OutcomePublication, type Result, type Scope } from '@forge/kernel';
import type { TableClient } from '@forge/kernel/postgres';
import { type HelmExecutionOutcomeSubmission, publicationAuthority, toHelmExecutionOutcome } from './helmMemory.ts';
import type { Departure } from './fidelity.ts';

/** Helm's intake host, as its edge function answers: the sender's session carries who they are. */
export type HelmIntakeSender = (body: { readonly orgId: string; readonly submission: HelmExecutionOutcomeSubmission }) => Promise<{ readonly status: number; readonly body: Readonly<Record<string, unknown>> }>;

export type PendingDelivery = {
  readonly commitmentId: string;
  readonly publication: OutcomePublication;
  readonly submission: HelmExecutionOutcomeSubmission;
};

export type Delivery =
  | { readonly commitmentId: string; readonly fingerprint: string; readonly outcome: 'RECEIVED'; readonly receiptId: string; readonly duplicate: boolean }
  | { readonly commitmentId: string; readonly fingerprint: string; readonly outcome: 'REFUSED'; readonly code: string; readonly statement: string }
  | { readonly commitmentId: string; readonly fingerprint: string; readonly outcome: 'NOT_SENT'; readonly statement: string };

/** The publication fingerprints Helm holds receipts for, as this reader may see them (Helm's RLS decides). */
export async function helmReceivedFingerprints(db: TableClient, scope: Scope): Promise<Result<Set<string>>> {
  const r = await db.select('helm_execution_outcomes', { eq: { org_id: scope.orgId }, columns: ['publication_fingerprint'], order: [{ column: 'publication_fingerprint', ascending: true }] });
  return r.ok ? ok(new Set(r.value.map((row) => String(row.publication_fingerprint)))) : r;
}

/** What has been published for a Helm decision and not yet received by Helm — derived, never stored. */
export function pendingDeliveries(
  views: readonly CommitmentView[],
  received: ReadonlySet<string>,
  orgId: string,
  departuresOf: (v: CommitmentView) => readonly Departure[] = () => [],
): PendingDelivery[] {
  const out: PendingDelivery[] = [];
  for (const v of views) {
    const last = v.publications[v.publications.length - 1];
    if (!last || received.has(last.publication.fingerprint)) continue;
    const submission = toHelmExecutionOutcome(last.publication, { orgId, publishedByLabel: last.actor.label, authority: publicationAuthority(v), departures: departuresOf(v) });
    if (submission) out.push({ commitmentId: v.record.id, publication: last.publication, submission });
  }
  return out;
}

/**
 * Send what is pending, once each, in the sender's own session. A connection that fails stops the drain and says so;
 * what was received stays received, and the rest is still pending next time.
 */
export async function deliverOutcomes(input: {
  readonly scope: Scope;
  readonly views: readonly CommitmentView[];
  readonly received: ReadonlySet<string>;
  readonly send: HelmIntakeSender;
  /** Where the decision a publication answers to departed in execution (`decisionFidelity`); none when omitted. */
  readonly departuresOf?: (v: CommitmentView) => readonly Departure[];
}): Promise<Result<Delivery[]>> {
  // A report, always: what arrived, what Helm refused and why, what is still pending.
  const out: Delivery[] = [];
  const pending = pendingDeliveries(input.views, input.received, input.scope.orgId, input.departuresOf);
  for (const [i, p] of pending.entries()) {
    const fingerprint = p.publication.fingerprint;
    let res: Awaited<ReturnType<HelmIntakeSender>>;
    try {
      res = await input.send({ orgId: input.scope.orgId, submission: p.submission });
    } catch (e) {
      const why = `Helm’s intake could not be reached (${e instanceof Error ? e.message : String(e)}); it is still pending.`;
      for (const q of pending.slice(i)) out.push({ commitmentId: q.commitmentId, fingerprint: q.publication.fingerprint, outcome: 'NOT_SENT', statement: why });
      return ok(out);
    }
    const body = res.body as { ok?: boolean; receipt?: { id: string }; duplicate?: boolean; error?: { code: string; message: string } };
    out.push(
      res.status === 200 && body.ok && body.receipt
        ? { commitmentId: p.commitmentId, fingerprint, outcome: 'RECEIVED', receiptId: body.receipt.id, duplicate: body.duplicate === true }
        : { commitmentId: p.commitmentId, fingerprint, outcome: 'REFUSED', code: body.error?.code ?? `helm.http_${res.status}`, statement: body.error?.message ?? `Helm’s intake answered ${res.status}.` },
    );
  }
  return ok(out);
}
