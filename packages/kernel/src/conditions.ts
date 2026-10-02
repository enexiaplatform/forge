/**
 * Conditions and asks — human-in-the-loop by exception (§21).
 *
 * A condition is a FACT about a commitment at a lens, derived from its record:
 * it is past due, its evidence disagrees, its owner has not accepted it. Some
 * conditions carry an ASK: one question, to one party, with the acts that would
 * answer it. Forge asks a person only when judgment, authority or a
 * disagreement between sources needs one — never to have a field filled in, and
 * never "what percent done is it?".
 *
 * Severity decides treatment, not rank: nothing is scored or totalled.
 */

import { dateOf, humanDate, type Party, quoted, sameParty } from './primitives.ts';
import { fact, type Statement } from './epistemic.ts';
import type { CommitmentView, DependencyState } from './derive.ts';
import { varianceOf } from './variance.ts';
import { verifyOutcome } from './publication.ts';
import { deliveryResolutions, type TermField } from './types.ts';

const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Terms, as a person would name them in a sentence. */
export const TERM_WORDS: Record<TermField, string> = {
  statement: 'the promise',
  intendedOutcome: 'what changes',
  why: 'why it matters',
  owner: 'the owner',
  principal: 'who it is made to',
  dueBy: 'the date',
  evidence: 'what proves it',
  measures: 'how it is measured',
  value: 'what it is worth',
};

export const severities = ['CANNOT_WAIT', 'THIS_WEEK', 'NOTED'] as const;
export type Severity = (typeof severities)[number];

export const conditionCodes = [
  'AWAITING_ACCEPTANCE',
  'DECLINED',
  'PAST_DUE',
  'EVIDENCE_CONFLICT',
  'EVIDENCE_CONTRADICTED',
  'INFERENCE_UNCONFIRMED',
  'EVIDENCE_COMPLETE',
  'DEPENDENCY_LATE',
  'DEPENDENCY_AT_RISK',
  'CHANGE_AWAITING_DECISION',
  'CONTEXT_CHANGED',
  'OUTCOME_UNRECORDED',
  'LEARNING_OPEN',
  'OUTCOME_UNPUBLISHED',
  'ASSUMPTIONS_UNEXAMINED',
  'VALUE_UNSTATED',
] as const;
export type ConditionCode = (typeof conditionCodes)[number];

export type AskAct =
  | 'ACCEPT'
  | 'DECLINE'
  | 'DECIDE_CHANGE'
  | 'REQUEST_CHANGE'
  | 'RECORD_EVIDENCE'
  | 'DISPUTE_EVIDENCE'
  | 'CLOSE'
  | 'REAFFIRM'
  | 'RECORD_OUTCOME'
  | 'RECORD_LEARNING'
  | 'SETTLE_DEPENDENCY'
  | 'PUBLISH_OUTCOME'
  | 'ASSESS_ASSUMPTION';

export type Ask = {
  readonly whom: Party;
  readonly question: string;
  readonly acts: readonly AskAct[];
  /** The change request, requirement or dependency the ask is about. */
  readonly subject: string | null;
};

export type Condition = {
  readonly code: ConditionCode;
  readonly severity: Severity;
  readonly commitmentId: string;
  readonly statement: Statement;
  readonly ask: Ask | null;
};

/** Look up another commitment at the same lens — dependencies on commitments are read through this. */
export type ViewLookup = (commitmentId: string) => CommitmentView | null;

export function conditionsOf(v: CommitmentView, lookup: ViewLookup = () => null): Condition[] {
  const out: Condition[] = [];
  const id = v.record.id;
  const today = dateOf(v.lens.asOf);
  const open = v.phase === 'PROPOSED' || v.phase === 'ACTIVE';
  const pastDue = open && today > v.terms.dueBy;
  const owner = v.terms.owner;
  const principal = v.terms.principal;
  const add = (code: ConditionCode, severity: Severity, statement: Statement, ask: Ask | null) =>
    out.push({ code, severity, commitmentId: id, statement, ask });

  if (v.phase === 'PROPOSED') {
    const inferred = (Object.entries(v.capture) as [TermField, string][]).filter(([, c]) => c === 'INFERRED').map(([f]) => TERM_WORDS[f]);
    add(
      'AWAITING_ACCEPTANCE',
      pastDue ? 'CANNOT_WAIT' : 'THIS_WEEK',
      fact(`${owner.label} has not yet accepted this commitment.`, [id]),
      {
        whom: owner,
        question:
          inferred.length > 0
            ? `Will you stand behind this? Forge inferred ${inferred.join(' and ')} — confirm or change ${inferred.length > 1 ? 'them' : 'it'} as you accept.`
            : 'Will you stand behind this commitment?',
        acts: ['ACCEPT', 'DECLINE'],
        subject: null,
      },
    );
  }

  if (v.phase === 'DECLINED' && v.declined) {
    add(
      'DECLINED',
      'CANNOT_WAIT',
      fact(`${v.declined.party.label} declined.${quoted(v.declined.reason)}`, [v.declined.eventId]),
      { whom: principal, question: 'Nobody stands behind this promise. Hand it to someone else, change it, or withdraw it?', acts: ['REQUEST_CHANGE', 'CLOSE'], subject: null },
    );
  }

  if (pastDue && v.phase === 'ACTIVE') {
    const days = varianceOf(v).time.runningDaysLate ?? 0;
    add(
      'PAST_DUE',
      'CANNOT_WAIT',
      fact(`Due ${humanDate(v.terms.dueBy)}; still open ${days} day${days === 1 ? '' : 's'} later.`, [id]),
      { whom: owner, question: 'Say what happened: close it as it stands, or ask for a new date.', acts: ['CLOSE', 'REQUEST_CHANGE'], subject: null },
    );
  }

  for (const r of v.requirements) {
    const label = r.requirement.description;
    // A system's record is named by its system; a person's word by the person.
    const sources = (ids: readonly string[]) =>
      [
        ...new Set(
          v.evidence
            .filter((e) => ids.includes(e.item.id))
            .map((e) => (e.item.channel === 'SYSTEM_EVENT' || e.item.channel === 'API' ? `the ${e.item.source.system} record` : `${e.actor.label.split(',')[0]}’s word`)),
        ),
      ].join(' and ');
    if (r.status === 'CONFLICTED') {
      add(
        'EVIDENCE_CONFLICT',
        'CANNOT_WAIT',
        fact(`The evidence disagrees on “${label}”: ${sources(r.supporting)} supports it, ${sources(r.contradicting)} contradicts it.`, [...r.supporting, ...r.contradicting]),
        { whom: owner, question: 'Which source is right? Dispute the evidence that is wrong — it stays on the record and stops counting.', acts: ['DISPUTE_EVIDENCE', 'RECORD_EVIDENCE'], subject: r.requirement.key },
      );
    } else if (r.status === 'CONTRADICTED') {
      add(
        'EVIDENCE_CONTRADICTED',
        'CANNOT_WAIT',
        fact(`${upperFirst(sources(r.contradicting))} says otherwise about “${label}”, and nothing on the record supports it.`, r.contradicting),
        { whom: owner, question: 'Is the record wrong, or is the commitment not being met?', acts: ['DISPUTE_EVIDENCE', 'REQUEST_CHANGE', 'CLOSE'], subject: r.requirement.key },
      );
    } else if (r.status === 'INFERRED' && open) {
      add(
        'INFERENCE_UNCONFIRMED',
        'THIS_WEEK',
        fact(`Only an inference supports “${label}”.`, r.inferred),
        { whom: owner, question: 'Forge inferred this from indirect signals. Confirm it, or dispute it.', acts: ['RECORD_EVIDENCE', 'DISPUTE_EVIDENCE'], subject: r.requirement.key },
      );
    }
  }

  const required = v.requirements.filter((r) => r.requirement.required);
  if (v.phase === 'ACTIVE' && required.length > 0 && required.every((r) => r.status === 'EVIDENCED')) {
    add(
      'EVIDENCE_COMPLETE',
      'THIS_WEEK',
      fact(`Every required piece of evidence is in (${required.length} of ${required.length}).`, required.flatMap((r) => r.supporting)),
      { whom: owner, question: 'The evidence holds. Close it — and say whether the outcome held.', acts: ['CLOSE'], subject: null },
    );
  }

  for (const d of v.dependencies) {
    if (d.settled !== null || !open) continue;
    const settledByCommitment = dependencyCommitmentState(d, lookup);
    if (settledByCommitment === 'SETTLED') continue;
    if (d.dependency.neededBy !== null && today > d.dependency.neededBy) {
      add(
        'DEPENDENCY_LATE',
        'CANNOT_WAIT',
        fact(`Waiting on “${d.dependency.description}”, needed by ${humanDate(d.dependency.neededBy)}.`, [id]),
        { whom: owner, question: 'Does this put the commitment at risk? Settle it if it has happened, or ask for a new date.', acts: ['SETTLE_DEPENDENCY', 'REQUEST_CHANGE'], subject: d.dependency.key },
      );
    } else if (settledByCommitment === 'AT_RISK') {
      add(
        'DEPENDENCY_AT_RISK',
        'THIS_WEEK',
        fact(`“${d.dependency.description}” rests on a commitment that is past due or has nobody behind it.`, [id]),
        { whom: owner, question: 'The commitment this one waits on is in trouble. Does your date still hold?', acts: ['REQUEST_CHANGE'], subject: d.dependency.key },
      );
    }
  }

  for (const req of v.changeRequests) {
    if (req.decided !== null) continue;
    add(
      'CHANGE_AWAITING_DECISION',
      pastDue ? 'CANNOT_WAIT' : 'THIS_WEEK',
      fact(`${req.requestedBy.label} asked to ${describeAsk(req.change)}.${quoted(req.reason)}`, [req.eventId]),
      { whom: req.approver, question: 'Approve or reject this change to what was promised?', acts: ['DECIDE_CHANGE'], subject: req.requestId },
    );
  }

  for (const cc of v.contextChanges) {
    if (!cc.material || cc.reaffirmed !== null || v.phase === 'CLOSED') continue;
    add(
      'CONTEXT_CHANGED',
      'CANNOT_WAIT',
      fact(`${cc.source.system} reports: ${cc.statement}`, [cc.eventId]),
      { whom: principal, question: 'The world this commitment rests on has changed. Does it still stand?', acts: ['REAFFIRM', 'CLOSE', 'REQUEST_CHANGE'], subject: cc.eventId },
    );
  }

  if (v.phase === 'CLOSED' && v.resolution && deliveryResolutions.includes(v.resolution.resolution)) {
    // Asked only when nothing on the record already shows what changed: measures need actuals, and
    // outcome-level evidence that holds is itself the outcome.
    const outcomeReqs = v.requirements.filter((r) => r.requirement.level === 'OUTCOME' && r.requirement.required);
    const wantsOutcome = v.terms.measures.length > 0 || (outcomeReqs.length > 0 && outcomeReqs.some((r) => r.status !== 'EVIDENCED'));
    if (wantsOutcome && v.outcome === null) {
      add(
        'OUTCOME_UNRECORDED',
        'NOTED',
        fact('Closed without a recorded outcome.', [v.resolution.eventId]),
        { whom: principal, question: 'What actually changed? Record the outcome while it is still known.', acts: ['RECORD_OUTCOME'], subject: null },
      );
    }
  }

  if (v.phase === 'CLOSED' && v.learnings.length === 0 && !ancestorLearned(v, lookup) && varianceOf(v).hasVariance) {
    add(
      'LEARNING_OPEN',
      'NOTED',
      fact('It ended differently from what was promised, and nobody has said why.', v.resolution ? [v.resolution.eventId] : [id]),
      { whom: principal, question: 'What explains the difference, and what should the enterprise remember?', acts: ['RECORD_LEARNING'], subject: null },
    );
  }

  // §15 asks which assumptions repeatedly prove wrong. When the root of a decision's tree ends, its principal is asked
  // once — noted, never urgent — what became of the assumptions nobody has examined (ADR-0026).
  if (v.phase === 'CLOSED' && v.record.parentId === null) {
    const unexamined = v.assumptions.filter((a) => a.assessed === null);
    if (unexamined.length > 0) {
      add(
        'ASSUMPTIONS_UNEXAMINED',
        'NOTED',
        fact(
          `${unexamined.length === 1 ? 'One assumption' : `${unexamined.length} assumptions`} the decision rested on ${unexamined.length === 1 ? 'was' : 'were'} never examined.`,
          v.resolution ? [v.resolution.eventId] : [id],
        ),
        { whom: principal, question: 'Now that it has ended: which assumptions held, and which broke?', acts: ['ASSESS_ASSUMPTION'], subject: unexamined[0].key },
      );
    }
  }

  // §17: what a decision was meant to create or protect is asked about once, at its root, after the outcome is in —
  // noted, and never where what was said is only withheld from this reader (ADR-0028).
  if (v.phase === 'CLOSED' && v.record.parentId === null && v.outcome !== null && (v.outcome.outcome.withheld?.length ?? 0) === 0) {
    const said = new Set(v.outcome.outcome.realizedValue.map((r) => r.dimension));
    const unsaid = [...new Set(v.terms.value.map((c) => c.dimension))].filter((d) => !said.has(d));
    if (unsaid.length > 0) {
      add(
        'VALUE_UNSTATED',
        'NOTED',
        fact(`Nobody has said what became of the ${unsaid.map((d) => d.toLowerCase().replace(/_/g, ' ')).join(' and ')} value it was meant to create or protect.`, [v.outcome.eventId]),
        { whom: principal, question: 'What value did it actually create, protect, delay or destroy?', acts: ['RECORD_OUTCOME'], subject: null },
      );
    }
  }

  // A verified outcome of a commitment that answers to a Helm decision belongs in Helm's memory.
  if (v.phase === 'CLOSED' && v.record.origin.system === 'helm') {
    const verified = verifyOutcome(v);
    if (verified.ok) {
      const latest = v.publications.at(-1) ?? null;
      if (latest === null || latest.publication.fingerprint !== verified.value.fingerprint) {
        add(
          'OUTCOME_UNPUBLISHED',
          'NOTED',
          fact(
            latest === null
              ? 'The outcome is verified and Helm has not been given it.'
              : 'The record changed since the outcome was published; Helm holds an earlier version.',
            [v.resolution?.eventId ?? id],
          ),
          { whom: principal, question: 'Publish the verified outcome for Helm’s enterprise memory?', acts: ['PUBLISH_OUTCOME'], subject: null },
        );
      }
    }
  }

  return out;
}

/** A learning recorded higher up the tree explains what happened beneath it; nobody is asked twice. */
function ancestorLearned(v: CommitmentView, lookup: ViewLookup): boolean {
  const seen = new Set<string>([v.record.id]);
  let parentId = v.record.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = lookup(parentId);
    if (parent === null) return false;
    if (parent.learnings.length > 0) return true;
    parentId = parent.record.parentId;
  }
  return false;
}

/** A dependency on another commitment settles when that commitment is delivered. */
export function dependencyCommitmentState(d: DependencyState, lookup: ViewLookup): 'SETTLED' | 'AT_RISK' | 'PENDING' | 'NOT_A_COMMITMENT' {
  if (d.dependency.on.kind !== 'COMMITMENT') return 'NOT_A_COMMITMENT';
  const other = lookup(d.dependency.on.commitmentId);
  if (other === null) return 'PENDING';
  if (other.phase === 'CLOSED') {
    return other.resolution && (other.resolution.resolution === 'FULFILLED' || other.resolution.resolution === 'PARTIALLY_FULFILLED') ? 'SETTLED' : 'AT_RISK';
  }
  if (other.phase === 'DECLINED') return 'AT_RISK';
  if (dateOf(other.lens.asOf) > other.terms.dueBy) return 'AT_RISK';
  return 'PENDING';
}

function describeAsk(change: CommitmentView['changeRequests'][number]['change']): string {
  switch (change.kind) {
    case 'REDATE':
      return `move the due date to ${humanDate(change.dueBy)}`;
    case 'RESCOPE':
      return 'change what is promised';
    case 'REASSIGN':
      return `hand the commitment to ${change.owner.label}`;
    case 'CLOSE':
      return `close it as ${change.resolution.toLowerCase().replace(/_/g, ' ')}`;
  }
}

/** The asks addressed to any party the reader acts as. */
export const asksFor = (conditions: readonly Condition[], actsAs: readonly Party[]): Condition[] =>
  conditions.filter((c) => c.ask !== null && actsAs.some((p) => sameParty(p, (c.ask as Ask).whom)));

const severityOrder: Record<Severity, number> = { CANNOT_WAIT: 0, THIS_WEEK: 1, NOTED: 2 };

/** Grouping order for display: what cannot wait first. Within a severity, the record's own order. */
export const bySeverity = (a: Condition, b: Condition): number => severityOrder[a.severity] - severityOrder[b.severity];
