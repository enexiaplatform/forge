/**
 * Execution records — a track record is evidence, not a judgment (decision 1 of 2026-10-01).
 *
 * For each owner (a person, role or unit) Forge can show what the record holds:
 * how many commitments were observed, how they ended, how their dates moved,
 * what they waited on more than once, what people said explains the
 * differences, which ways of working recurred, in what contexts, and on how
 * many cases. The purpose is organizational learning.
 *
 * There is no score, rating, rank, percentage, league table or sort by results
 * here, and `verify:boundaries` keeps it that way. Records are ordered by the
 * party's name. Small samples say so out loud.
 */

import { type Party, sameParty } from './primitives.ts';
import type { CommitmentView } from './derive.ts';
import { varianceOf } from './variance.ts';
import { type Resolution, resolutions } from './types.ts';

/** Below this many concluded commitments, nothing should be read into a record. */
export const SMALL_SAMPLE = 5;

export type ExecutionRecord = {
  readonly party: Party;
  readonly observed: number;
  readonly open: number;
  readonly concluded: number;
  readonly endings: Readonly<Record<Resolution, number>>;
  /** Days each concluded commitment ended against the date first promised — the facts, not an average of them. */
  readonly timing: {
    readonly againstOriginal: readonly { readonly commitmentId: string; readonly days: number }[];
    readonly onOrBefore: number;
    readonly after: number;
    readonly median: number | null;
    readonly range: readonly [number, number] | null;
  };
  readonly dateChanges: number;
  /** Dependencies (by what they wait on) that recurred across this party's commitments. */
  readonly recurringDependencies: readonly { readonly on: string; readonly count: number; readonly late: number }[];
  /** What people said explains the differences: explanations and the reasons given for moved dates. */
  readonly causesOfVariance: readonly { readonly statement: string; readonly author: string; readonly commitmentId: string; readonly kind: 'EXPLANATION' | 'REDATE_REASON' }[];
  /** Ways of working that recurred: lessons kept, and commitments kept on time with a system's record behind them. */
  readonly patterns: readonly { readonly statement: string; readonly commitmentIds: readonly string[] }[];
  readonly contexts: readonly { readonly origin: string; readonly count: number }[];
  readonly sample: { readonly concluded: number; readonly sufficient: boolean; readonly caveat: string };
};

export type RecordGrouping = 'owner' | 'principal';

export function executionRecords(views: readonly CommitmentView[], groupBy: RecordGrouping = 'owner'): ExecutionRecord[] {
  const parties: Party[] = [];
  for (const v of views) {
    const p = groupBy === 'owner' ? v.terms.owner : v.terms.principal;
    if (!parties.some((x) => sameParty(x, p))) parties.push(p);
  }
  return parties
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((party) => recordOf(party, views.filter((v) => sameParty(groupBy === 'owner' ? v.terms.owner : v.terms.principal, party))));
}

function recordOf(party: Party, mine: readonly CommitmentView[]): ExecutionRecord {
  const concludedViews = mine.filter((v) => v.phase === 'CLOSED' && v.resolution !== null);
  const endings = Object.fromEntries(resolutions.map((r) => [r, 0])) as Record<Resolution, number>;
  for (const v of concludedViews) if (v.resolution) endings[v.resolution.resolution] += 1;

  const againstOriginal = concludedViews
    .map((v) => ({ commitmentId: v.record.id, days: varianceOf(v).time.daysAgainstOriginal }))
    .filter((x): x is { commitmentId: string; days: number } => x.days !== null);
  const days = againstOriginal.map((x) => x.days).sort((a, b) => a - b);
  const median = days.length === 0 ? null : days.length % 2 === 1 ? days[(days.length - 1) / 2] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2;

  const deps = new Map<string, { count: number; late: number }>();
  for (const v of mine) {
    for (const d of v.dependencies) {
      const on = d.dependency.on.kind === 'EXTERNAL' ? d.dependency.on.label : d.dependency.on.kind === 'PARTY' ? d.dependency.on.party.label : 'another commitment';
      const cur = deps.get(on) ?? { count: 0, late: 0 };
      const late = d.dependency.neededBy !== null && (d.settled === null ? v.lens.asOf.slice(0, 10) > d.dependency.neededBy : d.settled.at.slice(0, 10) > d.dependency.neededBy);
      deps.set(on, { count: cur.count + 1, late: cur.late + (late ? 1 : 0) });
    }
  }

  const causes: ExecutionRecord['causesOfVariance'][number][] = [];
  for (const v of mine) {
    for (const l of v.learnings) if (l.learning.kind === 'EXPLANATION') causes.push({ statement: l.learning.statement, author: l.actor.label, commitmentId: v.record.id, kind: 'EXPLANATION' });
    for (const r of v.redates) if (r.reason) causes.push({ statement: r.reason, author: v.terms.owner.label, commitmentId: v.record.id, kind: 'REDATE_REASON' });
  }

  const patterns: { statement: string; commitmentIds: string[] }[] = [];
  for (const v of mine) {
    for (const l of v.learnings) {
      if (l.learning.kind !== 'LESSON') continue;
      const existing = patterns.find((p) => p.statement === l.learning.statement);
      if (existing) existing.commitmentIds.push(v.record.id);
      else patterns.push({ statement: l.learning.statement, commitmentIds: [v.record.id] });
    }
  }
  const keptOnRecord = concludedViews.filter((v) => {
    const t = varianceOf(v).time;
    return v.resolution?.resolution === 'FULFILLED' && (t.daysAgainstOriginal ?? 1) <= 0 && v.requirements.some((r) => r.basis === 'SYSTEM');
  });
  if (keptOnRecord.length > 0) {
    patterns.push({ statement: 'Kept on the date first promised, with a system’s record as proof.', commitmentIds: keptOnRecord.map((v) => v.record.id) });
  }

  const contexts = new Map<string, number>();
  for (const v of mine) contexts.set(v.record.origin.label, (contexts.get(v.record.origin.label) ?? 0) + 1);

  const sufficient = concludedViews.length >= SMALL_SAMPLE;
  return {
    party,
    observed: mine.length,
    open: mine.filter((v) => v.phase === 'ACTIVE' || v.phase === 'PROPOSED').length,
    concluded: concludedViews.length,
    endings,
    timing: {
      againstOriginal,
      onOrBefore: days.filter((d) => d <= 0).length,
      after: days.filter((d) => d > 0).length,
      median,
      range: days.length === 0 ? null : [days[0], days[days.length - 1]],
    },
    dateChanges: mine.reduce((n, v) => n + v.redates.length, 0),
    recurringDependencies: [...deps.entries()].filter(([, x]) => x.count >= 2).map(([on, x]) => ({ on, count: x.count, late: x.late })),
    causesOfVariance: causes,
    patterns,
    contexts: [...contexts.entries()].map(([origin, count]) => ({ origin, count })),
    sample: {
      concluded: concludedViews.length,
      sufficient,
      caveat: sufficient
        ? `${concludedViews.length} concluded commitments. A record describes what happened in these contexts; it does not grade the people involved.`
        : `${concludedViews.length} concluded commitment${concludedViews.length === 1 ? '' : 's'} — too few to read a pattern into. A record is evidence, not a judgment.`,
    },
  };
}
