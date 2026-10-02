/**
 * Memoire, through its published contracts (loop 2; decision 3 of 2026-10-01).
 *
 * Forge reads Memoire's customer promises through Commercial API v1 — the port
 * below is the read half of `@memoire/commercial-sdk`'s client, structurally,
 * so the real SDK client plugs straight in and the fabric imports no SDK. Reads
 * run as the promise's owner, under Memoire's own RLS: there is no service-role
 * bypass, by Memoire's design and by Forge's.
 *
 * A promise's lifecycle becomes Forge observations: a completed promise can be
 * evidence, a cancelled one a change in the world a commitment rests on.
 *
 * Memoire owns the commercial promise; Forge owns the accountable organizational
 * commitment. A promise is NOT automatically a commitment. Only a promise the
 * enterprise owes (`self`: we owe the customer; `internal`: a colleague owes),
 * with a named person and a date, is suggested as a candidate — and a person
 * confirms it, which links the commitment to the promise rather than copying it.
 * Promises the customer owes stay commercial context and evidence.
 */

import type { Party, SuggestCandidateInput } from '@forge/kernel';
import type { ExecutionSurface, Observation } from './surfaces.ts';
import { memoireAccountRef, memoireOpportunityRef } from './memoire.ts';

/** Commercial API v1 commitment DTO — Memoire's public promise, in Memoire's own field names. */
export type MemoirePromise = {
  readonly id: string;
  readonly accountId: string | null;
  readonly opportunityId: string | null;
  /** 'self' (we owe the customer) · 'customer' (the customer owes us) · 'internal' (a colleague owes). */
  readonly party: string;
  readonly responsiblePerson: string;
  readonly promise: string;
  readonly dueDate: string | null;
  /** 'open' · 'completed' · 'cancelled' */
  readonly status: string;
  readonly updatedAt: string;
};

export type MemoirePage<T> = { readonly items: readonly T[]; readonly nextCursor: string | null };

/** The read half of `createMemoireClient(...)` from `@memoire/commercial-sdk`. */
export interface MemoireCommercialApi {
  listCommitments(input?: { limit?: number; after?: string }): Promise<MemoirePage<MemoirePromise>>;
}

export const memoireCommitmentRef = (id: string): string => `memoire:commitment:${id}`;

/** Every promise the reader owns, following every cursor — API v1 pages are current state, not history. */
export async function listAllPromises(api: MemoireCommercialApi, pageSize = 100): Promise<MemoirePromise[]> {
  const out: MemoirePromise[] = [];
  let after: string | undefined;
  for (let guard = 0; guard < 1000; guard += 1) {
    const page = await api.listCommitments({ limit: pageSize, ...(after ? { after } : {}) });
    out.push(...page.items);
    if (!page.nextCursor) break;
    after = page.nextCursor;
  }
  return out;
}

const STATUS_EVENTS: Readonly<Record<string, string>> = { open: 'commitment.open', completed: 'commitment.completed', cancelled: 'commitment.cancelled' };

/** A promise, as Memoire currently holds it, as one observation of it. */
export function promiseObservation(p: MemoirePromise): Observation {
  const ref = memoireCommitmentRef(p.id);
  return {
    id: `${ref}@${p.updatedAt}`,
    system: 'memoire',
    eventType: STATUS_EVENTS[p.status] ?? `commitment.${p.status}`,
    objectRef: ref,
    entityRef: ref,
    occurredAt: new Date(p.updatedAt).toISOString(),
    payload: {
      party: p.party,
      status: p.status,
      dueDate: p.dueDate,
      responsiblePerson: p.responsiblePerson,
      accountId: p.accountId,
      opportunityId: p.opportunityId,
    },
    summary: `Memoire promise (${p.party === 'customer' ? 'the customer owes' : p.party === 'internal' ? 'a colleague owes' : 'we owe'}): “${p.promise}” — ${p.responsiblePerson}, ${p.status}${p.dueDate ? `, due ${p.dueDate}` : ''}`,
    url: null,
  };
}

/** Memoire's promises as an execution surface: every promise changed after the checkpoint, as it now stands. */
export function createMemoirePromiseSurface(api: MemoireCommercialApi): ExecutionSurface {
  return {
    system: 'memoire',
    label: 'Memoire promises',
    describes: 'Customer promises through Commercial API v1, read as their owner. Completion is evidence; cancellation changes the world a commitment rests on.',
    async pull(since, until) {
      const promises = await listAllPromises(api);
      return promises
        .filter((p) => (since === null || new Date(p.updatedAt).toISOString() > since) && new Date(p.updatedAt).toISOString() <= until)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
        .map(promiseObservation);
    },
  };
}

/**
 * DEMO and tests: Commercial API v1 served from timed versions of promises, each promise as Memoire held it at
 * `now()` — current state, ordered by id, with Memoire's cursor rule (the last id of the page). The integration
 * suite runs Memoire's own handler instead; this exists so the demo needs no Memoire.
 */
export function createFixtureCommercialApi(versions: readonly MemoirePromise[], now: () => string): MemoireCommercialApi {
  const ordered = [...versions].sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
  return {
    async listCommitments(input = {}) {
      const at = now();
      const current = new Map<string, MemoirePromise>();
      for (const v of ordered) if (v.updatedAt <= at) current.set(v.id, v);
      const all = [...current.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
      const after = input.after;
      const start = after === undefined ? 0 : all.filter((p) => p.id <= after).length;
      const limit = input.limit ?? 50;
      const items = all.slice(start, start + limit);
      return { items, nextCursor: start + limit < all.length && items.length > 0 ? items[items.length - 1].id : null };
    },
  };
}

/** Who a responsible-person text names in shared enterprise reality — a directory the caller supplies. */
export type PartyDirectory = readonly { readonly matches: string; readonly party: Party }[];

const resolveParty = (text: string, directory: PartyDirectory): Party | null =>
  directory.find((d) => text.toLowerCase().includes(d.matches.toLowerCase()))?.party ?? null;

export const PROMOTION_RULES = 'forge-memoire-promotion@1';

/**
 * Promises that look like enterprise obligations, as candidates. The rule, stated: the enterprise owes it
 * (`self` or `internal`), it is open, a person is named, and it has a date. Anything else stays context.
 */
export function promotionCandidates(promises: readonly MemoirePromise[], directory: PartyDirectory = []): SuggestCandidateInput[] {
  return promises
    .filter((p) => (p.party === 'self' || p.party === 'internal') && p.status === 'open' && p.responsiblePerson.trim() !== '' && p.dueDate !== null)
    .map((p) => {
      const ref = memoireCommitmentRef(p.id);
      const owner = resolveParty(p.responsiblePerson, directory);
      return {
        source: {
          kind: 'MEMOIRE_PROMISE',
          system: 'memoire',
          ref,
          label: `Memoire promise — ${p.promise}`,
          quote: p.promise,
          locator: null,
          observedAt: new Date(p.updatedAt).toISOString(),
          entityRef: p.opportunityId ? memoireOpportunityRef(p.opportunityId) : p.accountId ? memoireAccountRef(p.accountId) : ref,
        },
        utteranceClass: 'COMMITMENT',
        proposal: {
          statement: p.promise,
          intendedOutcome: null,
          owner,
          ownerText: p.responsiblePerson,
          principal: null,
          dueBy: p.dueDate,
          dueText: p.dueDate,
          dependencies: [],
          entities: [
            ...(p.opportunityId ? [{ text: 'opportunity', entityRef: memoireOpportunityRef(p.opportunityId) }] : []),
            ...(p.accountId ? [{ text: 'account', entityRef: memoireAccountRef(p.accountId) }] : []),
          ],
          // Memoire recording the promise kept is evidence the commitment can watch for; it never replaces stronger proof.
          evidence: [
            {
              key: 'memoire-promise-kept',
              level: 'OUTCOME',
              description: 'Memoire records the customer promise kept',
              required: false,
              matcher: { system: 'memoire', eventType: 'commitment.completed', objectRef: ref, where: {} },
            },
          ],
        },
        // It is certain that the promise exists; that it is an enterprise obligation is the inference.
        confidence: p.party === 'self' ? 0.75 : 0.6,
        extractor: { name: PROMOTION_RULES, model: null },
        dedupeKey: ref,
      };
    });
}
