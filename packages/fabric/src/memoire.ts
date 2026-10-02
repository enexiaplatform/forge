/**
 * Memoire, read — commercial reality a commitment can inherit.
 *
 * Forge never copies a Memoire record into a table of its own and never writes
 * to Memoire. It reads an account or an opportunity as the signed-in user, and
 * keeps a reference plus the fields that person saw, as context on the
 * commitment — the reference-plus-snapshot rule Helm keeps for the same data.
 */

import { type ContextField, humanDate, type Result, type Scope } from '@forge/kernel';

export type MemoireOpportunity = {
  readonly id: string;
  readonly name: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly value: string;
  readonly currency: string;
  readonly probability: string;
  readonly stage: string;
  readonly expectedClose: string | null;
};

export interface MemoireContextReader {
  opportunity(scope: Scope, id: string): Promise<Result<MemoireOpportunity | null>>;
}

export const memoireOpportunityRef = (id: string): string => `memoire:opportunity:${id}`;
export const memoireAccountRef = (id: string): string => `memoire:account:${id}`;

export function createFixtureMemoireReader(opportunities: readonly MemoireOpportunity[]): MemoireContextReader {
  return {
    async opportunity(_scope, id) {
      return { ok: true, value: opportunities.find((o) => o.id === id) ?? null };
    },
  };
}

/** What a commitment inherits from an opportunity: the account and the deal, as facts from Memoire. */
export function opportunityContext(o: MemoireOpportunity): ContextField[] {
  const source = { system: 'memoire', ref: memoireOpportunityRef(o.id), url: null };
  return [
    {
      key: 'context.account',
      label: 'Account',
      value: o.accountName,
      capture: 'INHERITED',
      epistemic: 'FACT',
      source: { system: 'memoire', ref: memoireAccountRef(o.accountId), url: null },
      entityRef: memoireAccountRef(o.accountId),
    },
    {
      key: 'context.opportunity',
      label: 'Opportunity',
      value: `${o.name} · ${formatAmount(o.value)} ${o.currency} · ${o.probability}% · ${o.stage}${o.expectedClose ? ` · closes ${humanDate(o.expectedClose)}` : ''}`,
      capture: 'INHERITED',
      epistemic: 'FACT',
      source,
      entityRef: memoireOpportunityRef(o.id),
    },
  ];
}

function formatAmount(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  return v;
}
