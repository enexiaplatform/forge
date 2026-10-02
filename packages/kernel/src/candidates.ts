/**
 * Candidates — what might be a commitment, before anyone has said it is.
 *
 * Two sources propose candidates today: a customer promise in Memoire that
 * looks like a real enterprise obligation (decision 3 of 2026-10-01), and a
 * sentence in meeting notes that reads as a promise or a decision (decision 4).
 * A candidate is an INFERENCE, always: Forge or a model concluded that the text
 * might carry accountability. It binds nobody and appears on no ledger. A
 * person CONFIRMS it — possibly after editing it — which proposes a commitment
 * linked to its source; or DISMISSES it, with a reason, which is kept. Only a
 * person can do either; a model never creates a commitment from language.
 *
 * Discussion, requests and intentions are never candidates. The extraction
 * layer reports them as not converted, so a reader can see what was NOT turned
 * into a promise and why.
 */

import { type Actor, type Clock, fail, fingerprint, ok, type Party, type Result, type Scope } from './primitives.ts';
import type { EvidenceRequirement, TermField, Terms } from './types.ts';

/** How a sentence stands, from the most tentative to the most binding. */
export const utteranceClasses = ['DISCUSSION', 'REQUEST', 'INTENTION', 'DECISION', 'COMMITMENT'] as const;
export type UtteranceClass = (typeof utteranceClasses)[number];

/** Only these can become a candidate commitment. */
export const candidateClasses: readonly UtteranceClass[] = ['COMMITMENT', 'DECISION'];

export const candidateSourceKinds = ['MEETING_NOTES', 'TRANSCRIPT', 'MESSAGE', 'MEMOIRE_PROMISE'] as const;
export type CandidateSourceKind = (typeof candidateSourceKinds)[number];

export type CandidateSource = {
  readonly kind: CandidateSourceKind;
  readonly system: string;
  /** The source object: 'memoire:commitment:<id>', 'notes:logistics-review-2026-10-16'. */
  readonly ref: string;
  readonly label: string;
  /** The exact words the candidate rests on. For notes, verbatim from the text. */
  readonly quote: string | null;
  /** Where in the source: 'line 7'. */
  readonly locator: string | null;
  /** When the words were said or the promise last changed. */
  readonly observedAt: string;
  /** The shared enterprise entity it concerns, when known. */
  readonly entityRef: string | null;
};

export type CandidateProposal = {
  readonly statement: string;
  readonly intendedOutcome: string | null;
  /** A party the owner text matched in shared enterprise reality, or null — a person then names one. */
  readonly owner: Party | null;
  readonly ownerText: string | null;
  readonly principal: Party | null;
  readonly dueBy: string | null;
  /** The words that gave the date ('by 24 October'), kept even when no date could be read from them. */
  readonly dueText: string | null;
  readonly dependencies: readonly string[];
  readonly entities: readonly { readonly text: string; readonly entityRef: string | null }[];
  /** What would prove it, when the source names something. */
  readonly evidence: readonly EvidenceRequirement[];
};

export type CandidateRecord = {
  readonly id: string;
  readonly orgId: string;
  readonly source: CandidateSource;
  readonly utteranceClass: UtteranceClass;
  readonly proposal: CandidateProposal;
  /** 0..1 — how sure the extractor is that this carries accountability. */
  readonly confidence: number;
  readonly epistemic: 'INFERENCE';
  readonly extractor: { readonly name: string; readonly model: string | null };
  readonly suggestedBy: Actor;
  readonly suggestedAt: string;
  readonly recordedAt: string;
  /** One candidate per source sentence or promise: re-reading the same notes changes nothing. */
  readonly dedupeKey: string;
  readonly fingerprint: string;
};

export type NewCandidate = Omit<CandidateRecord, 'recordedAt'>;

export type CandidateDisposition = {
  readonly id: string;
  readonly orgId: string;
  readonly candidateId: string;
  readonly kind: 'CONFIRMED' | 'DISMISSED';
  readonly actor: Actor;
  readonly at: string;
  readonly recordedAt: string;
  readonly reason: string | null;
  readonly commitmentId: string | null;
  /** The terms the person changed from what was proposed. */
  readonly edited: readonly TermField[];
};

export type NewDisposition = Omit<CandidateDisposition, 'recordedAt'>;

export type CandidateState = 'PENDING' | 'CONFIRMED' | 'DISMISSED';

export type CandidateView = {
  readonly record: CandidateRecord;
  readonly state: CandidateState;
  readonly disposition: CandidateDisposition | null;
};

export interface CandidateStore {
  insertCandidates(scope: Scope, records: readonly NewCandidate[]): Promise<Result<CandidateRecord[]>>;
  /** One disposition per candidate, ever. */
  insertDisposition(scope: Scope, disposition: NewDisposition): Promise<Result<CandidateDisposition>>;
  listCandidates(scope: Scope): Promise<Result<CandidateRecord[]>>;
  listDispositions(scope: Scope): Promise<Result<CandidateDisposition[]>>;
}

/** What a source suggests; the runtime adds identity, time and fingerprint. */
export type SuggestCandidateInput = {
  readonly source: CandidateSource;
  readonly utteranceClass: UtteranceClass;
  readonly proposal: CandidateProposal;
  readonly confidence: number;
  readonly extractor: { readonly name: string; readonly model: string | null };
  readonly dedupeKey: string;
};

export function validateCandidate(c: SuggestCandidateInput): Result<true> {
  if (!candidateClasses.includes(c.utteranceClass)) {
    return fail('candidate.not_a_commitment', `A ${c.utteranceClass.toLowerCase()} is not a commitment; Forge does not turn it into one.`);
  }
  if (!c.proposal.statement.trim()) return fail('candidate.statement_required', 'A candidate says what would be promised.');
  if (!Number.isFinite(c.confidence) || c.confidence < 0 || c.confidence > 1) return fail('candidate.invalid_confidence', 'Confidence is between 0 and 1.');
  if (!c.source.ref.trim() || !c.dedupeKey.trim()) return fail('candidate.unsourced', 'A candidate names the source it was read from.');
  if ((c.source.kind === 'MEETING_NOTES' || c.source.kind === 'TRANSCRIPT' || c.source.kind === 'MESSAGE') && !c.source.quote?.trim()) {
    return fail('candidate.unquoted', 'A candidate from a conversation quotes the words it rests on.');
  }
  return ok(true);
}

export const candidateFingerprint = (c: SuggestCandidateInput): string =>
  fingerprint('cnd', { source: c.source, utteranceClass: c.utteranceClass, proposal: c.proposal, extractor: c.extractor });

export function candidateViews(records: readonly CandidateRecord[], dispositions: readonly CandidateDisposition[]): CandidateView[] {
  const byCandidate = new Map(dispositions.map((d) => [d.candidateId, d]));
  return records.map((record) => {
    const d = byCandidate.get(record.id) ?? null;
    return { record, state: d === null ? 'PENDING' : d.kind, disposition: d };
  });
}

/** Which terms a person changed when confirming. */
export function editedTerms(proposal: CandidateProposal, terms: Terms): TermField[] {
  const out: TermField[] = [];
  if (terms.statement !== proposal.statement) out.push('statement');
  if (proposal.intendedOutcome === null || terms.intendedOutcome !== proposal.intendedOutcome) out.push('intendedOutcome');
  if (proposal.owner === null || proposal.owner.label !== terms.owner.label) out.push('owner');
  if (proposal.principal === null || proposal.principal.label !== terms.principal.label) out.push('principal');
  if (proposal.dueBy === null || terms.dueBy !== proposal.dueBy) out.push('dueBy');
  if (JSON.stringify(terms.evidence) !== JSON.stringify(proposal.evidence)) out.push('evidence');
  return out;
}

export function createInMemoryCandidateStore(clock: Clock): CandidateStore {
  const records: CandidateRecord[] = [];
  const dispositions: CandidateDisposition[] = [];
  const freeze = <T>(v: T): T => structuredClone(v);
  return {
    async insertCandidates(scope, batch) {
      for (const c of batch) {
        if (c.orgId !== scope.orgId) return fail('tenant.mismatch', 'A candidate can only be written into the reader’s own organization.');
        if (records.some((r) => r.orgId === c.orgId && r.dedupeKey === c.dedupeKey)) return fail('candidate.duplicate', 'That candidate has already been read.');
      }
      const now = clock.now();
      const written = batch.map((c) => freeze({ ...c, recordedAt: now }));
      records.push(...written);
      return ok(freeze(written));
    },
    async insertDisposition(scope, d) {
      if (d.orgId !== scope.orgId) return fail('tenant.mismatch', 'A disposition can only be written into the reader’s own organization.');
      if (!records.some((r) => r.id === d.candidateId && r.orgId === scope.orgId)) return fail('candidate.not_found', 'There is no such candidate.');
      if (dispositions.some((x) => x.candidateId === d.candidateId)) return fail('candidate.already_disposed', 'That candidate has already been confirmed or dismissed.');
      const written = freeze({ ...d, recordedAt: clock.now() });
      dispositions.push(written);
      return ok(freeze(written));
    },
    async listCandidates(scope) {
      return ok(freeze(records.filter((r) => r.orgId === scope.orgId)));
    },
    async listDispositions(scope) {
      return ok(freeze(dispositions.filter((d) => d.orgId === scope.orgId)));
    },
  };
}
