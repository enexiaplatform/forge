/**
 * Execution episode — what a commitment leaves behind (§18).
 *
 * When a commitment concludes, Forge assembles its memory in the shape the
 * source of truth names: situation, decision, assumptions, commitment,
 * dependencies, execution, evidence, outcome, variance, explanation, learning.
 * Each line is a classed statement with what it rests on.
 *
 * The episode is a READ MODEL with a fingerprint and a stable reference
 * (`forge:commitment:<id>`), so Helm's genome can wrap it by reference the way
 * it wraps a decision — Forge never writes into Helm. Like Helm, it records
 * process and outcome side by side and grades neither.
 */

import { amount, clause, fingerprint, humanDate, sameParty } from './primitives.ts';
import { type Epistemic, type Statement, fact } from './epistemic.ts';
import type { CommitmentView } from './derive.ts';
import { varianceOf, type Variance } from './variance.ts';
import type { Origin } from './types.ts';
import { describeProtection, joinProtection, type Protection } from './sensitivity.ts';

export const episodeSections = [
  'situation',
  'decision',
  'assumptions',
  'commitment',
  'dependencies',
  'execution',
  'evidence',
  'outcome',
  'variance',
  'explanation',
  'learning',
] as const;
export type EpisodeSection = (typeof episodeSections)[number];

export type ExecutionEpisode = {
  readonly ref: string;
  readonly commitmentId: string;
  readonly orgId: string;
  /** Only a closed commitment's episode is complete; an open one reads as "so far". */
  readonly complete: boolean;
  readonly origin: Origin;
  readonly parentRef: string | null;
  readonly sections: Readonly<Record<EpisodeSection, readonly Statement[]>>;
  readonly variance: Variance;
  /** The classes the facts in this episode carry — the union of its evidence and its outcome (ADR-0017). */
  readonly protection: Protection;
  /** What this reader was not cleared to read. Non-empty: the episode is complete for its readers, not for this one. */
  readonly withheld: Protection;
  /** Over the content this reader sees; the canonical fingerprint is the one a fully cleared reader computes. */
  readonly fingerprint: string;
};

const say = (cls: Epistemic, text: string, basis: readonly string[] = []): Statement => ({ class: cls, text, basis });

export function assembleEpisode(v: CommitmentView): ExecutionEpisode {
  const id = v.record.id;
  const origin = v.record.origin;
  const snapshot = origin.snapshot ?? {};
  const variance = varianceOf(v);

  const situation: Statement[] = v.record.context
    .filter((c) => c.key.startsWith('situation.') || c.key.startsWith('context.'))
    .map((c) => say(c.epistemic, `${c.label}: ${c.value}`, [c.source.ref ?? c.source.system]));

  const decision: Statement[] = [
    fact(`Answers to ${origin.kind.toLowerCase()} “${origin.label}”${origin.ref ? ` (${origin.ref})` : ''}.`, origin.ref ? [origin.ref] : []),
    ...(origin.fingerprint ? [fact(`The origin was fingerprinted ${origin.fingerprint} when this commitment was made.`, [origin.ref ?? id])] : []),
    say('DECISION', `Why: ${v.record.terms.why}`, [id]),
  ];

  const assumptions = Array.isArray(snapshot.assumptions)
    ? (snapshot.assumptions as { statement?: string; owner?: string | null }[])
        .filter((a) => typeof a.statement === 'string')
        .map((a) => say('ASSUMPTION', `${a.statement}${a.owner ? ` — owned by ${a.owner}` : ' — nobody stands behind this'}`, [origin.ref ?? id]))
    : [];

  const commitment: Statement[] = [
    say(
      'DECISION',
      sameParty(v.record.terms.owner, v.record.terms.principal)
        ? `${v.record.terms.owner.label} committed to: ${clause(v.record.terms.statement)} — by ${humanDate(v.record.terms.dueBy)}.`
        : `${v.record.terms.owner.label} promised ${v.record.terms.principal.label}: ${clause(v.record.terms.statement)} — by ${humanDate(v.record.terms.dueBy)}.`,
      [id],
    ),
    fact(`Intended outcome: ${v.record.terms.intendedOutcome}`, [id]),
    v.acceptance
      ? fact(`Accepted by ${v.acceptance.party.label} on ${humanDate(v.acceptance.at)}.`, [v.acceptance.eventId])
      : fact('Never accepted by its owner.', [id]),
    ...v.redates.map((r) => fact(`Due date moved from ${humanDate(r.from)} to ${humanDate(r.to)}.${r.reason ? ` “${r.reason}”` : ''}`, [r.eventId])),
    ...v.rescopes.map((r) => fact(`Scope changed.${r.reason ? ` “${r.reason}”` : ''}`, [r.eventId])),
    ...v.reassignments.map((r) => fact(`Handed from ${r.from.label} to ${r.to.label}.${r.reason ? ` “${r.reason}”` : ''}`, [r.eventId])),
  ];

  const dependencies = v.dependencies.map((d) =>
    fact(
      `${d.dependency.description}${d.dependency.neededBy ? `, needed by ${humanDate(d.dependency.neededBy)}` : ''} — ${d.settled ? `settled ${humanDate(d.settled.at)}` : 'never settled'}.`,
      d.settled ? [d.settled.eventId] : [id],
    ),
  );

  const execution = v.links.map((l) =>
    fact(
      `${l.link.system} ${l.link.kind.toLowerCase()} ${l.link.ref} “${l.link.label}”${l.activity ? ` — activity ${l.activity.done} of ${l.activity.total} ${l.activity.unit} on ${humanDate(l.activity.observedAt)}` : ''}.`,
      [l.activity?.eventId ?? id],
    ),
  );

  const evidence = v.requirements.map((r) =>
    fact(
      `${r.requirement.level} · ${clause(r.requirement.description)}: ${r.status.toLowerCase()}${r.basis === 'PERSON' ? ' on a person’s confirmation' : r.basis === 'SYSTEM' ? ' by a system record' : ''}.`,
      [...r.supporting, ...r.contradicting, ...r.inferred],
    ),
  );

  const outcome: Statement[] = v.outcome
    ? [
        fact(v.outcome.outcome.statement, [v.outcome.eventId, ...v.outcome.outcome.basis]),
        ...v.outcome.outcome.realizedValue.map((rv) => fact(`${rv.dimension.toLowerCase()}: ${rv.effect.toLowerCase()} — ${rv.statement}`, [v.outcome?.eventId ?? id])),
      ]
    : [fact('No outcome has been recorded.', [id])];
  if (v.resolution) {
    outcome.push(fact(`Closed ${v.resolution.resolution.toLowerCase().replace(/_/g, ' ')} by ${v.resolution.actor.label}.${v.resolution.reason ? ` “${v.resolution.reason}”` : ''}`, [v.resolution.eventId]));
  }

  const varianceLines: Statement[] = [];
  if (variance.time.daysAgainstOriginal !== null) {
    varianceLines.push(fact(`Ended ${relativeDays(variance.time.daysAgainstOriginal)} the date first promised (${humanDate(variance.time.originalDueBy)}).`, [id]));
    if (variance.time.redates > 0 && variance.time.daysAgainstAgreed !== null) {
      varianceLines.push(fact(`Ended ${relativeDays(variance.time.daysAgainstAgreed)} the date agreed after ${variance.time.redates} change${variance.time.redates === 1 ? '' : 's'} (${humanDate(variance.time.agreedDueBy)}).`, [id]));
    }
  }
  for (const m of variance.measures) {
    if (m.withheld) {
      varianceLines.push(fact(`${m.label}: expected ${amount(m.expected ?? '', m.unit)}, actual withheld (${describeProtection(m.protection)}).`, [v.outcome?.eventId ?? id]));
    } else if (m.difference !== null) {
      const signed = m.difference.startsWith('-') ? amount(m.difference, m.unit === '%' ? null : m.unit) : `+${amount(m.difference, m.unit === '%' ? null : m.unit)}`;
      varianceLines.push(
        fact(`${m.label}: expected ${amount(m.expected ?? '', m.unit)}, actual ${amount(m.actual ?? '', m.unit)} (${signed}${m.unit === '%' ? ' pts' : ''}).`, [v.outcome?.eventId ?? id]),
      );
    }
  }
  if (variance.activityOutcomeGap) {
    varianceLines.push(fact('Every tracked activity was done, and the outcome still did not hold.', [id]));
  }

  const explanation = v.learnings
    .filter((l) => l.learning.kind === 'EXPLANATION')
    .map((l) => say('INFERENCE', `${l.learning.statement} — ${l.actor.label}`, [l.eventId]));
  const learning = v.learnings
    .filter((l) => l.learning.kind === 'LESSON')
    .map((l) => say('RECOMMENDATION', `${l.learning.statement}${l.learning.appliesTo ? ` (applies to ${l.learning.appliesTo})` : ''} — ${l.actor.label}`, [l.eventId]));

  const sections: Record<EpisodeSection, readonly Statement[]> = {
    situation,
    decision,
    assumptions,
    commitment,
    dependencies,
    execution,
    evidence,
    outcome,
    variance: varianceLines,
    explanation,
    learning,
  };

  return {
    ref: `forge:commitment:${id}`,
    commitmentId: id,
    orgId: v.record.orgId,
    complete: v.phase === 'CLOSED',
    origin,
    parentRef: v.record.parentId ? `forge:commitment:${v.record.parentId}` : null,
    sections,
    variance,
    protection: joinProtection(
      ...v.evidence.map((e) => e.item.protection),
      v.outcome?.outcome.protection,
      ...variance.measures.filter((m) => m.actual !== null || m.withheld).map((m) => m.protection),
      // The reasons and learnings it quotes carry the class they were written at.
      ...v.events.map((e) => e.textProtection),
    ),
    withheld: joinProtection(...v.evidence.map((e) => e.item.withheld), v.outcome?.outcome.withheld, ...v.events.map((e) => e.textWithheld)),
    // Content only: the same record read at two lenses that saw the same events fingerprints identically.
    fingerprint: fingerprint('fep', { id, sections }),
  };
}

function relativeDays(days: number): string {
  if (days === 0) return 'on';
  return days > 0 ? `${days} day${days === 1 ? '' : 's'} after` : `${-days} day${days === -1 ? '' : 's'} before`;
}
