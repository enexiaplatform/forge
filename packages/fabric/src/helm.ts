/**
 * Helm, read — the decisions Forge turns into commitments (loop 1).
 *
 * Forge reads a committed Helm decision and never writes one. The shapes below
 * are Helm's own domain types (Helm's packages/decision-runtime/src/types.ts:
 * `Decision`, `DecisionCommitment`, `ExpectedOutcome`, `ReviewTrigger`,
 * `ActionIntent`, `DecisionAssumption`, `DecisionAlternative`), reduced to the
 * fields Forge uses and kept in Helm's words. They reach Forge through one
 * port, `HelmDecisionSource`, with two implementations:
 *
 *   - `createHelmTableSource` (helmSource.ts) reads Helm's tables as the
 *     signed-in user, under Helm's own row-level security, with the column
 *     names and mappings of Helm's own Postgres adapter;
 *   - Helm's own DecisionStore satisfies the port directly — the integration
 *     suite drives Helm's real runtime through it.
 *
 * `assembleCommittedDecisions` turns what the port returns into
 * `HelmCommittedDecision`, the read model intake works from.
 */

import type { Result, Scope } from '@forge/kernel';
import type { Protection } from '@forge/kernel';

// ----------------------------------------------------------- Helm's shapes

/** Helm's Scope: who reads, and as which organization. Forge passes the signed-in user's. */
export type HelmScope = {
  readonly orgId: string;
  readonly actorId: string;
  readonly role: 'admin' | 'manager' | 'member' | 'viewer';
  readonly orgUnitIds: readonly string[];
  readonly functions: readonly string[];
};

export type HelmPeriod = { readonly start: string; readonly end: string; readonly grain: string };

export type HelmDecisionShape = {
  readonly id: string;
  readonly title: string;
  readonly managementQuestion: string;
  readonly context: string;
  readonly scope: string;
  readonly triggerRefs: readonly { readonly kind: string; readonly ref: string; readonly label: string }[];
  readonly state: string;
  readonly owner: { readonly kind: string; readonly label: string; readonly userId: string | null } | null;
  readonly horizon: { readonly decisionDeadline: string | null; readonly effectiveFrom: string | null; readonly expectedOutcomeHorizon: string | null; readonly reviewDate: string | null };
  readonly objectives: readonly string[];
  readonly reversibility: string;
};

/** Helm's ExpectedOutcome — the value Helm copied from the frozen future state, on a value node, for a period. */
export type HelmExpectedOutcomeShape = {
  readonly label: string;
  readonly kind: 'MODELLED' | 'QUALITATIVE';
  readonly nodeId: string | null;
  readonly metricKey: string | null;
  readonly period: HelmPeriod | null;
  readonly expectedValue: string | null;
  /** Helm's QuantityUnit: 'currency' | 'percentage' | 'ratio' | 'units' | … */
  readonly unit: string | null;
  readonly currency: string | null;
  readonly statement: string | null;
};

export type HelmReviewTrigger = {
  readonly key: string;
  readonly description: string;
  readonly kind: 'METRIC_THRESHOLD' | 'EVENT' | 'DATE' | 'ASSUMPTION_BREAK';
  readonly metricKey: string | null;
  readonly comparator: 'ABOVE' | 'BELOW' | 'EQUALS' | null;
  readonly threshold: string | null;
  readonly byDate: string | null;
};

export type HelmCommitmentShape = {
  readonly id: string;
  readonly decisionId: string;
  readonly revisionId: string;
  readonly chosenAlternativeId: string;
  /** 'MANAGEMENT_AUTHORED' | 'MANAGEMENT_AUTHORED_DEMO' */
  readonly authorship: string;
  readonly committedBy: string | null;
  readonly committedByLabel: string;
  readonly committedAt: string;
  readonly summary: string;
  readonly rationale: readonly { readonly kind: string; readonly label: string; readonly statement: string }[];
  readonly acceptedTradeOffs: readonly { readonly label: string; readonly statement: string }[];
  readonly expectedOutcomes: readonly HelmExpectedOutcomeShape[];
  readonly reviewTriggers: readonly HelmReviewTrigger[];
  readonly fingerprint: string;
};

export type HelmAlternativeShape = { readonly id: string; readonly label: string; readonly status: string };
export type HelmAssumptionShape = {
  readonly statement: string;
  readonly owner: { readonly label: string } | null;
  readonly criticality: string;
};
export type HelmActionIntentShape = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly ownerLabel: string;
  readonly ownerUserId: string | null;
  readonly dueDate: string | null;
  readonly targetSystem: string;
};

/** Helm's metric semantics: which direction is good. */
export type HelmDirectionality = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' | 'TARGET_RANGE' | 'NEUTRAL' | 'CONTEXT_DEPENDENT';

/**
 * Everything Forge reads from Helm's decision layer — the read methods of Helm's own DecisionStore port
 * (same names, same shapes), plus the directionality of a metric from Helm's value registry.
 */
export interface HelmDecisionSource {
  listDecisions(scope: HelmScope): Promise<Result<readonly HelmDecisionShape[]>>;
  listCommitments(scope: HelmScope, decisionId: string): Promise<Result<readonly HelmCommitmentShape[]>>;
  listAlternatives(scope: HelmScope, revisionId: string): Promise<Result<readonly HelmAlternativeShape[]>>;
  listAssumptions(scope: HelmScope, revisionId: string): Promise<Result<readonly HelmAssumptionShape[]>>;
  listActionIntents(scope: HelmScope, commitmentId: string): Promise<Result<readonly HelmActionIntentShape[]>>;
  metricDirectionality(scope: HelmScope, metricKey: string): Promise<Result<HelmDirectionality | null>>;
  /**
   * Helm's sensitivity class of a value: the node's declared class, else its metric's (Helm ADR-0025). An actual for
   * this outcome carries it in Forge (ADR-0017).
   */
  valueSensitivity(scope: HelmScope, metricKey: string, nodeId: string | null): Promise<Result<string>>;
}

// --------------------------------------------------- Forge's read model

export type HelmExpectedOutcome = HelmExpectedOutcomeShape & {
  /** From the metric's directionality in Helm's value registry; null when the direction is not one-sided. */
  readonly betterWhen: 'HIGHER' | 'LOWER' | null;
  /** Helm's class of the value this outcome is about; an actual for it carries these classes. Empty: general management. */
  readonly sensitivity?: Protection;
};

export type HelmParty = { readonly label: string; readonly userId: string | null };

export type HelmActionIntent = HelmActionIntentShape;

export type HelmCommittedDecision = {
  readonly decision: {
    readonly id: string;
    readonly title: string;
    readonly managementQuestion: string;
    readonly context: string;
    readonly scope: string;
    readonly owner: HelmParty;
    readonly horizon: { readonly decisionDeadline: string; readonly effectiveFrom: string; readonly expectedOutcomeHorizon: string; readonly reviewDate: string };
    readonly objectives: readonly string[];
    readonly reversibility: string;
    readonly triggerRefs: readonly { readonly kind: string; readonly ref: string; readonly label: string }[];
  };
  readonly commitment: {
    readonly id: string;
    readonly revisionId: string;
    readonly fingerprint: string;
    readonly committedBy: HelmParty;
    readonly committedAt: string;
    readonly summary: string;
    readonly chosenAlternative: { readonly id: string; readonly label: string };
    readonly rationale: readonly { readonly kind: string; readonly label: string; readonly statement: string }[];
    readonly acceptedTradeOffs: readonly { readonly label: string; readonly statement: string }[];
    readonly expectedOutcomes: readonly HelmExpectedOutcome[];
    readonly reviewTriggers: readonly HelmReviewTrigger[];
  };
  readonly actionIntents: readonly HelmActionIntent[];
  readonly assumptions: readonly { readonly statement: string; readonly ownerLabel: string | null; readonly criticality: string }[];
  /** True for demonstration data; the UI labels it DEMO. */
  readonly demo: boolean;
};

/** Forge's canonical reference to a Helm decision commitment. */
export const helmCommitmentRef = (commitmentId: string): string => `helm:decision-commitment:${commitmentId}`;
export const helmCommitmentIdOf = (ref: string): string | null => (ref.startsWith('helm:decision-commitment:') ? ref.slice('helm:decision-commitment:'.length) : null);

/**
 * The object an expected outcome names: a Helm value node, for a period. An actual Helm records on the same node
 * and period is the outcome's evidence — the same reference on both sides is what lets Forge watch for it.
 */
export const helmValueRef = (nodeId: string, periodStart: string | null): string =>
  `helm:value-node:${nodeId}${periodStart ? `@${new Date(periodStart).toISOString()}` : ''}`;

/** A Helm QuantityUnit as Forge displays it. */
export const unitOf = (unit: string | null, currency: string | null): string | null =>
  unit === 'percentage' ? '%' : unit === 'currency' ? currency : unit === 'ratio' ? null : unit;

export interface HelmDecisionReader {
  /** Commitments recorded strictly after `since` (all when null), oldest first, as the reader may see them. */
  committedSince(scope: Scope, since: string | null): Promise<Result<HelmCommittedDecision[]>>;
  get(scope: Scope, commitmentId: string): Promise<Result<HelmCommittedDecision | null>>;
}

/** A reader over a fixed list — the demo. `visibleUntil` hides what Helm had not committed yet. */
export function createFixtureHelmReader(decisions: readonly HelmCommittedDecision[], visibleUntil: () => string): HelmDecisionReader {
  const visible = () => decisions.filter((d) => d.commitment.committedAt <= visibleUntil());
  return {
    async committedSince(_scope, since) {
      return {
        ok: true,
        value: visible()
          .filter((d) => since === null || d.commitment.committedAt > since)
          .sort((a, b) => (a.commitment.committedAt < b.commitment.committedAt ? -1 : 1)),
      };
    },
    async get(_scope, commitmentId) {
      return { ok: true, value: visible().find((d) => d.commitment.id === commitmentId) ?? null };
    },
  };
}
