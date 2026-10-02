/**
 * Forge's verified outcome, as HELM's governed intake reads it (loop 3; Helm ADR-0034, ADR-0035).
 *
 *     Forge owns execution truth. HELM owns management truth.
 *
 * Forge never writes HELM. It SUBMITS a verified outcome through HELM's own
 * contract (`helm.execution-outcome.v1`); HELM validates it, keeps a receipt,
 * and a HELM manager adopts it into HELM's outcome review, where HELM computes
 * the variance against its own frozen expectation. The Management Genome can
 * then reference the execution episode — typed, pinned to its fingerprint.
 *
 * Every actual travels as a CONTEXTUAL FACT (`helm.contextual-fact.v1`): value,
 * entity, metric, period, source, provenance, epistemic class, sensitivity,
 * scope and the authority context the publication rested on. Sensitivity is
 * carried, never lowered (ADR-0017): each fact carries its measure's classes,
 * and the narrative and the submission carry the publication's union.
 *
 * The mapping never grades: it carries what happened and what it rests on.
 */

import { type CommitmentView, joinProtection, type OutcomePublication, type PublishedMeasure } from '@forge/kernel';
import { helmCommitmentIdOf } from './helm.ts';
import type { Departure, DepartureKind } from './fidelity.ts';

export const HELM_EXECUTION_OUTCOME_CONTRACT = 'helm.execution-outcome.v1';
export const HELM_CONTEXTUAL_FACT_CONTRACT = 'helm.contextual-fact.v1';

/** HELM's ContextualFact (Helm's packages/integration-runtime/src/contextualFact.ts), mirrored — Forge imports no HELM code. */
export type HelmContextualFact = {
  readonly contract: typeof HELM_CONTEXTUAL_FACT_CONTRACT;
  readonly value: string | null;
  readonly statement: string | null;
  readonly unit: string | null;
  readonly currency: string | null;
  readonly entity: { readonly ref: string; readonly label: string } | null;
  readonly metric: { readonly key: string | null; readonly label: string };
  readonly period: { readonly start: string; readonly end: string | null } | null;
  readonly observedAt: string | null;
  readonly source: { readonly system: string; readonly ref: string | null };
  readonly provenance: { readonly basis: 'SYSTEM_RECORD' | 'PERSON_STATEMENT' | 'NOT_RECORDED'; readonly via: readonly string[]; readonly fingerprint: string | null };
  readonly epistemic: 'FACT' | 'INFERENCE' | 'ASSUMPTION' | 'PREDICTION' | 'RECOMMENDATION' | 'DECISION';
  readonly sensitivity: readonly string[];
  readonly scope: { readonly orgId: string; readonly decisionId: string | null };
  readonly authority: { readonly policy: string; readonly trusted: boolean } | null;
};

/** HELM's ExecutionOutcomeSubmission, mirrored. */
export type HelmExecutionOutcomeSubmission = {
  readonly contract: typeof HELM_EXECUTION_OUTCOME_CONTRACT;
  readonly sourceSystem: 'forge';
  readonly publication: { readonly ref: string; readonly fingerprint: string; readonly verifiedBy: string; readonly publishedByLabel: string };
  readonly episode: { readonly ref: string; readonly fingerprint: string };
  readonly decisionCommitment: { readonly id: string; readonly fingerprint: string };
  readonly resolution: 'FULFILLED' | 'PARTIALLY_FULFILLED' | 'MISSED';
  readonly achievedOn: string | null;
  readonly closedAt: string;
  readonly facts: readonly HelmContextualFact[];
  readonly narrative: { readonly outcome: string; readonly explanations: readonly string[]; readonly lessons: readonly string[]; readonly sensitivity: readonly string[] };
  readonly sensitivity: readonly string[];
  readonly authority: { readonly policy: string; readonly trusted: boolean } | null;
  /** Where execution departed from what Helm committed, each with its own classes (Helm ADR-0038; Forge ADR-0019). */
  readonly departures: readonly HelmExecutionDeparture[];
};

/** HELM's ExecutionDeparture, mirrored: a fact about the path, never a score. */
export type HelmExecutionDeparture = {
  readonly kind: DepartureKind;
  readonly statement: string;
  readonly at: string | null;
  readonly by: string | null;
  readonly reason: string | null;
  readonly authority: { readonly statement: string; readonly trusted: boolean; readonly approvedBy: string | null } | null;
  readonly sensitivity: readonly string[];
};

/** HELM's typed genome reference to an execution episode (Helm ADR-0035). */
export type HelmExecutionEpisodeRef = { readonly kind: 'EXECUTION_EPISODE'; readonly id: string; readonly pin: string; readonly label: string };

/** The HELM commitment a publication speaks to, when it answers to a HELM decision. */
export const helmCommitmentOf = (p: OutcomePublication): string | null => (p.origin.system === 'helm' && p.origin.ref ? helmCommitmentIdOf(p.origin.ref) : null);

/** Forge's display unit back in HELM's unit vocabulary. */
const helmUnit = (unit: string | null): { unit: string | null; currency: string | null } =>
  unit === '%' ? { unit: 'percentage', currency: null } : unit && /^[A-Z]{3}$/.test(unit) ? { unit: 'currency', currency: unit } : unit === 'units' ? { unit: 'units', currency: null } : { unit: null, currency: null };

/** 'helm:value-node:<id>@<period start>' → the node reference and the period start. */
const valueRefParts = (ref: string | null): { entityRef: string | null; periodStart: string | null } => {
  const m = ref ? /^(helm:value-node:[^@]+)(?:@(.+))?$/.exec(ref) : null;
  return { entityRef: m ? m[1] : null, periodStart: m?.[2] ?? null };
};

function factOf(p: OutcomePublication, m: PublishedMeasure, orgId: string, authority: HelmContextualFact['authority']): HelmContextualFact {
  const { entityRef, periodStart } = valueRefParts(m.sourceRef);
  const qualitative = m.comparator === 'QUALITATIVE';
  return {
    contract: HELM_CONTEXTUAL_FACT_CONTRACT,
    value: qualitative ? null : m.actual,
    statement: qualitative ? (m.note ?? 'Stated by people; not measured.') : null,
    ...helmUnit(m.unit),
    entity: entityRef ? { ref: m.sourceRef ?? entityRef, label: m.label } : null,
    metric: { key: m.metricKey, label: m.label },
    period: periodStart ? { start: periodStart, end: null } : null,
    observedAt: p.achievedOn,
    source: m.basis.kind === 'SYSTEM' ? { system: 'helm', ref: m.sourceRef } : { system: 'forge', ref: p.ref },
    provenance: {
      basis: m.basis.kind === 'SYSTEM' ? 'SYSTEM_RECORD' : m.basis.kind === 'PERSON' || qualitative ? 'PERSON_STATEMENT' : 'NOT_RECORDED',
      via: m.basis.kind === 'NONE' && qualitative ? [p.closedBy] : m.basis.sources,
      fingerprint: p.fingerprint,
    },
    epistemic: 'FACT',
    // Carried, never lowered (ADR-0017).
    sensitivity: [...(m.protection ?? [])],
    scope: { orgId, decisionId: null },
    authority,
  };
}

/**
 * The submission HELM's intake reads. `authority` is the verdict the publication rested on in Forge (its policy and
 * whether it is trusted) — HELM keeps it as received; it does not make the submission HELM's truth.
 */
export function toHelmExecutionOutcome(
  p: OutcomePublication,
  opts: {
    readonly orgId: string;
    readonly publishedByLabel: string;
    readonly authority: { readonly policy: string; readonly trusted: boolean } | null;
    /** The decision's departures (`decisionFidelity`), sent with the outcome so Helm can learn where fidelity was lost. */
    readonly departures?: readonly Departure[];
  },
): HelmExecutionOutcomeSubmission | null {
  const commitmentId = helmCommitmentOf(p);
  if (commitmentId === null || p.origin.fingerprint === null) return null;
  if (p.resolution !== 'FULFILLED' && p.resolution !== 'PARTIALLY_FULFILLED' && p.resolution !== 'MISSED') return null;
  const measured = p.measures.filter((m) => m.comparator === 'QUALITATIVE' ? m.note !== null : m.actual !== null);
  const departures = opts.departures ?? [];
  return {
    contract: HELM_EXECUTION_OUTCOME_CONTRACT,
    sourceSystem: 'forge',
    publication: { ref: p.ref, fingerprint: p.fingerprint, verifiedBy: p.verifiedBy, publishedByLabel: opts.publishedByLabel },
    episode: { ref: p.episode.ref, fingerprint: p.episode.fingerprint },
    decisionCommitment: { id: commitmentId, fingerprint: p.origin.fingerprint },
    resolution: p.resolution,
    achievedOn: p.achievedOn,
    closedAt: p.closedAt,
    facts: measured.map((m) => factOf(p, m, opts.orgId, opts.authority)),
    narrative: {
      outcome: p.outcome,
      explanations: p.explanations.map((e) => `${e.statement} — ${e.author}`),
      lessons: p.lessons.map((l) => `${l.statement} — ${l.author}`),
      sensitivity: [...p.protection],
    },
    // The submission is at least as protected as everything in it, departures included (ADR-0017).
    sensitivity: [...joinProtection(p.protection, ...departures.map((d) => d.protection))],
    authority: opts.authority,
    departures: departures.map((d) => ({
      kind: d.kind,
      statement: d.statement,
      at: d.at,
      by: d.by,
      reason: d.reason,
      authority: d.authority ? { statement: d.authority.statement, trusted: d.authority.trusted, approvedBy: d.authority.approvedBy } : null,
      sensitivity: [...d.protection],
    })),
  };
}

/** The genome's typed reference to the Forge episode, pinned to the fingerprint HELM received it at. */
export const toHelmExecutionEpisodeRef = (p: OutcomePublication): HelmExecutionEpisodeRef => ({
  kind: 'EXECUTION_EPISODE',
  id: p.episode.ref,
  pin: p.episode.fingerprint,
  label: `Forge execution episode — ${p.statement}`,
});

/** The authority context the latest publication rested on in Forge — policy and whether it is trusted — for HELM to keep as received. */
export function publicationAuthority(v: CommitmentView): { readonly policy: string; readonly trusted: boolean } | null {
  const last = v.publications[v.publications.length - 1];
  const e = last ? v.events.find((x) => x.id === last.eventId) : undefined;
  return e?.authority ? { policy: e.authority.policy, trusted: e.authority.trusted ?? false } : null;
}
