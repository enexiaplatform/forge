/**
 * Memoire's change notifications, received (Memoire's commercial-webhooks-v1).
 *
 * Memoire announces that a canonical source revision was recorded — and
 * deliberately nothing more: no commercial truth travels in a notification.
 * Forge verifies the signature before parsing (HMAC-SHA256 over
 * `<timestamp>.<raw body>`, `v1=<hex>`, a five-minute window, constant-time
 * comparison), deduplicates by notification id, and then reads what changed
 * through Commercial API v1, as the owner. Arrival order is not trusted;
 * revisions are.
 *
 * WebCrypto only, so the same code verifies in Node, an edge function or a
 * browser test.
 */

import { fail, ok, type Result } from '@forge/kernel';
import { type MemoireCommercialApi, listAllPromises, memoireCommitmentRef, promiseObservation } from './memoireCommercial.ts';
import type { Observation } from './surfaces.ts';

/**
 * The subject kinds Memoire announces today. The receiver accepts any well-formed kind — Memoire adds kinds (it
 * added 'shared-workspace' with commercial workspaces) and a receiver that refused one would only make Memoire
 * retry — and interprets only what Commercial API v1 can read.
 */
export const MEMOIRE_SUBJECT_KINDS = [
  'shared-workspace',
  'opportunity',
  'condition',
  'evidence',
  'requirement',
  'dependency',
  'timing',
  'commitment',
  'money-gate',
  'policy',
  'incident',
  'contract-obligation',
  'unknown',
] as const;

export type MemoireNotification = {
  readonly version: 1;
  /** memoire.change.v1:<revision UUID> */
  readonly id: string;
  readonly type: 'commercial.state.changed';
  readonly recordedAt: string;
  readonly subject: { readonly kind: (typeof MEMOIRE_SUBJECT_KINDS)[number] | (string & {}); readonly id: string; readonly revision: number };
  readonly operation: 'create' | 'update' | 'delete';
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse and check the v1 envelope exactly; anything else is refused, never guessed at. */
export function parseMemoireNotification(rawBody: string): Result<MemoireNotification> {
  let v: unknown;
  try {
    v = JSON.parse(rawBody);
  } catch {
    return fail('memoire.notification_invalid', 'The notification is not JSON.');
  }
  if (!isObject(v) || v.version !== 1 || v.type !== 'commercial.state.changed') return fail('memoire.notification_unsupported', 'Not a commercial.state.changed v1 notification.');
  if (typeof v.id !== 'string' || !/^memoire\.change\.v1:[0-9a-f-]{36}$/i.test(v.id)) return fail('memoire.notification_invalid', 'The notification id is malformed.');
  if (typeof v.recordedAt !== 'string' || Number.isNaN(Date.parse(v.recordedAt))) return fail('memoire.notification_invalid', 'recordedAt is not a time.');
  const s = v.subject;
  if (!isObject(s) || typeof s.id !== 'string' || typeof s.kind !== 'string' || !/^[a-z][a-z-]{0,63}$/.test(s.kind) || !Number.isInteger(s.revision)) {
    return fail('memoire.notification_invalid', 'The subject is malformed.');
  }
  if (v.operation !== 'create' && v.operation !== 'update' && v.operation !== 'delete') return fail('memoire.notification_invalid', 'Unknown operation.');
  return ok(v as unknown as MemoireNotification);
}

const hexToBytes = (hex: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/**
 * Verify Memoire's signature: `Memoire-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`, with
 * `Memoire-Timestamp` (Unix seconds) within five minutes of now. WebCrypto's HMAC verify compares in constant time.
 */
export async function verifyHmacV1(input: { secret: string; timestamp: string; body: string; signature: string; nowSeconds: number }): Promise<boolean> {
  const { secret, timestamp, body, signature, nowSeconds } = input;
  if (secret.length < 32 || !/^\d{10}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 300 || !/^v1=[a-f0-9]{64}$/.test(signature)) return false;
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return globalThis.crypto.subtle.verify('HMAC', key, hexToBytes(signature.slice(3)), enc.encode(`${timestamp}.${body}`));
}

/** Memoire's webhooks v1 use the shared v1 signature (`verifyHmacV1`), as forge.observation.v1 does. */
export const verifyMemoireSignature = verifyHmacV1;

/** Where notifications are deduplicated. Durable in production — a receiver that forgets will re-read, safely. */
export interface NotificationInbox {
  /** True the first time an id is seen. */
  admit(id: string): Promise<boolean>;
}

export function createInMemoryInbox(): NotificationInbox {
  const seen = new Set<string>();
  return {
    async admit(id) {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    },
  };
}

export type ReceivedNotification = { readonly notification: MemoireNotification; readonly duplicate: boolean };

/** Verify, then parse, then deduplicate — in that order, as Memoire's receiver contract requires. */
export async function receiveMemoireNotification(input: {
  headers: Readonly<Record<string, string | undefined>>;
  rawBody: string;
  secret: string;
  nowSeconds: number;
  inbox: NotificationInbox;
}): Promise<Result<ReceivedNotification>> {
  const h = (name: string) => input.headers[name] ?? input.headers[name.toLowerCase()];
  const verified = await verifyMemoireSignature({
    secret: input.secret,
    timestamp: h('Memoire-Timestamp') ?? '',
    body: input.rawBody,
    signature: h('Memoire-Signature') ?? '',
    nowSeconds: input.nowSeconds,
  });
  if (!verified) return fail('memoire.signature_invalid', 'The signature does not verify, or the timestamp is outside five minutes.');
  const parsed = parseMemoireNotification(input.rawBody);
  if (!parsed.ok) return parsed;
  if (h('Memoire-Notification-Id') !== parsed.value.id) return fail('memoire.notification_invalid', 'The notification id header does not match the body.');
  const fresh = await input.inbox.admit(parsed.value.id);
  return ok({ notification: parsed.value, duplicate: !fresh });
}

/**
 * Read what a notification announced, through Commercial API v1. Only promises are readable there today; any
 * other subject is acknowledged and left uninterpreted, and the result says so rather than guessing.
 */
export async function interpretNotification(api: MemoireCommercialApi, n: MemoireNotification): Promise<{ observations: Observation[]; uninterpreted: string | null }> {
  if (n.subject.kind !== 'commitment') {
    return { observations: [], uninterpreted: `A ${n.subject.kind} changed; Commercial API v1 does not expose ${n.subject.kind}s, so Forge records the notice and reads nothing.` };
  }
  if (n.operation === 'delete') {
    const ref = memoireCommitmentRef(n.subject.id);
    return {
      observations: [
        {
          id: `${n.id}`,
          system: 'memoire',
          eventType: 'commitment.cancelled',
          objectRef: ref,
          entityRef: ref,
          occurredAt: new Date(n.recordedAt).toISOString(),
          payload: { status: 'deleted', revision: n.subject.revision },
          summary: 'The Memoire promise was deleted.',
          url: null,
        },
      ],
      uninterpreted: null,
    };
  }
  const promise = (await listAllPromises(api)).find((p) => p.id === n.subject.id);
  if (!promise) return { observations: [], uninterpreted: 'The promise is not visible to this reader through Commercial API v1.' };
  return { observations: [promiseObservation(promise)], uninterpreted: null };
}
