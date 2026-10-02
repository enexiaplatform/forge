import { createForgeRuntime, createInMemoryStore, manualClock, sequentialIds, unwrap } from '../src/index.ts';

export const ORG = 'org-meridian';

export const party = (label, kind = 'ROLE') => ({ kind, label, ref: null });

export const GM = party('Country GM Vietnam');
export const SCM = party('Supply Chain Director Vietnam');
export const FIN = party('Finance Director Vietnam');

export function person(label, actsAs, role = 'member', kind = 'PERSON') {
  return { orgId: ORG, actor: { kind, id: label.toLowerCase().replace(/\s+/g, '-'), label }, role, actsAs };
}

export const gm = person('Linh Tran', [GM], 'manager');
export const scm = person('Minh Pham', [SCM]);
export const fin = person('An Vo', [FIN]);
export const outsider = person('Bao Ng', [party('Regional HR')]);
export const agent = { orgId: ORG, actor: { kind: 'AGENT', id: 'forge-reference-rules@1', label: 'Forge inference' }, role: 'member', actsAs: [] };
export const connector = (system) => ({ orgId: ORG, actor: { kind: 'SYSTEM', id: `${system}-connector`, label: `${system} connector` }, role: 'member', actsAs: [] });

export function setup(start = '2026-09-25T09:00:00.000Z') {
  const clock = manualClock(start);
  const store = createInMemoryStore(clock);
  const runtime = createForgeRuntime({ store, clock, ids: sequentialIds() });
  return { clock, store, runtime };
}

export const transferTerms = (overrides = {}) => ({
  statement: 'Recall and transfer eight consignment units from Distributor D to HCMC',
  intendedOutcome: 'Eight units of SKU-X are in the HCMC warehouse, free to ship to Rohto',
  why: 'Own stock does not cover the Rohto order; management chose to reallocate consignment stock.',
  owner: SCM,
  principal: GM,
  dueBy: '2026-10-02',
  evidence: [
    {
      key: 'transfer-received',
      level: 'OUTPUT',
      description: 'Stock transfer of 8 units received at HCMC',
      required: true,
      matcher: { system: 'scm', eventType: 'stock_transfer.received', objectRef: 'TR-0412', where: { quantity: 8 } },
    },
  ],
  measures: [],
  value: [],
  ...overrides,
});

export const helmOrigin = {
  kind: 'DECISION',
  system: 'helm',
  ref: 'helm:decision-commitment:dcm-rohto-q4',
  label: 'Rohto Q4 order fulfilment',
  fingerprint: 'dfp_demo',
  snapshot: { assumptions: [{ statement: 'Distributor D releases within five working days', owner: null }] },
};

export async function proposedTransfer(env, capture = { evidence: 'INFERRED', statement: 'INHERITED' }) {
  return unwrap(await env.runtime.propose(gm, { origin: helmOrigin, terms: transferTerms(), capture }));
}

export const systemFact = (requirementKey, ref, statement, observedAt, stance = 'SUPPORTS', system = 'scm') => ({
  requirementKey,
  stance,
  epistemic: 'FACT',
  channel: 'SYSTEM_EVENT',
  source: { system, ref, url: null },
  statement,
  observedAt,
  confidence: null,
  observationId: `obs-${ref}-${observedAt}`,
});
