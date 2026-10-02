/**
 * Intake — from a committed Helm decision to accountable commitments (§9, §11).
 *
 * Capture once, use everywhere: everything Helm already knows flows in with the
 * draft and is marked INHERITED; what Forge can only guess is marked INFERRED
 * for the owner to confirm; the person is asked only for what is MISSING.
 *
 * One decision becomes a small tree:
 *   - an OUTCOME commitment, owned by the decision owner: the change in the
 *     world management committed to, measured by the outcomes Helm expected;
 *   - one child commitment per action intent, owned by the person Helm named:
 *     the outputs that get the enterprise there, each with what would prove it.
 * The tree keeps the decision's lineage, so whoever executes can always read
 * why (§14).
 */

import {
  type CaptureMode,
  type CommitmentView,
  type ContextField,
  type EvidenceRequirement,
  fail,
  type ForgeRuntime,
  humanDate,
  ok,
  type Origin,
  type OutcomeMeasure,
  type PrecedentSubject,
  type ProposeInput,
  type Result,
  type Scope,
  type Statement,
  type TermField,
  type Terms,
  type ValueClaim,
} from '@forge/kernel';
import { HELM_ACTION_INTENT_CONTEXT, helmActionIntentRef } from './fidelity.ts';
import { helmCommitmentRef, type HelmCommittedDecision, type HelmDecisionReader, helmValueRef, unitOf } from './helm.ts';
import { dimensionForOutcome, type InferenceProvider, referenceRules } from './inference.ts';
import { type MemoireContextReader, memoireOpportunityRef, opportunityContext } from './memoire.ts';

export type FieldState = CaptureMode | 'MISSING';

export type DraftCommitment = {
  readonly key: string;
  readonly role: 'OUTCOME' | 'INTENT';
  readonly input: ProposeInput;
  /** How each stated term reached the draft; MISSING terms are the only ones a person must supply. */
  readonly fields: Readonly<Partial<Record<TermField, FieldState>>>;
  readonly notes: readonly Statement[];
};

export type IntakeDraft = {
  readonly source: HelmCommittedDecision;
  readonly origin: Origin;
  readonly context: readonly ContextField[];
  readonly outcome: DraftCommitment;
  readonly intents: readonly DraftCommitment[];
  /** What the draft asked of people, counted: inherited and inferred against missing. */
  readonly friction: { readonly inherited: number; readonly inferred: number; readonly missing: number };
};

/** A drafted commitment as precedents read it (`precedentsFor`): it has no id yet, and answers to the decision. */
export const draftSubject = (d: DraftCommitment): PrecedentSubject => ({
  id: null,
  originRef: d.input.origin.ref,
  terms: d.input.terms,
  context: d.input.context ?? [],
  dependencies: d.input.dependencies ?? [],
  links: (d.input.links ?? []).map((l) => ({ system: l.system, ref: l.ref })),
});

export type IntakeDeps = {
  readonly memoire?: MemoireContextReader;
  readonly inference?: InferenceProvider;
};

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function draftFromHelm(scope: Scope, hc: HelmCommittedDecision, deps: IntakeDeps = {}): Promise<Result<IntakeDraft>> {
  const inference = deps.inference ?? referenceRules;
  const ref = helmCommitmentRef(hc.commitment.id);
  const helmSource = { system: 'helm', ref, url: null };

  const origin: Origin = {
    kind: 'DECISION',
    system: 'helm',
    ref,
    label: hc.decision.title,
    fingerprint: hc.commitment.fingerprint,
    snapshot: {
      decisionId: hc.decision.id,
      managementQuestion: hc.decision.managementQuestion,
      summary: hc.commitment.summary,
      chosenAlternative: hc.commitment.chosenAlternative.label,
      committedAt: hc.commitment.committedAt,
      committedBy: hc.commitment.committedBy.label,
      rationale: hc.commitment.rationale,
      acceptedTradeOffs: hc.commitment.acceptedTradeOffs,
      expectedOutcomes: hc.commitment.expectedOutcomes,
      reviewTriggers: hc.commitment.reviewTriggers,
      assumptions: hc.assumptions.map((a) => ({ statement: a.statement, owner: a.ownerLabel, criticality: a.criticality })),
      horizon: hc.decision.horizon,
      demo: hc.demo,
    },
  };

  // ------------------------------------------------------------ context
  const context: ContextField[] = [
    { key: 'situation.question', label: 'Management question', value: hc.decision.managementQuestion, capture: 'INHERITED', epistemic: 'FACT', source: helmSource, entityRef: null },
    { key: 'situation.context', label: 'Situation', value: hc.decision.context, capture: 'INHERITED', epistemic: 'FACT', source: helmSource, entityRef: null },
    { key: 'situation.scope', label: 'Scope', value: hc.decision.scope, capture: 'INHERITED', epistemic: 'FACT', source: helmSource, entityRef: null },
    { key: 'decision.chosen', label: 'Chosen alternative', value: hc.commitment.chosenAlternative.label, capture: 'INHERITED', epistemic: 'DECISION', source: helmSource, entityRef: null },
    { key: 'decision.review', label: 'Helm review date', value: humanDate(hc.decision.horizon.reviewDate), capture: 'INHERITED', epistemic: 'FACT', source: helmSource, entityRef: null },
    ...hc.commitment.acceptedTradeOffs.map((t, i) => ({
      key: `decision.tradeoff.${i + 1}`,
      label: `Accepted trade-off — ${t.label}`,
      value: t.statement,
      capture: 'INHERITED' as const,
      epistemic: 'DECISION' as const,
      source: helmSource,
      entityRef: null,
    })),
    ...hc.assumptions.map((a, i) => ({
      key: `assumption.${i + 1}`,
      label: `Assumption (${a.criticality.toLowerCase()}) — ${a.ownerLabel ? `owned by ${a.ownerLabel}` : 'nobody stands behind this'}`,
      value: a.statement,
      standsBehind: a.ownerLabel,
      capture: 'INHERITED' as const,
      epistemic: 'ASSUMPTION' as const,
      source: helmSource,
      entityRef: null,
    })),
  ];

  const opportunities = hc.decision.triggerRefs.filter((t) => t.kind === 'OPPORTUNITY');
  if (deps.memoire) {
    for (const t of opportunities) {
      const o = await deps.memoire.opportunity(scope, t.ref);
      if (!o.ok) return o;
      if (o.value) context.push(...opportunityContext(o.value));
    }
  }

  // ------------------------------------------------------------ outcome
  const outcomes = hc.commitment.expectedOutcomes;
  const measures: OutcomeMeasure[] = outcomes
    .filter((o) => o.kind === 'QUALITATIVE' || o.betterWhen !== null)
    .map((o) => ({
      key: o.metricKey ?? slug(o.label),
      label: o.label,
      comparator: o.kind === 'QUALITATIVE' ? 'QUALITATIVE' : o.betterWhen === 'LOWER' ? 'AT_MOST' : 'AT_LEAST',
      expected: o.kind === 'QUALITATIVE' ? null : o.expectedValue,
      unit: unitOf(o.unit, o.currency),
      statement: o.statement,
      // The expectation names a value node and a period in Helm; the measure keeps that reference.
      source: { system: 'helm', ref: o.nodeId ? helmValueRef(o.nodeId, o.period?.start ?? null) : ref, url: null },
      metricKey: o.metricKey,
      // Helm's class of the value: an actual for this measure carries it (ADR-0017).
      protection: o.sensitivity ?? [],
    }));

  const value: ValueClaim[] = outcomes.flatMap((o) => {
    const dimension = dimensionForOutcome(inference, o);
    if (dimension === null) return [];
    const why = hc.commitment.rationale.find((r) => r.label === o.label)?.statement ?? o.statement ?? `${o.label}, as Helm modelled it.`;
    return [{ dimension, intent: 'PROTECT' as const, statement: why, precision: 'UNQUANTIFIED' as const, low: null, high: null, unit: null, source: helmSource }];
  });

  const outcomeEvidence: EvidenceRequirement[] = outcomes.map((o) =>
    o.kind === 'MODELLED' && o.nodeId
      ? {
          key: `actual-${slug(o.metricKey ?? o.label)}`,
          level: 'OUTCOME' as const,
          description: `Actual ${o.label} recorded in Helm’s value graph for the committed node and period`,
          required: true,
          // Pinned to the very node and period Helm committed to: Helm's actual there is the proof.
          matcher: { system: 'helm', eventType: 'value.actual_observed', objectRef: helmValueRef(o.nodeId, o.period?.start ?? null), where: {} },
        }
      : {
          key: `confirmed-${slug(o.label)}`,
          level: 'OUTCOME' as const,
          description: o.statement ?? o.label,
          required: false,
          matcher: null,
        },
  );

  const qualitative = outcomes.filter((o) => o.kind === 'QUALITATIVE' && o.statement).map((o) => o.statement as string);
  const firstReason = hc.commitment.rationale.find((r) => r.kind !== 'JUDGEMENT') ?? hc.commitment.rationale[0];
  const outcomeTerms: Terms = {
    statement: hc.commitment.summary,
    intendedOutcome:
      qualitative.length > 0
        ? `${qualitative.join(' ')} ${measures.some((m) => m.comparator !== 'QUALITATIVE') ? 'The modelled outcomes land where the committed future put them.' : ''}`.trim()
        : `The outcomes management expected land where the committed future put them: ${outcomes.map((o) => o.label).join(', ')}.`,
    why: `The answer management chose to “${hc.decision.managementQuestion}”${firstReason ? ` — ${firstReason.statement}` : ''}`,
    owner: { kind: 'ROLE', label: hc.decision.owner.label, ref: hc.decision.owner.userId },
    principal: { kind: 'ROLE', label: hc.commitment.committedBy.label, ref: hc.commitment.committedBy.userId },
    dueBy: hc.decision.horizon.expectedOutcomeHorizon,
    evidence: outcomeEvidence,
    measures,
    value,
  };
  const outcomeDraft: DraftCommitment = {
    key: 'outcome',
    role: 'OUTCOME',
    input: {
      origin,
      terms: outcomeTerms,
      capture: { statement: 'INHERITED', intendedOutcome: 'INHERITED', why: 'INHERITED', owner: 'INHERITED', principal: 'INHERITED', dueBy: 'INHERITED', measures: 'INHERITED', evidence: 'INFERRED', value: 'INFERRED' },
      context,
    },
    fields: {
      statement: 'INHERITED',
      intendedOutcome: 'INHERITED',
      why: 'INHERITED',
      owner: 'INHERITED',
      principal: 'INHERITED',
      dueBy: 'INHERITED',
      evidence: 'INFERRED',
      ...(measures.length > 0 ? { measures: 'INHERITED' as const } : {}),
      ...(value.length > 0 ? { value: 'INFERRED' as const } : {}),
    },
    notes: [
      {
        class: 'INFERENCE',
        text: 'Outcome evidence: each modelled outcome is proven by the actual Helm later observes for that metric; qualitative outcomes are confirmed by a person. forge-reference-rules@1.',
        basis: [ref],
      },
    ],
  };

  // ------------------------------------------------------------- intents
  const opportunity = opportunities[0] ?? null;
  const intents: DraftCommitment[] = hc.actionIntents.map((intent) => {
    const inferred = inference.evidenceForIntent(intent);
    const terms: Terms = {
      statement: intent.title,
      intendedOutcome: inferred.intendedOutcome ?? '',
      why: `${hc.decision.title}: ${hc.commitment.summary}`,
      owner: { kind: 'ROLE', label: intent.ownerLabel, ref: intent.ownerUserId },
      principal: { kind: 'ROLE', label: hc.commitment.committedBy.label, ref: hc.commitment.committedBy.userId },
      dueBy: intent.dueDate ?? '',
      evidence: inferred.requirements,
      measures: [],
      value: [],
    };
    const fields: Partial<Record<TermField, FieldState>> = {
      statement: 'INHERITED',
      intendedOutcome: inferred.intendedOutcome ? 'INFERRED' : 'MISSING',
      why: 'INHERITED',
      owner: 'INHERITED',
      principal: 'INHERITED',
      dueBy: intent.dueDate ? 'INHERITED' : 'MISSING',
      evidence: 'INFERRED',
    };
    const links =
      intent.targetSystem === 'memoire' && opportunity
        ? [{ system: 'memoire', kind: 'OPPORTUNITY', ref: memoireOpportunityRef(opportunity.ref), label: opportunity.label, url: null }]
        : [];
    return {
      key: intent.id,
      role: 'INTENT',
      input: {
        origin,
        terms,
        capture: Object.fromEntries(Object.entries(fields).filter(([, s]) => s !== 'MISSING')) as Partial<Record<TermField, CaptureMode>>,
        // The intent it answers, by reference: lineage from execution back to what management decided (§14).
        context: [
          ...context,
          { key: HELM_ACTION_INTENT_CONTEXT, label: 'Helm action intent', value: intent.title, capture: 'INHERITED', epistemic: 'FACT', source: { system: 'helm', ref: helmActionIntentRef(intent.id), url: null }, entityRef: null },
        ],
        links,
      },
      fields,
      notes: [
        inferred.note,
        ...(intent.detail ? [{ class: 'FACT' as const, text: `Helm’s note on the intent: ${intent.detail}`, basis: [intent.id] }] : []),
      ],
    };
  });

  const all = [outcomeDraft, ...intents].flatMap((d) => Object.values(d.fields));
  return ok({
    source: hc,
    origin,
    context,
    outcome: outcomeDraft,
    intents,
    friction: {
      inherited: all.filter((s) => s === 'INHERITED').length + context.length,
      inferred: all.filter((s) => s === 'INFERRED').length,
      missing: all.filter((s) => s === 'MISSING').length,
    },
  });
}

/** Terms a person supplies for a draft's MISSING fields, keyed by draft key. Anything supplied is recorded as MANUAL. */
export type IntakeEdits = Readonly<Record<string, Partial<Pick<Terms, 'intendedOutcome' | 'dueBy'>>>>;

export type IntakeResult = { readonly outcome: CommitmentView; readonly intents: readonly CommitmentView[] };

/** Propose the whole tree. Refused if Forge already holds commitments for this decision — intake happens once. */
export async function proposeIntake(runtime: ForgeRuntime, scope: Scope, draft: IntakeDraft, edits: IntakeEdits = {}): Promise<Result<IntakeResult>> {
  const existing = await runtime.list(scope, { originRef: draft.origin.ref ?? undefined });
  if (!existing.ok) return existing;
  if (existing.value.length > 0) return fail('intake.already_in_forge', 'Forge already holds commitments for this decision.');

  const finalize = (d: DraftCommitment): Result<ProposeInput> => {
    const edit = edits[d.key] ?? {};
    const capture = { ...d.input.capture };
    let terms = d.input.terms;
    for (const [field, state] of Object.entries(d.fields) as [TermField, FieldState][]) {
      if (state !== 'MISSING') continue;
      const supplied = (edit as Record<string, string | undefined>)[field];
      if (supplied === undefined || supplied.trim() === '') {
        return fail('intake.missing_field', `“${d.input.terms.statement}” still needs its ${field === 'dueBy' ? 'due date' : 'intended outcome'}.`, { draft: d.key, field });
      }
      terms = { ...terms, [field]: supplied.trim() };
      capture[field] = 'MANUAL';
    }
    return ok({ ...d.input, terms, capture });
  };

  const outcomeInput = finalize(draft.outcome);
  if (!outcomeInput.ok) return outcomeInput;
  const intentInputs: ProposeInput[] = [];
  for (const d of draft.intents) {
    const input = finalize(d);
    if (!input.ok) return input;
    intentInputs.push(input.value);
  }

  const outcome = await runtime.propose(scope, outcomeInput.value);
  if (!outcome.ok) return outcome;
  const intents: CommitmentView[] = [];
  for (const input of intentInputs) {
    const child = await runtime.propose(scope, { ...input, parentId: outcome.value.record.id });
    if (!child.ok) return child;
    intents.push(child.value);
  }
  return ok({ outcome: outcome.value, intents });
}

/** Helm commitments that have not yet become Forge commitments — the intake inbox. */
export async function pendingIntake(runtime: ForgeRuntime, scope: Scope, reader: HelmDecisionReader): Promise<Result<HelmCommittedDecision[]>> {
  const committed = await reader.committedSince(scope, null);
  if (!committed.ok) return committed;
  const held = await runtime.list(scope);
  if (!held.ok) return held;
  const refs = new Set(held.value.map((v) => v.record.origin.ref));
  return ok(committed.value.filter((hc) => !refs.has(helmCommitmentRef(hc.commitment.id))));
}
