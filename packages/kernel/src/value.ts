/**
 * Value, as claimed and as realized (§17; §15 "Which decisions consumed resources but created little enterprise
 * value?"; ADR-0028).
 *
 * For each decision Forge executes — read at the root of its tree — the record sets side by side what it was meant to
 * create or protect, what people said it actually did, what the measures landed at and whether a system stood behind
 * each, and what it took, in the only currency Forge observes honestly: commitments, people, days, dates moved,
 * changes asked for. Forge does not know what anything cost and does not pretend to; it states no amount nobody stated.
 *
 * A record, never a score: no ratio of value to effort, no rate, no ranking. Decisions come in the order they ended
 * (still open ones last), and a claim nobody has said anything about says so.
 */

import { daysBetween, dateOf } from './primitives.ts';
import type { CommitmentView } from './derive.ts';
import type { RealizedValue, Resolution, ValueClaim } from './types.ts';
import { varianceOf } from './variance.ts';
import type { Protection } from './sensitivity.ts';

export type ValueRecord = {
  readonly commitmentId: string;
  readonly statement: string;
  readonly origin: string;
  readonly resolution: Resolution | null;
  readonly closedAt: string | null;
  /** What it was meant to create or protect, each with what people said became of it. */
  readonly claims: readonly { readonly claim: ValueClaim; readonly realized: RealizedValue | null; readonly by: string | null }[];
  /** Value people said it produced that nobody claimed for it beforehand. */
  readonly unclaimed: readonly RealizedValue[];
  readonly measures: readonly {
    readonly label: string;
    readonly expected: string | null;
    readonly actual: string | null;
    readonly difference: string | null;
    readonly unit: string | null;
    readonly withheld: boolean;
    readonly protection: Protection;
    /** A source system's record of the very object the expectation named stands behind the actual. */
    readonly provenBySystem: boolean;
  }[];
  /** What it took — facts Forge observed, nothing priced. */
  readonly took: {
    readonly commitments: number;
    readonly owners: readonly string[];
    /** From the first proposal in the tree to its last ending, or to the lens while any part is open. */
    readonly days: number;
    readonly datesMoved: number;
    readonly changesAsked: number;
    readonly stillOpen: number;
  };
  /** Claims nobody has said anything about since it ended — not counted where what was said is withheld from this reader. */
  readonly unstated: number;
  /** What people said it realized is withheld from this reader (ADR-0017): said, and not shown — never "not said". */
  readonly realizedWithheld: boolean;
};

function treeOf(root: CommitmentView, views: readonly CommitmentView[]): CommitmentView[] {
  const out = [root];
  for (let i = 0; i < out.length; i += 1) for (const v of views) if (v.record.parentId === out[i].record.id) out.push(v);
  return out;
}

export function valueRecords(views: readonly CommitmentView[]): ValueRecord[] {
  const roots = views.filter((v) => v.record.parentId === null && (v.terms.value.length > 0 || v.terms.measures.length > 0));
  const records = roots.map((root): ValueRecord => {
    const variance = varianceOf(root);
    const realized = root.outcome?.outcome.realizedValue ?? [];
    const withheld = (root.outcome?.outcome.withheld?.length ?? 0) > 0;
    const claimedDimensions = new Set(root.terms.value.map((c) => c.dimension));
    const tree = treeOf(root, views);
    const open = tree.filter((v) => v.phase === 'PROPOSED' || v.phase === 'ACTIVE');
    const start = tree.map((v) => v.record.proposedAt).sort()[0];
    const end = open.length > 0 ? root.lens.asOf : (tree.map((v) => v.resolution?.at ?? v.lens.asOf).sort().at(-1) ?? root.lens.asOf);
    const claims = variance.value.map((x) => ({ claim: x.claim, realized: x.realized, by: x.realized ? (root.outcome?.actor.label ?? null) : null }));
    return {
      commitmentId: root.record.id,
      statement: root.terms.statement,
      origin: root.record.origin.label,
      resolution: root.resolution?.resolution ?? null,
      closedAt: root.resolution?.at ?? null,
      claims,
      unclaimed: realized.filter((r) => !claimedDimensions.has(r.dimension)),
      measures: variance.measures.map((m) => {
        const ref = root.terms.measures.find((x) => x.key === m.key)?.source.ref ?? null;
        return {
          label: m.label,
          expected: m.expected,
          actual: m.actual,
          difference: m.difference,
          unit: m.unit,
          withheld: m.withheld,
          protection: m.protection,
          provenBySystem:
            ref !== null && root.requirements.some((r) => r.requirement.matcher?.objectRef === ref && r.status === 'EVIDENCED' && r.basis === 'SYSTEM'),
        };
      }),
      took: {
        commitments: tree.length,
        owners: [...new Set(tree.map((v) => v.terms.owner.label))].sort(),
        days: Math.max(0, daysBetween(dateOf(start), dateOf(end))),
        datesMoved: tree.reduce((n, v) => n + v.redates.length, 0),
        changesAsked: tree.reduce((n, v) => n + v.changeRequests.length, 0),
        stillOpen: open.length,
      },
      unstated: root.phase === 'CLOSED' && !withheld ? claims.filter((c) => c.realized === null).length : 0,
      realizedWithheld: withheld,
    };
  });
  // The order they ended; open ones last. Never by how much value, or how much effort.
  return records.sort((a, b) => (a.closedAt === b.closedAt ? a.statement.localeCompare(b.statement) : a.closedAt === null ? 1 : b.closedAt === null ? -1 : a.closedAt < b.closedAt ? -1 : 1));
}
