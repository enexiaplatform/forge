/**
 * Forge's receiving end of Memoire's commercial webhooks v1 — one request in, one status out, for whatever hosts it
 * (an edge function, a Node server, the integration suite standing in for Memoire's worker).
 *
 * The order is Memoire's receiver contract: verify the signature over the raw body, then parse, then deduplicate by
 * notification id; only then read what changed, through Commercial API v1, as the promise's owner. Nothing commercial
 * travels in the notification itself. What was read is ingested by the connector, idempotently, so a receiver that
 * forgets what it has seen re-reads safely.
 *
 * Statuses tell Memoire's worker what to do: 401 — the signature or the timestamp failed, do not retry this body;
 * 400 — the envelope is malformed; 200 — received (or already received); 503 — Forge could not record it now, retry.
 */

import type { ForgeRuntime } from '@forge/kernel';
import {
  ingestObservations,
  interpretNotification,
  type MemoireCommercialApi,
  type NotificationInbox,
  receiveMemoireNotification,
} from '@forge/fabric';

export type MemoireWebhookDeps = {
  /** The shared secret Memoire signs with — from the host's environment, never from the request. */
  readonly secret: string;
  readonly inbox: NotificationInbox;
  /** Commercial API v1, as the promise's owner. */
  readonly api: MemoireCommercialApi;
  /** Forge as the Memoire connector: it may only report Memoire's records (ADR-0005). */
  readonly runtime: ForgeRuntime;
  readonly orgId: string;
  readonly nowSeconds: () => number;
};

export type MemoireWebhookResponse = { readonly status: 200 | 400 | 401 | 503; readonly body: Readonly<Record<string, unknown>> };

export async function handleMemoireWebhook(
  deps: MemoireWebhookDeps,
  request: { readonly headers: Readonly<Record<string, string | undefined>>; readonly rawBody: string },
): Promise<MemoireWebhookResponse> {
  const received = await receiveMemoireNotification({ headers: request.headers, rawBody: request.rawBody, secret: deps.secret, nowSeconds: deps.nowSeconds(), inbox: deps.inbox });
  if (!received.ok) {
    return { status: received.error.code === 'memoire.signature_invalid' ? 401 : 400, body: { ok: false, error: { code: received.error.code, message: received.error.message } } };
  }
  if (received.value.duplicate) return { status: 200, body: { ok: true, duplicate: true } };
  const read = await interpretNotification(deps.api, received.value.notification);
  const ingested = await ingestObservations(deps.runtime, deps.orgId, read.observations);
  if (!ingested.ok) return { status: 503, body: { ok: false, error: { code: ingested.error.code, message: ingested.error.message } } };
  return { status: 200, body: { ok: true, duplicate: false, observations: read.observations.length, effects: ingested.value.effects.length, uninterpreted: read.uninterpreted } };
}
