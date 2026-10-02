/**
 * Forge's open door for execution surfaces: one signed forge.observation.v1 batch in, one status out (ADR-0027) — for
 * whatever hosts it (an edge function, a Node server, the test suite standing in for a tracker or an ERP).
 *
 * Order matters, as for Memoire's webhooks: find the surface's secret by the system it names, verify the signature over
 * the raw body, then parse; only then keep what is new in the observation ledger and ingest it as that system's
 * connector. A surface reports only its own records; a batch is accepted whole or not at all.
 *
 * Statuses tell the sender what to do: 401 — unknown surface, bad signature or stale timestamp, do not retry this body;
 * 400 — the batch is malformed, and the body says what to fix; 403 — a system this surface may not speak for;
 * 413 — too many in one batch; 200 — received (fresh and already-held counted); 503 — Forge could not record it, retry.
 */

import type { ForgeRuntime } from '@forge/kernel';
import { ingestObservations, type ObservationLedger, parseObservationBatch, verifyHmacV1 } from '@forge/fabric';

export type ObservationHostDeps = {
  /** The shared secret a surface signs with, by the system it names — from the host's environment, never the request. */
  readonly secretFor: (system: string) => string | null;
  readonly ledger: ObservationLedger;
  /** Forge as the surface's connector: it may only report that system's records (ADR-0005). */
  readonly runtime: ForgeRuntime;
  readonly orgId: string;
  readonly nowSeconds: () => number;
};

export type ObservationHostResponse = { readonly status: 200 | 400 | 401 | 403 | 413 | 503; readonly body: Readonly<Record<string, unknown>> };

const refuse = (status: ObservationHostResponse['status'], code: string, message: string, extra: Record<string, unknown> = {}): ObservationHostResponse => ({
  status,
  body: { ok: false, error: { code, message, ...extra } },
});

export async function handleObservationDelivery(
  deps: ObservationHostDeps,
  request: { readonly headers: Readonly<Record<string, string | undefined>>; readonly rawBody: string },
): Promise<ObservationHostResponse> {
  const h = (name: string) => request.headers[name] ?? request.headers[name.toLowerCase()];
  const surface = h('Forge-Surface') ?? '';
  const secret = surface ? deps.secretFor(surface) : null;
  if (!secret) return refuse(401, 'observation.unknown_surface', 'No surface by that name is registered with this Forge.');
  const now = deps.nowSeconds();
  const verified = await verifyHmacV1({ secret, timestamp: h('Forge-Timestamp') ?? '', body: request.rawBody, signature: h('Forge-Signature') ?? '', nowSeconds: now });
  if (!verified) return refuse(401, 'observation.signature_invalid', 'The signature does not verify, or the timestamp is outside five minutes.');

  const batch = parseObservationBatch(request.rawBody, surface, now);
  if (!batch.ok) {
    const status = batch.error.code === 'observation.too_many' ? 413 : batch.error.code === 'observation.not_your_system' || batch.error.code === 'observation.reserved_system' ? 403 : 400;
    return refuse(status, batch.error.code, batch.error.message, batch.error.details ?? {});
  }

  const scope = { orgId: deps.orgId, actor: { kind: 'SYSTEM' as const, id: `${surface}-connector`, label: `${surface} connector` }, role: 'member' as const, actsAs: [] };
  const kept = await deps.ledger.record(scope, batch.value.observations);
  if (!kept.ok) return refuse(503, kept.error.code, kept.error.message);
  // The whole batch, not only what is new: ingestion is idempotent per observation and effect, so a retry after a 503
  // finishes what an interrupted delivery started instead of skipping it as already held.
  const ingested = await ingestObservations(deps.runtime, deps.orgId, batch.value.observations);
  if (!ingested.ok) return refuse(503, ingested.error.code, ingested.error.message);
  return {
    status: 200,
    body: {
      ok: true,
      received: kept.value.fresh.length,
      alreadyHeld: kept.value.duplicates,
      effects: ingested.value.effects.map((e) => ({ observationId: e.observationId, commitmentId: e.commitmentId, kind: e.kind })),
      unmatched: ingested.value.unmatched.length,
    },
  };
}
