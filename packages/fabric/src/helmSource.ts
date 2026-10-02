/**
 * Helm's decision layer and value graph, read for real (loop 1).
 *
 * `createHelmTableSource` reads Helm's own tables through a TableClient — the
 * signed-in user's supabase-js session in the browser, or raw SQL in tests —
 * so Helm's row-level security decides what Forge sees. Column names and
 * row-to-shape mappings follow Helm's own Postgres adapter
 * (packages/decision-runtime/src/postgres.ts); `HELM_READ_CONTRACT` lists
 * every column Forge reads, and the integration suite checks each one against
 * the columns Helm's adapter itself selects.
 *
 * `assembleCommittedDecisions` builds the read model intake works from, over
 * any HelmDecisionSource — the table source here, or Helm's own DecisionStore.
 *
 * `createHelmValueSurface` turns ACTUAL observations Helm recorded in its value
 * graph into Forge observations, so an expected outcome's own node and period
 * proves (or disproves) the outcome.
 */

import { ok, type Protection, protectionOf, type Result, type Scope } from '@forge/kernel';
import type { Row, TableClient } from '@forge/kernel/postgres';
import {
  type HelmActionIntentShape,
  type HelmAlternativeShape,
  type HelmAssumptionShape,
  type HelmCommitmentShape,
  type HelmCommittedDecision,
  type HelmDecisionReader,
  type HelmDecisionShape,
  type HelmDecisionSource,
  type HelmDirectionality,
  type HelmExpectedOutcomeShape,
  type HelmScope,
  helmCommitmentRef,
  helmValueRef,
} from './helm.ts';
import type { ExecutionSurface, Observation } from './surfaces.ts';

/** Every Helm column Forge reads, by table. Each must be one Helm's own adapter reads. */
export const HELM_READ_CONTRACT = {
  helm_decisions: ['id', 'org_id', 'title', 'management_question', 'context', 'decision_scope', 'trigger_refs', 'kernel_state', 'owner_kind', 'owner_label', 'owner_id', 'decision_deadline', 'effective_from', 'expected_outcome_horizon', 'review_date', 'objectives', 'reversibility'],
  helm_decision_commitments: ['id', 'org_id', 'decision_id', 'revision_id', 'chosen_alternative_id', 'authorship', 'committed_by', 'committed_by_label', 'committed_at', 'summary', 'rationale', 'accepted_trade_offs', 'expected_outcomes', 'review_triggers', 'fingerprint'],
  helm_decision_alternatives: ['id', 'org_id', 'revision_id', 'name', 'status'],
  helm_decision_assumptions: ['id', 'org_id', 'revision_id', 'statement', 'owner_label', 'criticality'],
  helm_actions: ['id', 'org_id', 'commitment_id', 'title', 'detail', 'owner_label', 'owner_id', 'due_date', 'target_system'],
} as const;

/** The value-graph columns the value surface reads (Helm's value-graph adapter reads the same tables). */
export const HELM_VALUE_READ_CONTRACT = {
  helm_value_metrics: ['id', 'key', 'directionality', 'sensitivity'],
  helm_value_nodes: ['id', 'metric_id', 'label', 'sensitivity'],
  helm_value_observations: ['id', 'org_id', 'node_id', 'observation_type', 'numeric_value', 'unit_type', 'currency', 'period_start', 'period_end', 'effective_at', 'observed_at', 'recorded_at', 'source_system'],
} as const;

const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : typeof v === 'string' ? (JSON.parse(v) as T[]) : []);
const dateOnly = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
};
const instant = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

// Mappers mirror Helm's own (toDecision, toCommitment, toAlternative, toAssumption, toIntent).
const toDecision = (r: Row): HelmDecisionShape => ({
  id: String(r.id),
  title: String(r.title),
  managementQuestion: (r.management_question as string) ?? '',
  context: (r.context as string) ?? '',
  scope: (r.decision_scope as string) ?? '',
  triggerRefs: arr(r.trigger_refs),
  state: String(r.kernel_state),
  owner: r.owner_label ? { kind: (r.owner_kind as string) ?? 'ROLE', label: String(r.owner_label), userId: txt(r.owner_id) } : null,
  horizon: {
    decisionDeadline: dateOnly(r.decision_deadline),
    effectiveFrom: dateOnly(r.effective_from),
    expectedOutcomeHorizon: dateOnly(r.expected_outcome_horizon),
    reviewDate: dateOnly(r.review_date),
  },
  objectives: arr(r.objectives),
  reversibility: (r.reversibility as string) ?? 'UNASSESSED',
});

const toCommitment = (r: Row): HelmCommitmentShape => ({
  id: String(r.id),
  decisionId: String(r.decision_id),
  revisionId: String(r.revision_id),
  chosenAlternativeId: String(r.chosen_alternative_id),
  authorship: String(r.authorship),
  committedBy: txt(r.committed_by),
  committedByLabel: (r.committed_by_label as string) ?? '',
  committedAt: instant(r.committed_at),
  summary: (r.summary as string) ?? '',
  rationale: arr(r.rationale),
  acceptedTradeOffs: arr(r.accepted_trade_offs),
  expectedOutcomes: arr<HelmExpectedOutcomeShape>(r.expected_outcomes),
  reviewTriggers: arr(r.review_triggers),
  fingerprint: String(r.fingerprint),
});

const toAlternative = (r: Row): HelmAlternativeShape => ({ id: String(r.id), label: String(r.name), status: String(r.status) });
const toAssumption = (r: Row): HelmAssumptionShape => ({
  statement: String(r.statement),
  owner: r.owner_label ? { label: String(r.owner_label) } : null,
  criticality: (r.criticality as string) ?? 'MATERIAL',
});
const toIntent = (r: Row): HelmActionIntentShape => ({
  id: String(r.id),
  title: String(r.title),
  detail: (r.detail as string) ?? '',
  ownerLabel: (r.owner_label as string) ?? '',
  ownerUserId: txt(r.owner_id),
  dueDate: dateOnly(r.due_date),
  targetSystem: (r.target_system as string) ?? 'helm',
});

const cols = (table: keyof typeof HELM_READ_CONTRACT) => [...HELM_READ_CONTRACT[table]];

/** Fail closed: a Helm value whose class cannot be read is protected in every compartment until it can be. */
const UNKNOWN_CLASS: Protection = protectionOf('FINANCIAL_SENSITIVE', 'COMMERCIAL_CONFIDENTIAL', 'HR_RESTRICTED', 'STRATEGIC_RESTRICTED');

export function createHelmTableSource(db: TableClient): HelmDecisionSource {
  return {
    async listDecisions(scope) {
      const r = await db.select('helm_decisions', { columns: cols('helm_decisions'), eq: { org_id: scope.orgId }, order: [{ column: 'id', ascending: true }] });
      return r.ok ? ok(r.value.map(toDecision)) : r;
    },
    async listCommitments(scope, decisionId) {
      const r = await db.select('helm_decision_commitments', {
        columns: cols('helm_decision_commitments'),
        eq: { org_id: scope.orgId, decision_id: decisionId },
        order: [{ column: 'committed_at', ascending: true }],
      });
      return r.ok ? ok(r.value.map(toCommitment)) : r;
    },
    async listAlternatives(scope, revisionId) {
      const r = await db.select('helm_decision_alternatives', { columns: cols('helm_decision_alternatives'), eq: { org_id: scope.orgId, revision_id: revisionId } });
      return r.ok ? ok(r.value.map(toAlternative)) : r;
    },
    async listAssumptions(scope, revisionId) {
      const r = await db.select('helm_decision_assumptions', { columns: cols('helm_decision_assumptions'), eq: { org_id: scope.orgId, revision_id: revisionId } });
      return r.ok ? ok(r.value.map(toAssumption)) : r;
    },
    async listActionIntents(scope, commitmentId) {
      const r = await db.select('helm_actions', { columns: cols('helm_actions'), eq: { org_id: scope.orgId, commitment_id: commitmentId } });
      return r.ok ? ok(r.value.map(toIntent)) : r;
    },
    async metricDirectionality(_scope, metricKey) {
      const r = await db.select('helm_value_metrics', { columns: [...HELM_VALUE_READ_CONTRACT.helm_value_metrics], eq: { key: metricKey } });
      if (!r.ok) return r;
      return ok((r.value[0]?.directionality as HelmDirectionality | undefined) ?? null);
    },
    async valueSensitivity(_scope, metricKey, nodeId) {
      // Helm's own rule (helm_private.node_sensitivity): the node's declared class, else its metric's.
      if (nodeId) {
        const n = await db.select('helm_value_nodes', { columns: [...HELM_VALUE_READ_CONTRACT.helm_value_nodes], eq: { id: nodeId } });
        if (!n.ok) return n;
        if (n.value[0]?.sensitivity) return ok(String(n.value[0].sensitivity));
      }
      const m = await db.select('helm_value_metrics', { columns: [...HELM_VALUE_READ_CONTRACT.helm_value_metrics], eq: { key: metricKey } });
      if (!m.ok) return m;
      return ok(String(m.value[0]?.sensitivity ?? 'GENERAL_MANAGEMENT'));
    },
  };
}

/** The Helm Scope a Forge reader reads as: the same organization, the same person. */
export const helmScopeOf = (scope: Scope): HelmScope => ({
  orgId: scope.orgId,
  actorId: scope.actor.id ?? '',
  role: scope.role,
  orgUnitIds: [],
  functions: [],
});

const betterWhen = (d: HelmDirectionality | null): 'HIGHER' | 'LOWER' | null => (d === 'HIGHER_IS_BETTER' ? 'HIGHER' : d === 'LOWER_IS_BETTER' ? 'LOWER' : null);

/** Every COMMITTED decision the reader may see, as Forge's read model. Not-yet-committed decisions are not Forge's. */
export async function assembleCommittedDecisions(source: HelmDecisionSource, scope: HelmScope, since: string | null = null): Promise<Result<HelmCommittedDecision[]>> {
  const decisions = await source.listDecisions(scope);
  if (!decisions.ok) return decisions;
  const out: HelmCommittedDecision[] = [];
  const directions = new Map<string, 'HIGHER' | 'LOWER' | null>();
  for (const d of decisions.value) {
    const commitments = await source.listCommitments(scope, d.id);
    if (!commitments.ok) return commitments;
    for (const c of commitments.value) {
      if (since !== null && c.committedAt <= since) continue;
      const [alternatives, assumptions, intents] = await Promise.all([
        source.listAlternatives(scope, c.revisionId),
        source.listAssumptions(scope, c.revisionId),
        source.listActionIntents(scope, c.id),
      ]);
      if (!alternatives.ok) return alternatives;
      if (!assumptions.ok) return assumptions;
      if (!intents.ok) return intents;
      const expected = [];
      for (const o of c.expectedOutcomes) {
        if (o.metricKey && !directions.has(o.metricKey)) {
          const dir = await source.metricDirectionality(scope, o.metricKey);
          if (!dir.ok) return dir;
          directions.set(o.metricKey, betterWhen(dir.value));
        }
        let sensitivity: Protection = [];
        if (o.metricKey) {
          const s = await source.valueSensitivity(scope, o.metricKey, o.nodeId ?? null);
          if (!s.ok) return s;
          sensitivity = protectionOf(s.value);
        }
        expected.push({ ...o, betterWhen: o.metricKey ? (directions.get(o.metricKey) ?? null) : null, sensitivity });
      }
      const chosen = alternatives.value.find((a) => a.id === c.chosenAlternativeId);
      out.push({
        decision: {
          id: d.id,
          title: d.title,
          managementQuestion: d.managementQuestion,
          context: d.context,
          scope: d.scope,
          owner: { label: d.owner?.label ?? c.committedByLabel, userId: d.owner?.userId ?? null },
          horizon: {
            decisionDeadline: d.horizon.decisionDeadline ?? '',
            effectiveFrom: d.horizon.effectiveFrom ?? '',
            expectedOutcomeHorizon: d.horizon.expectedOutcomeHorizon ?? d.horizon.reviewDate ?? '',
            reviewDate: d.horizon.reviewDate ?? '',
          },
          objectives: d.objectives,
          reversibility: d.reversibility,
          triggerRefs: d.triggerRefs,
        },
        commitment: {
          id: c.id,
          revisionId: c.revisionId,
          fingerprint: c.fingerprint,
          committedBy: { label: c.committedByLabel, userId: c.committedBy },
          committedAt: c.committedAt,
          summary: c.summary,
          chosenAlternative: { id: c.chosenAlternativeId, label: chosen?.label ?? c.chosenAlternativeId },
          rationale: c.rationale,
          acceptedTradeOffs: c.acceptedTradeOffs,
          expectedOutcomes: expected,
          reviewTriggers: c.reviewTriggers,
        },
        actionIntents: intents.value,
        assumptions: assumptions.value.map((a) => ({ statement: a.statement, ownerLabel: a.owner?.label ?? null, criticality: a.criticality })),
        demo: c.authorship === 'MANAGEMENT_AUTHORED_DEMO',
      });
    }
  }
  return ok(out.sort((a, b) => (a.commitment.committedAt < b.commitment.committedAt ? -1 : 1)));
}

/** A HelmDecisionReader over any source — what intake and the console read through. */
export function createHelmSourceReader(source: HelmDecisionSource): HelmDecisionReader {
  return {
    async committedSince(scope, since) {
      return assembleCommittedDecisions(source, helmScopeOf(scope), since);
    },
    async get(scope, commitmentId) {
      const all = await assembleCommittedDecisions(source, helmScopeOf(scope));
      return all.ok ? ok(all.value.find((d) => d.commitment.id === commitmentId) ?? null) : all;
    },
  };
}

/** Helm's own reference for a committed decision, as Forge stores it. */
export const originRefOf = (d: HelmCommittedDecision): string => helmCommitmentRef(d.commitment.id);

// ------------------------------------------------------- value actuals

/**
 * Helm's value graph as an execution surface: every ACTUAL observation Helm recorded after the checkpoint, as
 * an observation of the value node and period it is about. Helm owns the fact (and names the source system it
 * came from); Forge only reads it.
 */
export function createHelmValueSurface(db: TableClient, orgId: string): ExecutionSurface {
  return {
    system: 'helm',
    label: 'Helm value graph',
    describes: 'Source actuals Helm recorded against its value nodes — read as outcome evidence.',
    async pull(since, until) {
      const rows = await db.select('helm_value_observations', {
        columns: [...HELM_VALUE_READ_CONTRACT.helm_value_observations],
        eq: { org_id: orgId, observation_type: 'ACTUAL' },
        ...(since ? { gt: { column: 'recorded_at', value: since } } : {}),
        lte: { column: 'recorded_at', value: until },
        order: [{ column: 'recorded_at', ascending: true }],
      });
      if (!rows.ok) return [];
      const nodeIds = [...new Set(rows.value.map((r) => String(r.node_id)))];
      const nodes = nodeIds.length ? await db.select('helm_value_nodes', { columns: [...HELM_VALUE_READ_CONTRACT.helm_value_nodes], in: { column: 'id', values: nodeIds } }) : ok([]);
      const metricIds = nodes.ok ? [...new Set(nodes.value.map((n) => String(n.metric_id)))] : [];
      const metrics = metricIds.length ? await db.select('helm_value_metrics', { columns: [...HELM_VALUE_READ_CONTRACT.helm_value_metrics], in: { column: 'id', values: metricIds } }) : ok([]);
      const metricOfNode = new Map<string, { key: string; label: string; protection: Protection }>();
      if (nodes.ok && metrics.ok) {
        for (const n of nodes.value) {
          const m = metrics.value.find((x) => x.id === n.metric_id);
          // Helm's rule: the node's declared class, else its metric's. An unknown metric is not assumed general.
          const declared = n.sensitivity ?? m?.sensitivity ?? (m ? 'GENERAL_MANAGEMENT' : null);
          metricOfNode.set(String(n.id), { key: m ? String(m.key) : String(n.metric_id), label: String(n.label), protection: declared === null ? UNKNOWN_CLASS : protectionOf(String(declared)) });
        }
      }
      return rows.value.map((r): Observation => {
        const node = metricOfNode.get(String(r.node_id));
        const periodStart = r.period_start === null || r.period_start === undefined ? null : instant(r.period_start);
        const value = txt(r.numeric_value);
        return {
          id: `helm-observation:${r.id}`,
          system: 'helm',
          eventType: 'value.actual_observed',
          objectRef: helmValueRef(String(r.node_id), periodStart),
          entityRef: null,
          occurredAt: instant(r.observed_at ?? r.effective_at ?? r.recorded_at),
          payload: {
            metricKey: node?.key ?? null,
            value,
            unit: txt(r.unit_type),
            currency: txt(r.currency),
            periodStart,
            periodEnd: r.period_end === null || r.period_end === undefined ? null : instant(r.period_end),
            sourceSystem: txt(r.source_system),
          },
          summary: `${node?.label ?? 'Value'}: actual ${value ?? '—'}${r.unit_type === 'percentage' ? '%' : r.currency ? ` ${r.currency}` : ''} (${txt(r.source_system) ?? 'source'} actual, recorded by Helm)`,
          url: null,
          // A value whose class Forge could not read is treated as restricted in every compartment, never as general.
          protection: node?.protection ?? UNKNOWN_CLASS,
        };
      });
    },
  };
}
