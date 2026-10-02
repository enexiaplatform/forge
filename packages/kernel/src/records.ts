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

import { daysBetween, type Party, sameParty } from './primitives.ts';
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

// ------------------------------------------------------------- assumptions

/**
 * Assumptions, as they turned out (§15 "Which assumptions repeatedly prove wrong?"; ADR-0026). Each assumption a
 * decision rested on, across every decision whose execution Forge holds, with what people said became of it — the
 * cases, their reasons and their counts, never a rate. Read from the root of each tree, so a decision counts once.
 * Ordered by the assumption's words; a handful of cases says it is a handful.
 */
export type AssumptionRecord = {
  readonly statement: string;
  readonly held: number;
  readonly broke: number;
  readonly unexamined: number;
  readonly cases: readonly {
    readonly commitmentId: string;
    readonly decision: string;
    readonly assessment: 'HELD' | 'BROKE' | null;
    readonly by: string | null;
    readonly reason: string | null;
    readonly at: string | null;
  }[];
  readonly caveat: string | null;
};

const sameWords = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();

export function assumptionRecords(views: readonly CommitmentView[]): AssumptionRecord[] {
  const by = new Map<string, { statement: string; cases: AssumptionRecord['cases'][number][] }>();
  for (const v of views) {
    if (v.record.parentId !== null) continue;
    for (const a of v.assumptions) {
      const k = sameWords(a.statement);
      const entry = by.get(k) ?? { statement: a.statement, cases: [] };
      entry.cases.push({
        commitmentId: v.record.id,
        decision: v.record.origin.label,
        assessment: a.assessed?.assessment ?? null,
        by: a.assessed?.actor.label ?? null,
        reason: a.assessed?.reason ?? null,
        at: a.assessed?.at ?? null,
      });
      by.set(k, entry);
    }
  }
  return [...by.values()]
    .sort((a, b) => a.statement.localeCompare(b.statement))
    .map(({ statement, cases }) => {
      const examined = cases.filter((c) => c.assessment !== null).length;
      return {
        statement,
        held: cases.filter((c) => c.assessment === 'HELD').length,
        broke: cases.filter((c) => c.assessment === 'BROKE').length,
        unexamined: cases.length - examined,
        cases,
        caveat: examined < SMALL_SAMPLE ? `${examined === 0 ? 'Never examined' : examined === 1 ? 'Examined once' : `Examined ${examined} times`} — too few to read a pattern into.` : null,
      };
    });
}

// ------------------------------------------------------------- dependencies

/**
 * What work waited on (§15 "Which dependencies create repeated delays?"; ADR-0029). Each thing commitments waited on —
 * an outside party or record, a person, or another owner's commitments — with how many times it was waited on, how
 * many times it came after the date it was needed, and every case: who waited, needed by when, settled when, and
 * whether the waiting commitment's own date moved after. Counts and cases, never a rate; ordered by name.
 */
export type DependencyRecord = {
  readonly on: string;
  readonly kind: 'EXTERNAL' | 'PARTY' | 'COMMITMENT';
  readonly waitedOn: number;
  readonly late: number;
  readonly stillWaiting: number;
  readonly cases: readonly {
    readonly commitmentId: string;
    readonly commitment: string;
    readonly owner: string;
    readonly description: string;
    readonly neededBy: string | null;
    readonly settledAt: string | null;
    /** Days after the date it was needed — settled late, or still waiting past it; null when not late or no date. */
    readonly daysLate: number | null;
    /** Times the waiting commitment's own date moved after the dependency was needed. */
    readonly datesMovedAfter: number;
  }[];
  readonly caveat: string | null;
};

export function dependencyRecords(views: readonly CommitmentView[]): DependencyRecord[] {
  const byId = new Map(views.map((v) => [v.record.id, v]));
  const groups = new Map<string, { kind: DependencyRecord['kind']; cases: DependencyRecord['cases'][number][] }>();
  for (const v of views) {
    const today = v.lens.asOf.slice(0, 10);
    for (const d of v.dependencies) {
      const on = d.dependency.on;
      const name =
        on.kind === 'EXTERNAL'
          ? `${on.label} (${on.source.system})`
          : on.kind === 'PARTY'
            ? on.party.label
            : `${byId.get(on.commitmentId)?.terms.owner.label ?? 'Another owner'} — their commitments`;
      const neededBy = d.dependency.neededBy;
      // A dependency on another commitment settles itself when that commitment is delivered.
      const upstream = on.kind === 'COMMITMENT' ? byId.get(on.commitmentId) : undefined;
      const delivered = upstream?.resolution && ['FULFILLED', 'PARTIALLY_FULFILLED'].includes(upstream.resolution.resolution) ? (upstream.outcome?.outcome.achievedOn ?? upstream.resolution.at) : null;
      const settledAt = d.settled?.at ?? delivered;
      const settledOn = settledAt ? settledAt.slice(0, 10) : null;
      const until = settledOn ?? (v.phase === 'CLOSED' ? null : today);
      const daysLate = neededBy !== null && until !== null && until > neededBy ? daysBetween(neededBy, until) : null;
      const g = groups.get(name) ?? { kind: on.kind, cases: [] };
      g.cases.push({
        commitmentId: v.record.id,
        commitment: v.terms.statement,
        owner: v.terms.owner.label,
        description: d.dependency.description,
        neededBy,
        settledAt,
        daysLate,
        datesMovedAfter: neededBy === null ? 0 : v.redates.filter((r) => r.at.slice(0, 10) >= neededBy).length,
      });
      groups.set(name, g);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([on, g]) => {
      const n = g.cases.length;
      return {
        on,
        kind: g.kind,
        waitedOn: n,
        late: g.cases.filter((c) => c.daysLate !== null).length,
        stillWaiting: g.cases.filter((c) => c.settledAt === null).length,
        cases: g.cases,
        caveat: n < SMALL_SAMPLE ? `${n === 1 ? 'Waited on once' : `Waited on ${n} times`} — too few to read a pattern into.` : null,
      };
    });
}
