/**
 * Which acts the reader can take on a commitment, asked of the same authority
 * port the runtime enforces — the UI offers what the policy allows, and the
 * runtime still decides.
 */
import { type AskAct, type AuthorityAct, type CommitmentView, interimAuthority, isLive, sameParty, type Scope, verifyOutcome } from '@forge/kernel';

export type ActOffer = { readonly act: AskAct; readonly label: string; readonly note: string | null; readonly primary?: boolean };

export const ACT_LABELS: Record<AskAct, string> = {
  ACCEPT: 'Accept',
  DECLINE: 'Decline',
  DECIDE_CHANGE: 'Decide the change',
  REQUEST_CHANGE: 'Change the promise',
  RECORD_EVIDENCE: 'Record evidence',
  DISPUTE_EVIDENCE: 'Dispute evidence',
  CLOSE: 'Close',
  REAFFIRM: 'Reaffirm',
  RECORD_OUTCOME: 'Record the outcome',
  RECORD_LEARNING: 'Record learning',
  SETTLE_DEPENDENCY: 'Settle a dependency',
  PUBLISH_OUTCOME: 'Publish the outcome to Helm',
  ASSESS_ASSUMPTION: 'Say what became of an assumption',
};

function probe(act: AskAct, v: CommitmentView, scope: Scope): AuthorityAct | null {
  switch (act) {
    case 'ACCEPT':
      return { kind: 'ACCEPT' };
    case 'DECLINE':
      return { kind: 'DECLINE' };
    case 'DECIDE_CHANGE': {
      const pending = v.changeRequests.find((r) => r.decided === null && scope.actsAs.some((p) => sameParty(p, r.approver)));
      return pending ? { kind: 'DECIDE_CHANGE', approver: pending.approver } : null;
    }
    case 'REQUEST_CHANGE':
      return { kind: 'CHANGE', change: { kind: 'REDATE', dueBy: v.terms.dueBy } };
    case 'RECORD_EVIDENCE':
      return { kind: 'RECORD_EVIDENCE', evidence: { epistemic: 'FACT', channel: 'HUMAN_CONFIRMATION' } };
    case 'DISPUTE_EVIDENCE':
      return { kind: 'DISPUTE_EVIDENCE' };
    case 'CLOSE':
      return { kind: 'CHANGE', change: { kind: 'CLOSE', resolution: v.phase === 'ACTIVE' ? 'FULFILLED' : 'CANCELLED', supersededBy: null, confirmedWithoutEvidence: false } };
    case 'REAFFIRM':
      return { kind: 'REAFFIRM' };
    case 'RECORD_OUTCOME':
      return { kind: 'RECORD_OUTCOME' };
    case 'RECORD_LEARNING':
      return { kind: 'RECORD_LEARNING' };
    case 'SETTLE_DEPENDENCY':
      return { kind: 'SETTLE_DEPENDENCY' };
    case 'PUBLISH_OUTCOME':
      return { kind: 'PUBLISH_OUTCOME' };
    case 'ASSESS_ASSUMPTION':
      return v.assumptions.length > 0 ? { kind: 'ASSESS_ASSUMPTION', standsBehind: v.assumptions.find((a) => scope.actsAs.some((p) => p.label === a.standsBehind))?.standsBehind ?? null } : null;
  }
}

export function canAct(act: AskAct, v: CommitmentView, scope: Scope): boolean {
  const a = probe(act, v, scope);
  return a !== null && interimAuthority.evaluate(scope, a, v).outcome !== 'REFUSED';
}

/** The acts that make sense for this commitment now, filtered by what the reader may do. */
export function availableActs(v: CommitmentView, scope: Scope): ActOffer[] {
  const want: { act: AskAct; note?: string }[] = [];
  if (v.phase === 'PROPOSED') want.push({ act: 'ACCEPT' }, { act: 'DECLINE' });
  if (v.changeRequests.some((r) => r.decided === null)) want.push({ act: 'DECIDE_CHANGE' });
  if (v.contextChanges.some((c) => c.material && c.reaffirmed === null) && v.phase !== 'CLOSED') want.push({ act: 'REAFFIRM' });
  if (v.phase === 'ACTIVE') {
    want.push({ act: 'CLOSE' });
    want.push({ act: 'RECORD_EVIDENCE' });
    if (v.evidence.some(isLive)) want.push({ act: 'DISPUTE_EVIDENCE' });
    // A dependency on another commitment settles itself when that commitment is delivered.
    if (v.dependencies.some((d) => d.settled === null && d.dependency.on.kind !== 'COMMITMENT')) want.push({ act: 'SETTLE_DEPENDENCY' });
  }
  if (v.phase !== 'CLOSED') want.push({ act: 'REQUEST_CHANGE' });
  if (v.assumptions.length > 0 && v.phase !== 'PROPOSED') want.push({ act: 'ASSESS_ASSUMPTION' });
  if (v.phase === 'CLOSED') {
    if (v.terms.measures.length > 0 || v.terms.evidence.some((r) => r.level === 'OUTCOME')) want.push({ act: 'RECORD_OUTCOME' });
    want.push({ act: 'RECORD_LEARNING' });
    if (v.record.origin.system === 'helm' && verifyOutcome(v).ok) want.unshift({ act: 'PUBLISH_OUTCOME' });
  }
  return want.filter((w) => canAct(w.act, v, scope)).map((w, i) => ({ act: w.act, label: ACT_LABELS[w.act], note: w.note ?? null, primary: i === 0 }));
}
