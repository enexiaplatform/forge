/**
 * The controlled extraction test's instrument, apart from its command line: run extractors over SYNTHETIC meetings,
 * score each governed reading against the hand-labelled gold, play the person's Confirm / Edit / Dismiss through
 * Forge's runtime, and compare every extractor with the deterministic reference. Tested with a stand-in model
 * (server/test/extractionEval.test.mjs) so a live run measures the model, not the instrument.
 */
import { createForgeRuntime, createInMemoryCandidateStore, createInMemoryStore, manualClock, sequentialIds } from '@forge/kernel';
import { extractCandidates, referenceExtractor } from '@forge/fabric';
import { ROLES } from './goldMeetings.mjs';

const norm = (s) => String(s ?? '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
export const goldFor = (meeting, quote) => meeting.gold.find((g) => norm(quote).includes(norm(g.quote)) || norm(g.quote).includes(norm(quote))) ?? null;

async function run(extractor, meeting) {
  const read = await extractCandidates(extractor, meeting.input);
  if (!read.ok) return { error: `${read.error.code}: ${read.error.message}` };
  return { read: read.value };
}

/** Score one extractor's governed reading of one meeting against the gold. */
export function score(meeting, read) {
  const s = { correct: [], falseCommitments: [], missed: [], unsupportedOwner: [], unsupportedDate: [], missedDate: [], hallucinatedDependencies: [], classificationErrors: [], removedByGovernance: read.removed.map((r) => r.quote) };
  for (const f of read.findings) {
    const g = goldFor(meeting, f.quote);
    if (g && g.class !== f.class) s.classificationErrors.push({ quote: f.quote, said: f.class, gold: g.class });
  }
  for (const c of read.candidates) {
    const g = goldFor(meeting, c.source.quote);
    if (!g || !g.candidate) {
      s.falseCommitments.push({ quote: c.source.quote, class: c.utteranceClass, owner: c.proposal.owner?.label ?? c.proposal.ownerText });
      continue;
    }
    s.correct.push(c.source.quote);
    if ((c.proposal.owner?.label ?? null) !== g.owner) s.unsupportedOwner.push({ quote: c.source.quote, proposed: c.proposal.owner?.label ?? `“${c.proposal.ownerText}” (unmatched)`, gold: g.owner });
    if (c.proposal.dueBy !== null && c.proposal.dueBy !== g.dueBy) s.unsupportedDate.push({ quote: c.source.quote, proposed: c.proposal.dueBy, gold: g.dueBy });
    if (c.proposal.dueBy === null && g.dueBy !== null) s.missedDate.push({ quote: c.source.quote, gold: g.dueBy, dueText: c.proposal.dueText });
    for (const d of c.proposal.dependencies) {
      const words = norm(d).split(' ').filter((w) => w.length > 3);
      const supported = words.length > 0 && words.every((w) => norm(c.source.quote).includes(w));
      if (!supported) s.hallucinatedDependencies.push({ quote: c.source.quote, dependency: d });
    }
  }
  for (const g of meeting.gold.filter((x) => x.candidate)) {
    if (!read.candidates.some((c) => goldFor(meeting, c.source.quote) === g)) s.missed.push(g.quote);
  }
  return s;
}

/** The human step, through Forge's runtime: confirm what is right, edit what is nearly right, dismiss the rest. */
export async function playPerson(meeting, read) {
  const clock = manualClock(`${meeting.input.source.heldOn}T12:00:00.000Z`);
  const runtime = createForgeRuntime({ store: createInMemoryStore(clock), candidates: createInMemoryCandidateStore(clock), clock, ids: sequentialIds() });
  const person = { orgId: 'org-synthetic', actor: { kind: 'PERSON', id: 'reviewer', label: 'Reviewer (SYNTHETIC)' }, role: 'member', actsAs: [ROLES.SCM] };
  const suggested = await runtime.suggestCandidates({ ...person, actor: { kind: 'AGENT', id: 'extractor', label: 'Extractor' } }, read.candidates);
  if (!suggested.ok) return { error: suggested.error.message };
  const tally = { confirmed: 0, edited: 0, dismissed: 0, commitmentsBeforeReview: 0, commitmentsAfterReview: 0 };
  tally.commitmentsBeforeReview = (await runtime.list(person)).value.length;
  for (const c of suggested.value) {
    const g = goldFor(meeting, c.record.source.quote);
    if (!g || !g.candidate) {
      await runtime.dismissCandidate(person, c.record.id, 'Not a promise anyone made (synthetic review).');
      tally.dismissed += 1;
      continue;
    }
    const owner = Object.values(ROLES).find((r) => r.label === g.owner) ?? ROLES.SCM;
    const exact = c.record.proposal.owner?.label === g.owner && c.record.proposal.dueBy === g.dueBy;
    const r = await runtime.confirmCandidate(person, c.record.id, {
      terms: {
        statement: c.record.proposal.statement,
        intendedOutcome: c.record.proposal.intendedOutcome ?? 'As promised in the meeting.',
        why: `Said in ${meeting.input.source.label}.`,
        owner,
        principal: ROLES.SCM,
        dueBy: g.dueBy ?? '2026-12-31',
        evidence: [],
        measures: [],
        value: [],
      },
    });
    if (r.ok) tally[exact ? 'confirmed' : 'edited'] += 1;
  }
  tally.commitmentsAfterReview = (await runtime.list(person)).value.length;
  return tally;
}


export const METRICS = [
  ['Correct candidates', 'correct'],
  ['False commitments', 'falseCommitments'],
  ['Missed commitments', 'missed'],
  ['Unsupported owner inference', 'unsupportedOwner'],
  ['Unsupported dates', 'unsupportedDate'],
  ['Dates not read (left to the person)', 'missedDate'],
  ['Hallucinated dependencies', 'hallucinatedDependencies'],
  ['Classification errors', 'classificationErrors'],
  ['Findings removed by governance (quote not in notes)', 'removedByGovernance'],
];

/** Where an extractor and the reference read a gold sentence differently: its class, or whether it became a candidate. */
function disagreements(meeting, ref, other) {
  return meeting.gold
    .map((g) => {
      const cls = (fs) => fs.find((f) => goldFor(meeting, f.quote) === g)?.class ?? '(not found)';
      const cand = (fs) => fs.some((f) => goldFor(meeting, f.quote) === g && f.candidate);
      return { quote: g.quote, gold: g.class, reference: cls(ref.findings), other: cls(other.findings), referenceCandidate: cand(ref.findings), otherCandidate: cand(other.findings) };
    })
    .filter((d) => d.reference !== d.other || d.referenceCandidate !== d.otherCandidate);
}

/** Run every extractor over every meeting; the reference extractor always runs, and the others are compared with it. */
export async function evaluate(meetings, extractors) {
  const all = [referenceExtractor, ...extractors.filter((x) => x.name !== referenceExtractor.name)];
  const results = [];
  for (const meeting of meetings) {
    const row = { meeting: meeting.input.source.label, gold: meeting.gold, by: {}, disagreements: {} };
    for (const x of all) {
      const r = await run(x, meeting);
      if (r.error) {
        row.by[x.name] = { error: r.error };
        continue;
      }
      row.by[x.name] = { model: x.model, findings: r.read.findings.map((f) => ({ class: f.class, quote: f.quote, candidate: f.candidate !== null, notConverted: f.notConverted })), score: score(meeting, r.read), person: await playPerson(meeting, r.read) };
    }
    const ref = row.by[referenceExtractor.name];
    for (const x of all.slice(1)) {
      if (ref?.findings && row.by[x.name]?.findings) row.disagreements[x.name] = disagreements(meeting, ref, row.by[x.name]);
    }
    results.push(row);
  }
  return { extractors: all.map((x) => ({ name: x.name, model: x.model })), results };
}

/** Totals of one metric, for one extractor, over every meeting. */
export const total = (evaluation, name, key) => evaluation.results.reduce((n, r) => n + (r.by[name]?.score?.[key]?.length ?? 0), 0);

/** The report, as markdown. */
export function renderReport(evaluation, ranAt) {
  const xs = evaluation.extractors;
  const lines = ['# Controlled extraction test — SYNTHETIC notes', '', `Run: ${ranAt} · extractors: ${xs.map((x) => x.name + (x.model ? ` (${x.model})` : '')).join(', ')}`, ''];
  lines.push('| | ' + xs.map((x) => x.name).join(' | ') + ' |', '| --- | ' + xs.map(() => '---').join(' | ') + ' |');
  for (const [label, key] of METRICS) lines.push(`| ${label} | ${xs.map((x) => total(evaluation, x.name, key)).join(' | ')} |`);
  const failed = xs.filter((x) => evaluation.results.some((r) => r.by[x.name]?.error));
  if (failed.length) lines.push(`| Runs that failed | ${xs.map((x) => evaluation.results.filter((r) => r.by[x.name]?.error).length).join(' | ')} |`);
  lines.push(`| Gold candidates | ${xs.map(() => evaluation.results.reduce((n, r) => n + r.gold.filter((g) => g.candidate).length, 0)).join(' | ')} |`, '');
  lines.push('Every candidate is INFERENCE until the synthetic reviewer confirms, edits or dismisses it; no commitment exists before that step (`commitmentsBeforeReview` is 0 in every run below).', '');
  lines.push('```json', JSON.stringify(evaluation.results, null, 2), '```');
  return lines.join('\n');
}
