/**
 * SYNTHETIC meeting notes for the controlled extraction test — no real person,
 * customer or figure. Each sentence that matters is labelled by hand: its class,
 * and, where it should become a candidate, who stands behind it, by when, and
 * what it waits on. Sentences that should NOT become candidates are labelled
 * too: that is where a model is most tempted to invent accountability.
 *
 * `quote` is a distinctive fragment of the sentence, enough to find it.
 */

const ROLE = (label) => ({ kind: 'ROLE', label, ref: null });
export const ROLES = {
  SCM: ROLE('Supply Chain Director (SYNTHETIC)'),
  LOG: ROLE('Logistics Manager (SYNTHETIC)'),
  FIN: ROLE('Finance Director (SYNTHETIC)'),
  COM: ROLE('Commercial Director (SYNTHETIC)'),
  PROC: ROLE('Procurement Manager (SYNTHETIC)'),
};

const parties = [
  { names: ['Minh Pham', 'Minh'], party: ROLES.SCM },
  { names: ['Quang Le', 'Quang'], party: ROLES.LOG },
  { names: ['An Vo', 'An'], party: ROLES.FIN },
  { names: ['Hoa Nguyen', 'Hoa'], party: ROLES.COM },
  { names: ['Thu Dang', 'Thu'], party: ROLES.PROC },
];
const entities = [
  { names: ['Distributor D'], entityRef: 'synthetic:distributor:d' },
  { names: ['Customer R', 'customer R'], entityRef: 'synthetic:customer:r' },
  { names: ['SKU-X'], entityRef: 'synthetic:sku:x' },
];

export const MEETINGS = [
  {
    input: {
      source: { kind: 'MEETING_NOTES', system: 'notes', ref: 'notes:synthetic-qc-review', label: 'QC review (SYNTHETIC)', heldOn: '2026-10-16' },
      text: [
        'QC review — warehouse, 16 October 2026 (SYNTHETIC)',
        'Attendees: Minh Pham, Quang Le, An Vo',
        '',
        '- Quang: Two units of SKU-X failed seal inspection after the transfer and are on hold.',
        '- An: We should look at whether the transfer cost covered re-labelling.',
        '- Minh: I will revise the transfer SOP to add a QC re-release step by 30 October.',
        '- Quang: I will re-inspect the two held units and release them by 23 October, once the replacement seals arrive.',
        '- An: Could you send me the re-labelling invoices?',
        '- Minh: I might ask Distributor D for their storage logs.',
        '- Agreed: no further transfers from Distributor D until the SOP is revised. Owner: Minh.',
      ].join('\n'),
      parties,
      entities,
    },
    gold: [
      { quote: 'failed seal inspection', class: 'DISCUSSION', candidate: false },
      { quote: 'We should look at whether the transfer cost', class: 'DISCUSSION', candidate: false },
      { quote: 'I will revise the transfer SOP', class: 'COMMITMENT', candidate: true, owner: ROLES.SCM.label, dueBy: '2026-10-30', dependencies: [] },
      { quote: 'I will re-inspect the two held units', class: 'COMMITMENT', candidate: true, owner: ROLES.LOG.label, dueBy: '2026-10-23', dependencies: ['replacement seals arrive'] },
      { quote: 'Could you send me the re-labelling invoices', class: 'REQUEST', candidate: false },
      { quote: 'I might ask Distributor D', class: 'INTENTION', candidate: false },
      { quote: 'no further transfers from Distributor D', class: 'DECISION', candidate: true, owner: ROLES.SCM.label, dueBy: null, dependencies: [] },
    ],
  },
  {
    input: {
      source: { kind: 'TRANSCRIPT', system: 'notes', ref: 'notes:synthetic-commercial-sync', label: 'Commercial sync (SYNTHETIC)', heldOn: '2026-10-19' },
      text: [
        'Hoa: Customer R wants a written installation plan before they sign off.',
        'Thu: Can I get the purchase order numbers from someone?',
        "Hoa: Thu, I'll send you the PO numbers by Wednesday.",
        "An: I'll try to get the margin bridge done by Friday, no promises.",
        'Hoa: Someone should probably call Customer R about the delay.',
        'Thu: Decided — we hold the current price until the end of the quarter.',
        "Hoa: OK. I commit to sending Customer R the installation plan by 24 October.",
        'An: Finance will need the final quantities to close the forecast.',
      ].join('\n'),
      parties,
      entities,
    },
    gold: [
      { quote: 'wants a written installation plan', class: 'DISCUSSION', candidate: false },
      { quote: 'Can I get the purchase order numbers', class: 'REQUEST', candidate: false },
      { quote: "I'll send you the PO numbers by Wednesday", class: 'COMMITMENT', candidate: true, owner: ROLES.COM.label, dueBy: '2026-10-21', dependencies: [] },
      { quote: "I'll try to get the margin bridge", class: 'INTENTION', candidate: false },
      { quote: 'Someone should probably call Customer R', class: 'DISCUSSION', candidate: false },
      // A decision with no one named to carry it out: governance must not invent an owner.
      { quote: 'we hold the current price', class: 'DECISION', candidate: false },
      { quote: 'I commit to sending Customer R the installation plan', class: 'COMMITMENT', candidate: true, owner: ROLES.COM.label, dueBy: '2026-10-24', dependencies: [] },
      { quote: 'Finance will need the final quantities', class: 'DISCUSSION', candidate: false },
    ],
  },
];
