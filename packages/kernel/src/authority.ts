/**
 * Authority — who may do what to a commitment (§16).
 *
 * Forge does not own a permission philosophy; management authority belongs to
 * Helm's Decision & Authority Runtime. This module is a PORT with one interim
 * implementation, `forge-interim-authority@1`, which applies the rules every
 * commitment already implies — the owner accepts, the principal approves
 * changes to what was promised — until a Helm adapter answers the same port.
 * Every verdict names its policy and rule, and every event records the verdict
 * it rested on, so a later switch to Helm leaves history readable.
 *
 * AI agents follow the same boundaries and narrower ones: an agent may propose
 * and may infer, but it never accepts, approves, closes or speaks for a person.
 * A SYSTEM (a connector) may only report what its source system recorded.
 */

import { actsFor, hasRole, type Party, type Scope } from './primitives.ts';
import type { CommitmentView } from './derive.ts';
import type { Change, EvidenceItem } from './types.ts';
import { deliveryResolutions } from './types.ts';

export type AuthorityAct =
  | { readonly kind: 'PROPOSE' }
  | { readonly kind: 'ACCEPT' }
  | { readonly kind: 'DECLINE' }
  | { readonly kind: 'CHANGE'; readonly change: Change }
  | { readonly kind: 'DECIDE_CHANGE'; readonly approver: Party }
  | { readonly kind: 'RECORD_EVIDENCE'; readonly evidence: Pick<EvidenceItem, 'epistemic' | 'channel'> }
  | { readonly kind: 'DISPUTE_EVIDENCE' }
  | { readonly kind: 'LINK_EXECUTION' }
  | { readonly kind: 'OBSERVE_ACTIVITY' }
  | { readonly kind: 'DECLARE_DEPENDENCY' }
  | { readonly kind: 'SETTLE_DEPENDENCY' }
  | { readonly kind: 'RECORD_OUTCOME' }
  | { readonly kind: 'RECORD_CONTEXT_CHANGE' }
  | { readonly kind: 'REAFFIRM' }
  | { readonly kind: 'RECORD_LEARNING' }
  | { readonly kind: 'REOPEN' }
  | { readonly kind: 'PUBLISH_OUTCOME' }
  | { readonly kind: 'SUGGEST_CANDIDATE' }
  | { readonly kind: 'DISPOSE_CANDIDATE' };

/**
 * The acts Helm's trusted Decision & Authority Runtime must answer before Forge
 * runs in shared production (decision 2 of 2026-10-01): taking on
 * accountability, approving a change, changing, cancelling or closing a
 * promise, and reopening one.
 */
export function isConsequential(act: AuthorityAct): boolean {
  return act.kind === 'ACCEPT' || act.kind === 'DECIDE_CHANGE' || act.kind === 'CHANGE' || act.kind === 'REOPEN';
}

type VerdictBase = {
  readonly policy: string;
  readonly rule: string;
  readonly statement: string;
  /** True only when a trusted authority service (Helm's) produced the verdict; Forge's interim policy never is. */
  readonly trusted: boolean;
  /** The trusted authority's record the verdict rests on — Helm's standing attestation (ADR-0021). */
  readonly attestation?: string;
};

export type AuthorityVerdict =
  | (VerdictBase & { readonly outcome: 'ALLOWED' })
  | (VerdictBase & { readonly outcome: 'REQUIRES_APPROVAL'; readonly approver: Party })
  | (VerdictBase & { readonly outcome: 'REFUSED' });

export interface AuthorityPort {
  readonly policy: string;
  /** `view` is null only for PROPOSE, when there is no commitment yet. A trusted authority answers over the network. */
  evaluate(scope: Scope, act: AuthorityAct, view: CommitmentView | null): AuthorityVerdict | Promise<AuthorityVerdict>;
}

export const INTERIM_POLICY = 'forge-interim-authority@1';

const allowed = (rule: string, statement: string): AuthorityVerdict => ({ outcome: 'ALLOWED', policy: INTERIM_POLICY, rule, statement, trusted: false });
const refused = (rule: string, statement: string): AuthorityVerdict => ({ outcome: 'REFUSED', policy: INTERIM_POLICY, rule, statement, trusted: false });
const approval = (rule: string, statement: string, approver: Party): AuthorityVerdict => ({
  outcome: 'REQUIRES_APPROVAL',
  policy: INTERIM_POLICY,
  rule,
  statement,
  approver,
  trusted: false,
});

/** An authority that answers at once — the interim policy, which the console also asks what a reader may do. */
export type ImmediateAuthority = Omit<AuthorityPort, 'evaluate'> & { evaluate(scope: Scope, act: AuthorityAct, view: CommitmentView | null): AuthorityVerdict };

/** The interim policy. Pure: the same scope, act and view always give the same verdict. */
export const interimAuthority: ImmediateAuthority = {
  policy: INTERIM_POLICY,
  evaluate(scope: Scope, act: AuthorityAct, view: CommitmentView | null): AuthorityVerdict {
    if (scope.role === 'viewer') return refused('viewer-reads-only', 'A viewer can read commitments but not change them.');

    if (scope.actor.kind === 'AGENT') return agentVerdict(act);
    if (scope.actor.kind === 'SYSTEM') return systemVerdict(act);

    if (act.kind === 'PROPOSE') {
      return hasRole(scope.role, 'member')
        ? allowed('member-proposes', 'Any member may propose a commitment; it binds nobody until its owner accepts.')
        : refused('member-proposes', 'Only members may propose commitments.');
    }
    if (act.kind === 'SUGGEST_CANDIDATE') {
      return allowed('anyone-suggests', 'A candidate binds nobody; it waits for a person to confirm or dismiss it.');
    }
    if (act.kind === 'DISPOSE_CANDIDATE') {
      return hasRole(scope.role, 'member')
        ? allowed('person-disposes-candidate', 'A person decides whether what was read is a commitment. Confirming proposes it; its owner still has to accept.')
        : refused('person-disposes-candidate', 'Only members may confirm or dismiss a candidate.');
    }
    if (view === null) return refused('commitment-required', 'There is no commitment to act on.');

    const owner = actsFor(scope, view.terms.owner);
    const principal = actsFor(scope, view.terms.principal);
    const party = owner || principal;
    const manager = hasRole(scope.role, 'manager');

    switch (act.kind) {
      case 'ACCEPT':
      case 'DECLINE':
        return owner
          ? allowed('owner-accepts', 'Only the owner can take on — or decline — the accountability a commitment carries.')
          : refused('owner-accepts', `Only ${view.terms.owner.label} can accept or decline this commitment.`);
      case 'CHANGE':
        return changeVerdict(act.change, owner, principal, view);
      case 'DECIDE_CHANGE':
        return actsFor(scope, act.approver)
          ? allowed('approver-decides', 'The party a change was asked of decides it.')
          : refused('approver-decides', `Only ${act.approver.label} can decide this change.`);
      case 'RECORD_EVIDENCE':
        if (act.evidence.epistemic === 'INFERENCE') {
          return refused('people-record-facts', 'A person records what they know as a fact or a confirmation; inferences come from Forge and agents.');
        }
        if (act.evidence.channel === 'SYSTEM_EVENT' || act.evidence.channel === 'API') {
          return refused('systems-report-system-events', 'Only a connector reports a source system’s record.');
        }
        return party || manager
          ? allowed('party-records-evidence', 'The owner, the principal or a manager may record evidence; it stays attributed to them.')
          : refused('party-records-evidence', 'Only the owner, the principal or a manager may record evidence.');
      case 'DISPUTE_EVIDENCE':
        return party || manager
          ? allowed('party-disputes-evidence', 'Disputed evidence stays on the record; it stops counting.')
          : refused('party-disputes-evidence', 'Only the owner, the principal or a manager may dispute evidence.');
      case 'LINK_EXECUTION':
      case 'DECLARE_DEPENDENCY':
      case 'SETTLE_DEPENDENCY':
      case 'OBSERVE_ACTIVITY':
        return party
          ? allowed('party-manages-execution', 'The owner and the principal say where the work happens and what it waits on.')
          : refused('party-manages-execution', 'Only the owner or the principal may do this.');
      case 'RECORD_OUTCOME':
        return party
          ? allowed('party-records-outcome', 'The owner or the principal states what actually happened.')
          : refused('party-records-outcome', 'Only the owner or the principal may record the outcome.');
      case 'RECORD_CONTEXT_CHANGE':
        return party || manager
          ? allowed('party-records-context', 'A change in the world the commitment rests on can be recorded by those who see it.')
          : refused('party-records-context', 'Only the owner, the principal or a manager may record a context change.');
      case 'PUBLISH_OUTCOME':
        return principal
          ? allowed('principal-publishes-outcome', 'The party the promise was made to says it is ready for the enterprise’s memory.')
          : refused('principal-publishes-outcome', `Only ${view.terms.principal.label} may publish this outcome to Helm.`);
      case 'REAFFIRM':
      case 'REOPEN':
        return principal
          ? allowed('principal-holds-the-promise', 'The party the promise was made to decides whether it still stands.')
          : refused('principal-holds-the-promise', `Only ${view.terms.principal.label} may do this.`);
      case 'RECORD_LEARNING':
        return hasRole(scope.role, 'member')
          ? allowed('member-records-learning', 'Anyone who was part of it may say what the enterprise should remember; it stays attributed.')
          : refused('member-records-learning', 'Only members may record learning.');
    }
  },
};

function changeVerdict(change: Change, owner: boolean, principal: boolean, view: CommitmentView): AuthorityVerdict {
  const p = view.terms.principal;
  if (principal) return allowed('principal-changes-terms', 'The party the promise was made to may change it.');

  if (change.kind === 'CLOSE' && deliveryResolutions.includes(change.resolution)) {
    return owner
      ? allowed('owner-reports-delivery', 'The owner says how delivery ended — fulfilled, partly, or missed. Honesty should be cheap.')
      : refused('owner-reports-delivery', `Only ${view.terms.owner.label} or ${p.label} may close this commitment.`);
  }
  if (!owner) return refused('party-changes-terms', `Only ${view.terms.owner.label} may ask ${p.label} to change this commitment.`);
  switch (change.kind) {
    case 'REDATE':
      return approval('owner-redates-with-principal', `A new date is a new promise; ${p.label} agrees to it.`, p);
    case 'RESCOPE':
      return approval('owner-rescopes-with-principal', `Changing what was promised needs ${p.label}.`, p);
    case 'REASSIGN':
      return approval('owner-hands-over-with-principal', `Handing a commitment to someone else needs ${p.label}.`, p);
    case 'CLOSE':
      return approval('owner-withdraws-with-principal', `Cancelling, abandoning or superseding a promise is ${p.label}’s call.`, p);
  }
}

function agentVerdict(act: AuthorityAct): AuthorityVerdict {
  if (act.kind === 'SUGGEST_CANDIDATE') {
    return allowed('agent-suggests', 'An agent may suggest a candidate, labelled as an inference, for a person to confirm or dismiss.');
  }
  if (act.kind === 'PROPOSE') {
    return allowed('agent-proposes', 'An agent may draft a commitment; it binds nobody until a person accepts it.');
  }
  if (act.kind === 'RECORD_EVIDENCE' && act.evidence.epistemic === 'INFERENCE' && act.evidence.channel === 'INFERENCE') {
    return allowed('agent-infers', 'An agent may record an inference, labelled as one, for a person to confirm or reject.');
  }
  return refused('agent-boundary', 'An agent cannot accept, approve, change, close or speak for a person; it proposes and infers.');
}

function systemVerdict(act: AuthorityAct): AuthorityVerdict {
  switch (act.kind) {
    case 'RECORD_EVIDENCE':
      return act.evidence.epistemic === 'FACT' && (act.evidence.channel === 'SYSTEM_EVENT' || act.evidence.channel === 'API')
        ? allowed('system-reports-record', 'A connector reports what its source system recorded, as a fact from that system.')
        : refused('system-reports-record', 'A connector reports only its source system’s records.');
    case 'OBSERVE_ACTIVITY':
    case 'SETTLE_DEPENDENCY':
    case 'RECORD_CONTEXT_CHANGE':
      return allowed('system-reports-record', 'A connector reports what its source system recorded.');
    case 'SUGGEST_CANDIDATE':
      return allowed('system-suggests', 'A connector may suggest that a source record looks like an enterprise obligation; a person decides.');
    default:
      return refused('system-boundary', 'A connector reports; it does not decide.');
  }
}
