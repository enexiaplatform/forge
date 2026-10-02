/**
 * Inference — the part of Forge that guesses, and says so (§20).
 *
 * An `InferenceProvider` proposes what nobody has stated yet: what would prove
 * an action intent done, what outcome it serves, which value dimension a
 * metric speaks to. Every proposal comes back as an INFERENCE with the rule or
 * model that produced it; nothing it returns is recorded as a fact. The owner
 * confirms it by accepting the commitment, or changes it.
 *
 * `referenceRules` is deterministic and offline: a small catalogue keyed on the
 * system Helm named and the verb in the intent. A language-model provider is
 * the same port, composed at the edge; it has not been wired in.
 */

import type { EvidenceRequirement, Statement, ValueDimension } from '@forge/kernel';
import type { HelmActionIntent, HelmExpectedOutcome } from './helm.ts';

export type InferredEvidence = {
  readonly requirements: readonly EvidenceRequirement[];
  readonly intendedOutcome: string | null;
  readonly note: Statement;
};

export interface InferenceProvider {
  readonly name: string;
  evidenceForIntent(intent: HelmActionIntent): InferredEvidence;
  dimensionForMetric(metricKey: string): ValueDimension | null;
}

type Rule = {
  readonly system: string;
  readonly verbs: RegExp;
  readonly level: EvidenceRequirement['level'];
  readonly eventType: string;
  readonly describe: (intent: HelmActionIntent) => string;
  readonly outcome: (intent: HelmActionIntent) => string;
};

const RULES: readonly Rule[] = [
  {
    system: 'scm',
    verbs: /\b(transfer|recall|move|relocate|reallocate)\b/i,
    level: 'OUTPUT',
    eventType: 'stock_transfer.received',
    describe: () => 'Stock transfer received at its destination (SCM)',
    outcome: () => 'The stock is at its destination, received and free to use.',
  },
  {
    system: 'memoire',
    verbs: /\b(confirm|agree|align|secure)\b/i,
    level: 'OUTPUT',
    eventType: 'customer_confirmation.recorded',
    describe: () => 'Customer confirmation recorded in Memoire',
    outcome: () => 'The customer has confirmed it, on the record.',
  },
  {
    system: 'finance',
    verbs: /\b(update|reforecast|forecast|revise|book)\b/i,
    level: 'OUTPUT',
    eventType: 'forecast.version_published',
    describe: () => 'A forecast version reflecting the change is published (Finance)',
    outcome: () => 'Finance’s published numbers reflect the decision.',
  },
  {
    system: 'erp',
    verbs: /\b(ship|deliver|dispatch)\b/i,
    level: 'OUTCOME',
    eventType: 'delivery.confirmed',
    describe: () => 'Delivery confirmed in the ERP',
    outcome: () => 'The customer has the goods.',
  },
  {
    system: 'erp',
    verbs: /\b(order|purchase|procure|replenish)\b/i,
    level: 'OUTPUT',
    eventType: 'purchase_order.confirmed',
    describe: () => 'Purchase order confirmed by the supplier (ERP)',
    outcome: () => 'Supply is on order and confirmed by the supplier.',
  },
  {
    system: 'hris',
    verbs: /\b(hire|appoint|recruit|onboard)\b/i,
    level: 'OUTCOME',
    eventType: 'employee.activated',
    describe: () => 'Employee activated in the HRIS',
    outcome: () => 'The person is in post.',
  },
];

const METRIC_DIMENSIONS: Readonly<Record<string, ValueDimension>> = {
  GrossMarginPct: 'MARGIN',
  GrossMargin: 'MARGIN',
  Revenue: 'REVENUE',
  CashImpact: 'CASH',
  DemandCoverage: 'CUSTOMER',
  ServiceLevel: 'CUSTOMER',
  AvailableInventory: 'RESILIENCE',
};

export const referenceRules: InferenceProvider = {
  name: 'forge-reference-rules@1',
  evidenceForIntent(intent) {
    const slug = intent.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const rule = RULES.find((r) => r.system === intent.targetSystem && r.verbs.test(intent.title));
    if (!rule) {
      return {
        requirements: [
          {
            key: `${slug}-confirmed`,
            level: 'OUTPUT',
            description: `${intent.ownerLabel} confirms it is done`,
            required: true,
            matcher: null,
          },
        ],
        intendedOutcome: null,
        note: {
          class: 'INFERENCE',
          text: `No system Forge observes records this kind of work (${intent.targetSystem}); only a person’s confirmation can prove it. forge-reference-rules@1.`,
          basis: [intent.id],
        },
      };
    }
    return {
      requirements: [
        {
          key: `${slug}-${rule.eventType.split('.')[0].replace(/_/g, '-')}`,
          level: rule.level,
          description: rule.describe(intent),
          required: true,
          matcher: { system: rule.system, eventType: rule.eventType, objectRef: null, where: {} },
        },
      ],
      intendedOutcome: rule.outcome(intent),
      note: {
        class: 'INFERENCE',
        text: `Helm names ${intent.targetSystem} as where this happens, and the intent reads as “${intent.title.match(rule.verbs)?.[0]?.toLowerCase()}”: a ${rule.eventType} record there would prove it. forge-reference-rules@1 — confirm or change it when you accept.`,
        basis: [intent.id],
      },
    };
  },
  dimensionForMetric(metricKey) {
    return METRIC_DIMENSIONS[metricKey] ?? null;
  },
};

/** Expected-outcome measures speak to a dimension; a qualitative one about a relationship speaks to the customer. */
export function dimensionForOutcome(provider: InferenceProvider, o: HelmExpectedOutcome): ValueDimension | null {
  if (o.metricKey) return provider.dimensionForMetric(o.metricKey);
  return /\b(customer|relationship|framework|account)\b/i.test(`${o.label} ${o.statement ?? ''}`) ? 'CUSTOMER' : null;
}
