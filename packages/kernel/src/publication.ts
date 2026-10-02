/**
 * Verified outcomes — what Forge offers Helm's enterprise memory (§18, §19).
 *
 * When a commitment that answers to a decision has ended, its owner and
 * principal have said what happened, and the evidence holds, Forge can PUBLISH
 * the outcome: a frozen, fingerprinted statement of what was promised, what
 * changed, how each measure landed against the expectation, what every actual
 * rests on, what explains the difference, and what the enterprise should keep.
 *
 * Verification is narrow on purpose. It asks whether the RECORD supports the
 * outcome — not whether the outcome was good. A missed commitment can be
 * verified; a fulfilled one with disputed evidence cannot. Publishing is a
 * person's act (the principal's), recorded as an event, and Helm reads it; a
 * Helm person turns it into an outcome review, and Helm's genome wraps the
 * episode by reference. Forge never writes into Helm.
 */

import { amount, fingerprint, ok, type Result } from './primitives.ts';
import type { CommitmentView } from './derive.ts';
import { assembleEpisode } from './episode.ts';
import { varianceOf } from './variance.ts';
import { deliveryResolutions, type OutcomeMeasure, type RealizedValue, type Resolution } from './types.ts';
import { describeProtection, joinProtection, type Protection } from './sensitivity.ts';

export const VERIFICATION_POLICY = 'forge-outcome-verification@1';

export type MeasureBasis = {
  /** SYSTEM: the actual is a source system's record on the very object the expectation named. PERSON: someone stated it. */
  readonly kind: 'SYSTEM' | 'PERSON' | 'NONE';
  readonly evidenceIds: readonly string[];
  readonly sources: readonly string[];
};

export type PublishedMeasure = {
  readonly key: string;
  readonly label: string;
  /** The metric the expectation was about, in the origin system's own terms. */
  readonly metricKey: string | null;
  /** The object the expectation named — for Helm, the value node and period. */
  readonly sourceRef: string | null;
  readonly comparator: OutcomeMeasure['comparator'];
  readonly expected: string | null;
  readonly actual: string | null;
  readonly difference: string | null;
  readonly unit: string | null;
  readonly met: boolean | null;
  readonly note: string | null;
  readonly basis: MeasureBasis;
  /** The classes this actual carries (ADR-0017): Helm's class of the value, carried, never lowered. */
  readonly protection: Protection;
};

export type OutcomePublication = {
  /** forge:commitment:<id> */
  readonly ref: string;
  readonly commitmentId: string;
  readonly orgId: string;
  readonly origin: { readonly kind: string; readonly system: string; readonly ref: string | null; readonly label: string; readonly fingerprint: string | null };
  readonly statement: string;
  readonly owner: string;
  readonly principal: string;
  readonly resolution: Resolution;
  readonly closedAt: string;
  readonly closedBy: string;
  readonly achievedOn: string | null;
  readonly outcome: string;
  readonly measures: readonly PublishedMeasure[];
  readonly realizedValue: readonly RealizedValue[];
  readonly evidence: { readonly required: number; readonly bySystem: number; readonly byPerson: number };
  readonly time: {
    readonly originalDueBy: string;
    readonly agreedDueBy: string;
    readonly redates: number;
    readonly daysAgainstOriginal: number | null;
    readonly daysAgainstAgreed: number | null;
  };
  readonly explanations: readonly { readonly statement: string; readonly author: string }[];
  readonly lessons: readonly { readonly statement: string; readonly appliesTo: string | null; readonly author: string }[];
  readonly episode: { readonly ref: string; readonly fingerprint: string };
  /** The union of every class the published facts carry; whoever receives it must protect it at least as well. */
  readonly protection: Protection;
  readonly verifiedBy: typeof VERIFICATION_POLICY;
  readonly fingerprint: string;
};

/** Why a commitment's outcome cannot be published yet — each reason a fact a person can act on. */
export type VerificationGap = { readonly code: string; readonly statement: string };

export function verifyOutcome(v: CommitmentView): Result<OutcomePublication, { code: string; message: string; details: { gaps: VerificationGap[] } }> {
  const gaps: VerificationGap[] = [];
  if (v.phase !== 'CLOSED' || v.resolution === null) {
    gaps.push({ code: 'not_closed', statement: 'The commitment has not ended.' });
  } else if (!deliveryResolutions.includes(v.resolution.resolution)) {
    gaps.push({ code: 'not_a_delivery_ending', statement: `It ended ${v.resolution.resolution.toLowerCase().replace(/_/g, ' ')}; there is no outcome of it to verify.` });
  }
  if (v.outcome === null) gaps.push({ code: 'outcome_unrecorded', statement: 'Nobody has recorded what actually happened.' });
  const withheld = joinProtection(v.outcome?.outcome.withheld, ...v.evidence.map((e) => e.item.withheld), ...v.events.map((e) => e.textWithheld));
  if (withheld.length > 0) {
    gaps.push({ code: 'withheld', statement: `Some of what this outcome rests on is ${describeProtection(withheld)} and you are not cleared for it; only someone who can read all of it can publish it.` });
  }
  for (const r of v.requirements) {
    if (!r.requirement.required) continue;
    if (r.status === 'CONFLICTED' || r.status === 'CONTRADICTED') {
      gaps.push({ code: 'evidence_disputed', statement: `The evidence on “${r.requirement.description}” disagrees.` });
    } else if (r.requirement.level === 'OUTCOME' && r.status !== 'EVIDENCED') {
      gaps.push({ code: 'outcome_unproven', statement: `Nothing proves “${r.requirement.description}”.` });
    }
  }
  if (gaps.length > 0 || v.resolution === null || v.outcome === null) {
    return { ok: false, error: { code: 'outcome.not_verifiable', message: gaps.map((g) => g.statement).join(' '), details: { gaps } } };
  }

  const variance = varianceOf(v);
  const measures: PublishedMeasure[] = variance.measures.map((m) => {
    const def = v.terms.measures.find((x) => x.key === m.key);
    const sourceRef = def?.source.ref ?? null;
    // The requirement that watches the same object the expectation named is where the actual's proof lives.
    const proving = v.requirements.filter((r) => r.requirement.matcher !== null && sourceRef !== null && r.requirement.matcher.objectRef === sourceRef);
    const systemIds = proving.flatMap((r) => (r.basis === 'SYSTEM' ? r.supporting : []));
    const systemEvidence = v.evidence.filter((e) => systemIds.includes(e.item.id));
    const basis: MeasureBasis =
      m.actual === null && m.comparator !== 'QUALITATIVE'
        ? { kind: 'NONE', evidenceIds: [], sources: [] }
        : systemEvidence.length > 0
          ? { kind: 'SYSTEM', evidenceIds: systemIds, sources: [...new Set(systemEvidence.map((e) => `${e.item.source.system}:${e.item.source.ref ?? ''}`))] }
          : { kind: 'PERSON', evidenceIds: v.outcome ? [v.outcome.eventId] : [], sources: [v.outcome?.actor.label ?? 'unknown'] };
    return {
      key: m.key,
      label: m.label,
      metricKey: def?.metricKey ?? null,
      sourceRef,
      comparator: m.comparator,
      expected: m.expected,
      actual: m.actual,
      difference: m.difference,
      unit: m.unit,
      met: m.met,
      note: m.note,
      basis,
      protection: m.protection,
    };
  });

  const required = v.requirements.filter((r) => r.requirement.required);
  const episode = assembleEpisode(v);
  const body = {
    ref: `forge:commitment:${v.record.id}`,
    commitmentId: v.record.id,
    orgId: v.record.orgId,
    origin: {
      kind: v.record.origin.kind,
      system: v.record.origin.system,
      ref: v.record.origin.ref,
      label: v.record.origin.label,
      fingerprint: v.record.origin.fingerprint,
    },
    statement: v.terms.statement,
    owner: v.terms.owner.label,
    principal: v.terms.principal.label,
    resolution: v.resolution.resolution,
    closedAt: v.resolution.at,
    closedBy: v.resolution.actor.label,
    achievedOn: v.outcome.outcome.achievedOn,
    outcome: v.outcome.outcome.statement,
    measures,
    realizedValue: v.outcome.outcome.realizedValue,
    evidence: {
      required: required.length,
      bySystem: required.filter((r) => r.basis === 'SYSTEM').length,
      byPerson: required.filter((r) => r.basis === 'PERSON').length,
    },
    time: {
      originalDueBy: variance.time.originalDueBy,
      agreedDueBy: variance.time.agreedDueBy,
      redates: variance.time.redates,
      daysAgainstOriginal: variance.time.daysAgainstOriginal,
      daysAgainstAgreed: variance.time.daysAgainstAgreed,
    },
    explanations: v.learnings.filter((l) => l.learning.kind === 'EXPLANATION').map((l) => ({ statement: l.learning.statement, author: l.actor.label })),
    lessons: v.learnings
      .filter((l) => l.learning.kind === 'LESSON')
      .map((l) => ({ statement: l.learning.statement, appliesTo: l.learning.appliesTo, author: l.actor.label })),
    episode: { ref: episode.ref, fingerprint: episode.fingerprint },
    protection: joinProtection(episode.protection, ...measures.map((m) => m.protection)),
    verifiedBy: VERIFICATION_POLICY,
  } as const;
  return ok({ ...body, fingerprint: fingerprint('fop', body) });
}

/** One line per measure, for people reading a publication outside Forge. */
export function describeMeasure(m: PublishedMeasure): string {
  if (m.comparator === 'QUALITATIVE') return `${m.label}: ${m.note ?? 'stated by people, not measured'}`;
  if (m.actual === null) return `${m.label}: expected ${amount(m.expected ?? '', m.unit)}, no actual recorded`;
  return `${m.label}: expected ${amount(m.expected ?? '', m.unit)}, actual ${amount(m.actual, m.unit)} — ${
    m.basis.kind === 'SYSTEM' ? `recorded by ${m.basis.sources.join(', ')}` : 'stated by a person'
  }`;
}
