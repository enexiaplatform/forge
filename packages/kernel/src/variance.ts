/**
 * Variance — the distance between what was promised and what happened (§6).
 *
 * Kept as separate facts, never summed: time, scope, each measure, each value
 * claim, and the gap between activity and outcome. A commitment can be late and
 * fulfilled, on time and partial, busy and ineffective; collapsing those into
 * one score would destroy exactly what the enterprise needs to learn from.
 */

import { dateOf, daysBetween, decimalCompare, decimalSub, isDecimal } from './primitives.ts';
import type { CommitmentView } from './derive.ts';
import type { OutcomeMeasure, RealizedValue, Resolution, ValueClaim } from './types.ts';
import { type Protection, protectionOf } from './sensitivity.ts';

export type MeasureVariance = {
  readonly key: string;
  readonly label: string;
  readonly comparator: OutcomeMeasure['comparator'];
  readonly expected: string | null;
  readonly actual: string | null;
  /** actual − expected, exact; null where either is missing or not a number. */
  readonly difference: string | null;
  readonly unit: string | null;
  /** Null for qualitative measures and measures not yet observed: people judge those. */
  readonly met: boolean | null;
  readonly note: string | null;
  /** The classes an actual for this measure carries (ADR-0017). */
  readonly protection: Protection;
  /** True when an actual exists and this reader is not cleared for it: actual, difference and met are withheld, not absent. */
  readonly withheld: boolean;
};

export type Variance = {
  readonly time: {
    readonly originalDueBy: string;
    readonly agreedDueBy: string;
    readonly redates: number;
    /** The day the outcome was achieved, or else the day it was closed. */
    readonly endedOn: string | null;
    /** Positive: days after the date first promised. */
    readonly daysAgainstOriginal: number | null;
    /** Positive: days after the date in force at the end. */
    readonly daysAgainstAgreed: number | null;
    /** Still open and past due at the lens: how far. */
    readonly runningDaysLate: number | null;
  };
  readonly scope: { readonly rescopes: number; readonly statementChanged: boolean; readonly originalStatement: string; readonly currentStatement: string };
  readonly measures: readonly MeasureVariance[];
  readonly value: readonly { readonly claim: ValueClaim; readonly realized: RealizedValue | null }[];
  readonly resolution: Resolution | null;
  readonly activity: { readonly links: number; readonly done: number; readonly total: number; readonly complete: boolean };
  /** All quantified measures met. Null when none is quantified or not yet observed. */
  readonly measuresHeld: boolean | null;
  /** The 42-tasks case (§7): every tracked activity is done, and the outcome still did not hold. */
  readonly activityOutcomeGap: boolean;
  /** Anything a person should explain. */
  readonly hasVariance: boolean;
};

export function varianceOf(v: CommitmentView): Variance {
  const ended = v.outcome?.outcome.achievedOn ?? (v.resolution ? dateOf(v.resolution.at) : null);
  const asOfDate = dateOf(v.lens.asOf);
  const open = v.phase === 'PROPOSED' || v.phase === 'ACTIVE';

  const measures = v.terms.measures.map((m): MeasureVariance => {
    const observed = v.outcome?.outcome.measures.find((x) => x.key === m.key) ?? null;
    const actual = observed?.actual ?? null;
    const numeric = m.comparator !== 'QUALITATIVE' && isDecimal(m.expected) && isDecimal(actual);
    let met: boolean | null = null;
    if (numeric) {
      const c = decimalCompare(actual as string, m.expected as string);
      met = m.comparator === 'AT_LEAST' ? c >= 0 : m.comparator === 'AT_MOST' ? c <= 0 : c === 0;
    }
    return {
      key: m.key,
      label: m.label,
      comparator: m.comparator,
      expected: m.expected,
      actual,
      difference: numeric ? decimalSub(actual as string, m.expected as string) : null,
      unit: m.unit,
      met,
      note: observed?.note ?? null,
      protection: protectionOf(m.protection ?? []),
      withheld: observed?.withheld === true,
    };
  });

  const quantified = measures.filter((m) => m.met !== null);
  const measuresHeld = quantified.length === 0 ? null : quantified.every((m) => m.met === true);

  const value = v.terms.value.map((claim) => ({
    claim,
    realized: v.outcome?.outcome.realizedValue.find((r) => r.dimension === claim.dimension) ?? null,
  }));

  const withActivity = v.links.filter((l) => l.activity !== null);
  const done = withActivity.reduce((s, l) => s + (l.activity?.done ?? 0), 0);
  const total = withActivity.reduce((s, l) => s + (l.activity?.total ?? 0), 0);
  const activityComplete = withActivity.length > 0 && withActivity.every((l) => l.activity !== null && l.activity.total > 0 && l.activity.done >= l.activity.total);

  const resolution = v.resolution?.resolution ?? null;
  const outcomeFellShort =
    measuresHeld === false || resolution === 'PARTIALLY_FULFILLED' || resolution === 'MISSED' ||
    v.requirements.some((r) => r.requirement.level === 'OUTCOME' && (r.status === 'CONTRADICTED' || r.status === 'CONFLICTED'));

  const daysAgainstOriginal = ended ? daysBetween(v.originalDueBy, ended) : null;
  const daysAgainstAgreed = ended ? daysBetween(v.terms.dueBy, ended) : null;
  const runningDaysLate = open && asOfDate > v.terms.dueBy ? daysBetween(v.terms.dueBy, asOfDate) : null;

  const statementChanged = v.terms.statement !== v.record.terms.statement;
  const hasVariance =
    (daysAgainstOriginal ?? 0) > 0 ||
    (runningDaysLate ?? 0) > 0 ||
    v.rescopes.length > 0 ||
    outcomeFellShort ||
    (resolution !== null && resolution !== 'FULFILLED') ||
    value.some((x) => x.realized !== null && (x.realized.effect === 'DELAYED' || x.realized.effect === 'DESTROYED'));

  return {
    time: {
      originalDueBy: v.originalDueBy,
      agreedDueBy: v.terms.dueBy,
      redates: v.redates.length,
      endedOn: ended,
      daysAgainstOriginal,
      daysAgainstAgreed,
      runningDaysLate,
    },
    scope: {
      rescopes: v.rescopes.length,
      statementChanged,
      originalStatement: v.record.terms.statement,
      currentStatement: v.terms.statement,
    },
    measures,
    value,
    resolution,
    activity: { links: withActivity.length, done, total, complete: activityComplete },
    measuresHeld,
    activityOutcomeGap: activityComplete && outcomeFellShort,
    hasVariance,
  };
}
