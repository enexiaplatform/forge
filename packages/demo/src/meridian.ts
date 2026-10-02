/**
 * DEMO — Meridian Life Sciences Vietnam, after the decision.
 *
 * Helm's canonical story ends with management committing to reallocate
 * Distributor D's consignment stock to serve Rohto's Q4 order (Helm's
 * packages/decision-runtime/src/meridianDecision.ts). This file is what Forge
 * reads of that commitment — the same question, summary, rationale, accepted
 * trade-offs, expected outcomes, review triggers and action intents — and what
 * the enterprise's own systems record as the work is done.
 *
 * A second decision, rebuilding the distributor buffer the first one spent, is
 * a Forge demo addition and is not in Helm's story. Every object here is
 * fictional and labelled DEMO; nothing is written anywhere.
 */

import type { Party, Protection, Scope } from '@forge/kernel';
import { type ExtractionInput, type HelmCommittedDecision, helmValueRef, type MemoireOpportunity, type MemoirePromise, type Observation, type PartyDirectory } from '@forge/fabric';

export const DEMO_ORG = 'org-meridian-vn-demo';

const role = (label: string): Party => ({ kind: 'ROLE', label, ref: null });

export const ROLES = {
  GM: role('Country GM Vietnam'),
  SCM: role('Supply Chain Director Vietnam'),
  COM: role('Commercial Director Vietnam'),
  FIN: role('Finance Director Vietnam'),
  LOG: role('Logistics Manager HCMC'),
  PROC: role('Procurement Manager Vietnam'),
} as const;

export type DemoPerson = { readonly key: string; readonly name: string; readonly title: string; readonly scope: Scope };

/** Helm's class for margin and cash (Helm ADR-0025). Only people Helm has cleared read those values — in Forge too. */
export const FINANCIAL: Protection = ['FINANCIAL_SENSITIVE'];

const person = (key: string, name: string, r: Party, level: Scope['role'] = 'member', clearances: Protection = []): DemoPerson => ({
  key,
  name,
  title: r.label,
  scope: { orgId: DEMO_ORG, actor: { kind: 'PERSON', id: `demo-${key}`, label: `${name}, ${r.label}` }, role: level, actsAs: [r], clearances },
});

/** DEMO clearances: the Country GM and Finance are cleared for financial values; nobody else is. */
export const PEOPLE = {
  gm: person('gm', 'Linh Tran', ROLES.GM, 'manager', FINANCIAL),
  scm: person('scm', 'Minh Pham', ROLES.SCM),
  com: person('com', 'Hoa Nguyen', ROLES.COM),
  fin: person('fin', 'An Vo', ROLES.FIN, 'member', FINANCIAL),
  log: person('log', 'Quang Le', ROLES.LOG),
  proc: person('proc', 'Thu Dang', ROLES.PROC),
} as const;

export type PersonKey = keyof typeof PEOPLE;

// ------------------------------------------------------------------- Helm

/** The value nodes Helm's committed future names — in Helm, rows of helm_value_nodes. */
export const NODES = {
  marginRohto: 'node-grossmarginpct-rohto',
  coverage: 'node-demandcoverage-vn',
  cashRohto: 'node-cashimpact-rohto',
  bufferD: 'node-availableinventory-distributor-d',
} as const;
const Q4_2026 = { start: '2026-10-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z', grain: 'QUARTER' };
const NOV_2026 = { start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z', grain: 'MONTH' };

export const ROHTO_DECISION: HelmCommittedDecision = {
  decision: {
    id: 'dec-rohto-q4',
    title: 'Rohto Q4 order fulfilment',
    managementQuestion: 'How should Meridian fulfil the Rohto order while balancing service, margin, cash and future inventory optionality?',
    context:
      'Rohto Vietnam has a 4.2B VND Q4 tender at 70% probability. Serving it needs twelve units of SKU-X; four are in the HCMC warehouse and eight sit as consignment stock at Distributor D. A provincial tender in the same quarter draws on the same stock.',
    scope: 'Vietnam · SKU-X · 2026-Q4',
    owner: { label: 'Country GM Vietnam', userId: null },
    horizon: { decisionDeadline: '2026-09-30', effectiveFrom: '2026-10-01', expectedOutcomeHorizon: '2026-12-31', reviewDate: '2026-10-23' },
    objectives: ['Serve the Rohto commitment', 'Protect gross margin in the quarter', 'Keep the option to serve the provincial tender'],
    reversibility: 'PARTIALLY_REVERSIBLE',
    triggerRefs: [
      { kind: 'OPPORTUNITY', ref: 'rohto-q4-tender', label: 'Rohto Q4 tender' },
      { kind: 'METRIC', ref: 'InventoryGap', label: 'Inventory gap 8.385714 units' },
    ],
  },
  commitment: {
    id: 'dcm-rohto-q4',
    revisionId: 'drv-rohto-q4-1',
    fingerprint: 'dfp_demo7d2e91a04c5b3f18',
    committedBy: { label: 'Country GM Vietnam', userId: null },
    committedAt: '2026-09-25T08:00:00.000Z',
    summary: 'Reallocate Distributor D’s consignment stock to serve the Rohto order in Q4, accepting that the distributor buffer goes to zero.',
    chosenAlternative: { id: 'alt-reallocate', label: 'B — Reallocate distributor stock' },
    rationale: [
      { kind: 'CRITERION', label: 'Customer service', statement: 'Reallocation reaches the same modelled coverage as expediting (96.8858%), above the 90% policy line.' },
      { kind: 'SCENARIO_DELTA', label: 'Gross margin %', statement: '32.3878% against 30.517% for expediting — 1.8708 points more margin for the same service.' },
      { kind: 'SCENARIO_DELTA', label: 'Cash impact', statement: '−1 735 500 000 VND against −1 790 500 000 for expediting: 55 000 000 less cash tied up.' },
      { kind: 'JUDGEMENT', label: 'Why not D — Delay', statement: 'Delay moves the revenue out of the quarter entirely and misses a date Rohto has confirmed is a condition of the award.' },
      { kind: 'JUDGEMENT', label: 'Why not C — Alternative analyzer', statement: 'Margin falls to 22.9048% and the substitution re-opens a technical evaluation already won.' },
      { kind: 'ASSUMPTION', label: 'What this rests on', statement: 'Distributor D releasing its eight consignment units (Commercial Director Vietnam, confidence 0.75).' },
    ],
    acceptedTradeOffs: [
      { label: 'Distributor buffer', statement: 'Distributor D’s buffer drops to zero. A second urgent order in the quarter would have no consignment stock behind it.' },
      { label: 'Transfer cost is not fully quoted', statement: 'Finance’s challenge stays open: the 25M transfer cost excludes re-labelling, so the cash impact may be understated.' },
    ],
    expectedOutcomes: [
      { label: 'Gross margin %', kind: 'MODELLED', nodeId: NODES.marginRohto, metricKey: 'GrossMarginPct', period: Q4_2026, expectedValue: '32.3878', unit: 'percentage', currency: null, statement: null, betterWhen: 'HIGHER', sensitivity: FINANCIAL },
      { label: 'Customer service', kind: 'MODELLED', nodeId: NODES.coverage, metricKey: 'DemandCoverage', period: Q4_2026, expectedValue: '96.8858', unit: 'percentage', currency: null, statement: null, betterWhen: 'HIGHER' },
      { label: 'Cash impact', kind: 'MODELLED', nodeId: NODES.cashRohto, metricKey: 'CashImpact', period: Q4_2026, expectedValue: '-1735500000', unit: 'currency', currency: 'VND', statement: null, betterWhen: 'HIGHER', sensitivity: FINANCIAL },
      {
        label: 'Framework relationship',
        kind: 'QUALITATIVE',
        nodeId: null,
        metricKey: null,
        period: null,
        expectedValue: null,
        unit: null,
        currency: null,
        statement: 'Rohto sees the committed date met in full; the framework renewal conversation is unaffected.',
        betterWhen: null,
      },
    ],
    reviewTriggers: [
      { key: 'margin-below-30', description: 'Gross margin on the Rohto order falls below 30%.', kind: 'METRIC_THRESHOLD', metricKey: 'GrossMarginPct', comparator: 'BELOW', threshold: '30', byDate: null },
      { key: 'distributor-release-slips', description: 'Distributor D has not released the units within five working days.', kind: 'EVENT', metricKey: null, comparator: null, threshold: null, byDate: null },
      { key: 'thirty-day-review', description: 'Review thirty days after the commitment regardless of what happens.', kind: 'DATE', metricKey: null, comparator: null, threshold: null, byDate: '2026-10-23' },
    ],
  },
  actionIntents: [
    {
      id: 'act-transfer',
      title: 'Recall and transfer eight consignment units from Distributor D to HCMC',
      detail: 'Five working days notice under the consignment agreement.',
      ownerLabel: 'Supply Chain Director Vietnam',
      ownerUserId: null,
      dueDate: '2026-10-02',
      targetSystem: 'scm',
    },
    {
      id: 'act-confirm-date',
      title: 'Confirm the delivery date with Rohto procurement',
      detail: 'HELM records the intent; the customer conversation happens in Memoire.',
      ownerLabel: 'Commercial Director Vietnam',
      ownerUserId: null,
      dueDate: '2026-09-26',
      targetSystem: 'memoire',
    },
    {
      id: 'act-forecast',
      title: 'Update the quarter inventory exposure and cash forecast',
      detail: 'Reflect the transfer cost and the reduced consignment position.',
      ownerLabel: 'Finance Director Vietnam',
      ownerUserId: null,
      dueDate: '2026-10-05',
      targetSystem: 'finance',
    },
  ],
  assumptions: [
    { statement: 'Distributor D will release its eight consignment units for the quarter.', ownerLabel: 'Commercial Director Vietnam', criticality: 'CRITICAL' },
    { statement: 'The provincial tender remains material this quarter.', ownerLabel: 'Commercial Director Vietnam', criticality: 'MATERIAL' },
    { statement: 'Rohto treats on-time delivery of this order as a condition of the annual framework agreement.', ownerLabel: null, criticality: 'CRITICAL' },
  ],
  demo: true,
};

export const BUFFER_DECISION: HelmCommittedDecision = {
  decision: {
    id: 'dec-buffer-rebuild',
    title: 'Distributor D buffer rebuild',
    managementQuestion: 'How should Meridian restore the inventory optionality it gave up to serve Rohto?',
    context:
      'Serving Rohto took Distributor D’s consignment buffer to zero. The provincial tender is still on the shortlist, and Supplier A quotes 21 days at standard freight.',
    scope: 'Vietnam · SKU-X · 2026-Q4',
    owner: { label: 'Country GM Vietnam', userId: null },
    horizon: { decisionDeadline: '2026-09-30', effectiveFrom: '2026-10-01', expectedOutcomeHorizon: '2026-11-30', reviewDate: '2026-11-06' },
    objectives: ['Restore consignment cover at Distributor D', 'Keep the provincial tender servable'],
    reversibility: 'REVERSIBLE',
    triggerRefs: [{ kind: 'METRIC', ref: 'AvailableInventory', label: 'Distributor D buffer 0 units' }],
  },
  commitment: {
    id: 'dcm-buffer-rebuild',
    revisionId: 'drv-buffer-rebuild-1',
    fingerprint: 'dfp_demo3b81c07e55a2d964',
    committedBy: { label: 'Country GM Vietnam', userId: null },
    committedAt: '2026-09-30T08:00:00.000Z',
    summary: 'Replenish eight units of SKU-X from Supplier A at standard freight and restore Distributor D’s consignment buffer by 30 November.',
    chosenAlternative: { id: 'alt-standard-replenish', label: 'A — Standard-freight replenishment' },
    rationale: [
      { kind: 'SCENARIO_DELTA', label: 'Available inventory', statement: 'Eight units back at Distributor D before the provincial tender is expected to award.' },
      { kind: 'JUDGEMENT', label: 'Why not air freight', statement: 'Nothing is due before December; paying air freight would buy time nobody needs.' },
    ],
    acceptedTradeOffs: [{ label: 'Six exposed weeks', statement: 'Until the units arrive, an urgent second order would again have nothing behind it.' }],
    expectedOutcomes: [
      { label: 'Available inventory', kind: 'MODELLED', nodeId: NODES.bufferD, metricKey: 'AvailableInventory', period: NOV_2026, expectedValue: '8', unit: 'units', currency: null, statement: null, betterWhen: 'HIGHER' },
      { label: 'Tender readiness', kind: 'QUALITATIVE', nodeId: null, metricKey: null, period: null, expectedValue: null, unit: null, currency: null, statement: 'The provincial tender can be served from consignment stock if it is awarded.', betterWhen: null },
    ],
    reviewTriggers: [],
  },
  actionIntents: [
    {
      id: 'act-replenish-po',
      title: 'Place a replenishment order for eight units of SKU-X with Supplier A',
      detail: 'Standard freight; Supplier A quotes 21 days.',
      ownerLabel: 'Procurement Manager Vietnam',
      ownerUserId: null,
      dueDate: '2026-10-07',
      targetSystem: 'erp',
    },
    {
      id: 'act-consignment-terms',
      title: 'Agree the restored consignment terms with Distributor D',
      detail: 'Same terms as the current agreement; recall notice to be shortened if Distributor D accepts.',
      ownerLabel: 'Commercial Director Vietnam',
      ownerUserId: null,
      dueDate: '2026-10-15',
      targetSystem: 'manual',
    },
    {
      id: 'act-return-stock',
      title: 'Transfer eight units back to Distributor D on consignment',
      detail: '',
      ownerLabel: 'Supply Chain Director Vietnam',
      ownerUserId: null,
      dueDate: null,
      targetSystem: 'scm',
    },
  ],
  assumptions: [{ statement: 'Supplier A holds its 21-day standard lead time.', ownerLabel: 'Procurement Manager Vietnam', criticality: 'MATERIAL' }],
  demo: true,
};

export const HELM_DECISIONS: readonly HelmCommittedDecision[] = [ROHTO_DECISION, BUFFER_DECISION];

// ---------------------------------------------------------------- Memoire

export const MEMOIRE_OPPORTUNITIES: readonly MemoireOpportunity[] = [
  {
    id: 'rohto-q4-tender',
    name: 'Rohto Q4 tender',
    accountId: 'rohto-vn',
    accountName: 'Rohto Vietnam',
    value: '4200000000',
    currency: 'VND',
    probability: '70',
    stage: 'Negotiation',
    expectedClose: '2026-10-25',
  },
];

/**
 * Hoa Nguyen's promises in Memoire, as Commercial API v1 returns them — one entry per version, so the fixture
 * serves each promise as Memoire held it at the demo's moment. Only the first is something the enterprise owes,
 * with a person and a date: it is the one Forge proposes as an obligation.
 */
export const MEMOIRE_PROMISES: readonly MemoirePromise[] = [
  { id: 'cmt-rohto-install-plan', accountId: 'rohto-vn', opportunityId: 'rohto-q4-tender', party: 'self', responsiblePerson: 'Hoa Nguyen', promise: 'Send Rohto a written installation plan for the twelve analyzers', dueDate: '2026-10-09', status: 'open', updatedAt: '2026-09-25T15:00:00.000Z' },
  { id: 'cmt-rohto-site-ready', accountId: 'rohto-vn', opportunityId: 'rohto-q4-tender', party: 'customer', responsiblePerson: 'Rohto procurement', promise: 'Rohto confirms the HCMC site is ready for installation', dueDate: '2026-10-12', status: 'open', updatedAt: '2026-09-25T15:05:00.000Z' },
  { id: 'cmt-rohto-service-schedule', accountId: 'rohto-vn', opportunityId: 'rohto-q4-tender', party: 'self', responsiblePerson: 'Hoa Nguyen', promise: 'Share the revised service schedule with Rohto', dueDate: null, status: 'open', updatedAt: '2026-09-25T15:10:00.000Z' },
  { id: 'cmt-rohto-install-plan', accountId: 'rohto-vn', opportunityId: 'rohto-q4-tender', party: 'self', responsiblePerson: 'Hoa Nguyen', promise: 'Send Rohto a written installation plan for the twelve analyzers', dueDate: '2026-10-09', status: 'completed', updatedAt: '2026-10-05T10:00:00.000Z' },
  { id: 'cmt-rohto-site-ready', accountId: 'rohto-vn', opportunityId: 'rohto-q4-tender', party: 'customer', responsiblePerson: 'Rohto procurement', promise: 'Rohto confirms the HCMC site is ready for installation', dueDate: '2026-10-12', status: 'completed', updatedAt: '2026-10-12T04:00:00.000Z' },
];

/** Who Memoire's responsible-person text names, in Forge's terms. */
export const MEMOIRE_DIRECTORY: PartyDirectory = [{ matches: 'Hoa Nguyen', party: ROLES.COM }];

// ------------------------------------------------------- meeting notes

/** The QC hold review, as Quang typed it up. Forge reads it for candidates; people decide. */
export const QC_REVIEW_NOTES: ExtractionInput = {
  source: { kind: 'MEETING_NOTES', system: 'notes', ref: 'notes:qc-hold-review-2026-10-16', label: 'QC hold review, HCMC — 16 Oct', heldOn: '2026-10-16' },
  text: [
    'QC hold review — HCMC warehouse, 16 October 2026',
    'Attendees: Minh Pham, Quang Le, Linh Tran',
    '',
    '- Quang: Two units of SKU-X failed seal inspection after the transfer and are on QC hold.',
    '- Linh: We should look at why transferred consignment stock is treated as shippable on receipt.',
    '- Minh: I will revise the transfer SOP to add a QC re-release step by 30 October.',
    '- Quang: I will re-inspect the two held units and release them by 23 October.',
    '- Linh: Could you check whether the seal failures are batch-related?',
    '- Minh: I might ask Distributor D for their storage logs.',
  ].join('\n'),
  parties: [
    { names: ['Minh Pham', 'Minh'], party: ROLES.SCM },
    { names: ['Quang Le', 'Quang'], party: ROLES.LOG },
    { names: ['Linh Tran', 'Linh'], party: ROLES.GM },
  ],
  entities: [
    { names: ['Distributor D'], entityRef: 'scm:distributor:distributor-d' },
    { names: ['SKU-X'], entityRef: 'erp:sku:SKU-X' },
  ],
};

/** The Rohto outcome review, 20 November (DEMO). Forge reads it for explanations and lessons a person may record. */
export const OUTCOME_REVIEW_NOTES = {
  source: { kind: 'MEETING_NOTES' as const, system: 'notes', ref: 'notes:rohto-outcome-review-2026-11-20', label: 'Rohto outcome review — 20 Nov (DEMO)', heldOn: '2026-11-20' },
  text: [
    'Rohto outcome review — 20 November 2026',
    'Attendees: Linh Tran, Minh Pham, An Vo, Hoa Nguyen',
    '',
    '- An: Margin landed under the committed future because re-labelling and QC rework were not in the transfer cost Helm modelled.',
    '- Minh: The two late units were held because consignment stock coming back from a distributor needs a QC re-release; the plan treated it as shippable on receipt.',
    '- Hoa: Rohto raised the late units at the renewal meeting but did not make them a condition of the framework.',
    '- Minh: Next time we reallocate consignment stock, plan two to four working days of QC re-release before the customer date.',
    '- An: Going forward, quote re-labelling in the transfer cost for every reallocation of consignment stock.',
    '- Linh: Thanks all for getting the twelve units there.',
  ].join('\n'),
};

// ----------------------------------------------------- execution surfaces

const ROHTO_OPP = 'memoire:opportunity:rohto-q4-tender';

const obs = (
  id: string,
  system: string,
  eventType: string,
  objectRef: string,
  occurredAt: string,
  payload: Observation['payload'],
  summary: string,
  entityRef: string | null = null,
  protection: Protection = [],
): Observation => ({ id, system, eventType, objectRef, entityRef, occurredAt, payload, summary, url: null, protection });

export const SURFACES: readonly { readonly system: string; readonly label: string; readonly describes: string; readonly observations: readonly Observation[] }[] = [
  {
    system: 'memoire',
    label: 'Memoire',
    describes: 'Commercial execution: customer conversations, confirmations, opportunities.',
    observations: [
      obs('mem-4471', 'memoire', 'customer_confirmation.recorded', ROHTO_OPP, '2026-09-26T08:30:00.000Z', { subject: 'delivery-date', confirmedDate: '2026-10-15' },
        'Rohto procurement confirmed delivery on 15 Oct — logged by the Commercial Director', ROHTO_OPP),
      obs('mem-5102', 'memoire', 'opportunity.created', 'memoire:opportunity:rohto-framework-2027', '2026-11-18T03:00:00.000Z', { accountId: 'rohto-vn', value: 18000000000 },
        'Rohto framework renewal 2027 opened (18B VND)', 'memoire:account:rohto-vn'),
    ],
  },
  {
    system: 'scm',
    label: 'Supply chain (SCM)',
    describes: 'Consignment releases and stock transfers between locations.',
    observations: [
      obs('scm-9120', 'scm', 'consignment.released', 'CR-D-0925', '2026-10-02T10:00:00.000Z', { units: 8, partner: 'Distributor D' },
        'Distributor D released 8 consignment units of SKU-X (release CR-D-0925)'),
      obs('scm-9188', 'scm', 'stock_transfer.received', 'TR-0412', '2026-10-06T06:30:00.000Z', { quantity: 8, location: 'HCMC' },
        'Transfer TR-0412: 8 units of SKU-X received at HCMC'),
    ],
  },
  {
    system: 'finance',
    label: 'Finance',
    describes: 'Forecast versions and their published assumptions.',
    observations: [
      obs('fin-310', 'finance', 'forecast.version_published', 'FC-2026-10', '2026-10-03T07:00:00.000Z', { includesTransferCost: true, period: '2026-Q4' },
        'Q4 forecast FC-2026-10 published, including the 25M VND transfer cost and the reduced consignment position'),
    ],
  },
  {
    system: 'jira',
    label: 'Delivery tracker',
    describes: 'The logistics team’s own epics and issues. Read as activity, never as evidence.',
    observations: [
      obs('jira-88-a', 'jira', 'epic.progress', 'LOG-88', '2026-09-30T10:00:00.000Z', { done: 3, total: 14, unit: 'issues' }, 'LOG-88 Rohto Q4 delivery: 3 of 14 issues done'),
      obs('jira-88-b', 'jira', 'epic.progress', 'LOG-88', '2026-10-06T10:00:00.000Z', { done: 9, total: 14, unit: 'issues' }, 'LOG-88 Rohto Q4 delivery: 9 of 14 issues done'),
      obs('jira-88-c', 'jira', 'epic.progress', 'LOG-88', '2026-10-14T10:00:00.000Z', { done: 14, total: 14, unit: 'issues' }, 'LOG-88 Rohto Q4 delivery: 14 of 14 issues done'),
    ],
  },
  {
    system: 'wms',
    label: 'Warehouse (WMS)',
    describes: 'Picking, goods issue and quality holds in the HCMC warehouse.',
    observations: [
      obs('wms-7702', 'wms', 'goods_issue.posted', 'DO-5520', '2026-10-14T09:00:00.000Z', { quantity: 12 }, 'Delivery order DO-5520: 12 units of SKU-X picked and issued from HCMC'),
      obs('wms-7731', 'wms', 'qc_hold.recorded', 'QC-1107', '2026-10-15T02:00:00.000Z', { quantity: 2, sku: 'SKU-X' }, 'QC hold QC-1107: 2 units of SKU-X held at the dock — transfer seal inspection failed'),
    ],
  },
  {
    system: 'erp',
    label: 'ERP',
    describes: 'Sales orders, proofs of delivery and purchase orders.',
    observations: [
      obs('erp-55201', 'erp', 'delivery.confirmed', 'SO-5520', '2026-10-15T09:00:00.000Z', { quantity: 10, cumulativeQuantity: 10 },
        'SO-5520: proof of delivery for 10 of 12 units at Rohto HCMC'),
      obs('erp-55219', 'erp', 'delivery.confirmed', 'SO-5520', '2026-10-24T07:00:00.000Z', { quantity: 2, cumulativeQuantity: 12 },
        'SO-5520: proof of delivery for the remaining 2 units — 12 of 12 delivered'),
    ],
  },
  {
    system: 'helm',
    label: 'Helm value graph',
    describes: 'Source actuals Helm ingests and observes against its metrics — read back as outcome evidence.',
    observations: [
      obs('hv-gm-q4', 'helm', 'value.actual_observed', helmValueRef(NODES.marginRohto, Q4_2026.start), '2026-11-18T08:00:00.000Z',
        { metricKey: 'GrossMarginPct', subject: 'Rohto', period: '2026-Q4', value: '31.421' }, 'Actual gross margin on the Rohto order, 2026-Q4: 31.421% (finance source actual)', null, FINANCIAL),
      obs('hv-cov-q4', 'helm', 'value.actual_observed', helmValueRef(NODES.coverage, Q4_2026.start), '2026-11-18T08:00:00.000Z',
        { metricKey: 'DemandCoverage', period: '2026-Q4', value: '100' }, 'Actual demand coverage, 2026-Q4: 100% (SCM source actual)'),
      obs('hv-cash-q4', 'helm', 'value.actual_observed', helmValueRef(NODES.cashRohto, Q4_2026.start), '2026-11-18T08:00:00.000Z',
        { metricKey: 'CashImpact', subject: 'Rohto', period: '2026-Q4', value: '-1768300000' }, 'Actual cash impact of the Rohto order, 2026-Q4: −1 768 300 000 VND (finance source actual)', null, FINANCIAL),
    ],
  },
];
