import { type CandidateView, type Party, sameParty } from '@forge/kernel';

/** Candidates whose proposed owner is one of the reader's roles come first. */
export function forReader(candidates: readonly CandidateView[], actsAs: readonly Party[]): CandidateView[] {
  const mine = (c: CandidateView) => c.record.proposal.owner !== null && actsAs.some((p) => c.record.proposal.owner !== null && sameParty(p, c.record.proposal.owner));
  return [...candidates].sort((a, b) => Number(mine(b)) - Number(mine(a)) || (a.record.suggestedAt < b.record.suggestedAt ? 1 : -1));
}
