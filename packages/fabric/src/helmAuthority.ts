/**
 * Helm's trusted authority, answering Forge's authority port (ADR-0021; Helm ADR-0036).
 *
 * Forge's rules say WHICH party holds an act on a commitment — the owner accepts and declines, the principal decides
 * a change and reopens, either may change it (the owner's change becomes a request). What Forge cannot know is
 * whether the person calling may act for that party. Helm can: its trusted service attests, from its own seat
 * records, that the verified caller is that person or is acting in a seat that person holds — and keeps the record.
 *
 * So for every act that binds accountability, this adapter ignores whom the client says it acts as, asks Helm to
 * attest standing for the party who holds the act, and lets Forge's rule decide with only that attested party. The
 * verdict is TRUSTED and carries the attestation id; Forge's database refuses the event unless that attestation is
 * Helm's, recent, the writer's own, and for the person who holds the act on that very commitment.
 *
 * Every other act — evidence, links, learning, publication — keeps Forge's interim rules: they bind nobody.
 */

import {
  type AuthorityAct,
  type AuthorityPort,
  type AuthorityVerdict,
  type CommitmentView,
  type ImmediateAuthority,
  interimAuthority,
  type Party,
  type Result,
  type Scope,
} from '@forge/kernel';

export const HELM_STANDING_POLICY = 'helm-standing@1';

/** Helm's answer to "may this caller act for that person, now?" — its standing attestation, or a refusal. */
export type StandingAttestation = {
  readonly id: string;
  readonly basis: { readonly kind: 'SELF' } | { readonly kind: 'ACTING_FOR'; readonly roleLabel: string };
};
export type StandingAttestor = (scope: Scope, forUserId: string) => Promise<Result<StandingAttestation>>;

/** Helm's refusal when the caller may not act for the person (Helm ADR-0036); anything else is a failure to ask. */
export const NO_STANDING = 'authority.no_standing';

/** The acts that make someone accountable, or change what they are accountable for. */
export const bindsAccountability = (act: AuthorityAct): boolean =>
  act.kind === 'ACCEPT' || act.kind === 'DECLINE' || act.kind === 'CHANGE' || act.kind === 'DECIDE_CHANGE' || act.kind === 'REOPEN';

/** Who may hold the act, in the order Forge's rule tries them: the principal before the owner, for a change. */
function holders(act: AuthorityAct, v: CommitmentView): Party[] {
  const parties =
    act.kind === 'ACCEPT' || act.kind === 'DECLINE'
      ? [v.terms.owner]
      : act.kind === 'DECIDE_CHANGE'
        ? [act.approver]
        : act.kind === 'REOPEN'
          ? [v.terms.principal]
          : [v.terms.principal, v.terms.owner];
  return parties.filter((p, i) => parties.findIndex((q) => q.ref === p.ref && q.label === p.label) === i);
}

const words = (a: StandingAttestation, party: Party): string =>
  a.basis.kind === 'SELF' ? `Helm attests you are ${party.label}.` : `Helm attests you are acting as ${a.basis.roleLabel} for ${party.label}.`;

export function createHelmAuthority(attest: StandingAttestor, rules: ImmediateAuthority = interimAuthority): AuthorityPort {
  const refused = (statement: string, rule: string): AuthorityVerdict => ({ outcome: 'REFUSED', policy: HELM_STANDING_POLICY, rule, statement, trusted: true });

  return {
    policy: HELM_STANDING_POLICY,
    async evaluate(scope, act, view) {
      // Agents and connectors never hold these acts; Forge's own rules already refuse them, and say why.
      if (!bindsAccountability(act) || view === null || scope.actor.kind !== 'PERSON') return rules.evaluate(scope, act, view);

      const candidates = holders(act, view);
      for (const party of candidates) {
        if (!party.ref) continue;
        const a = await attest(scope, party.ref);
        if (!a.ok) {
          if (a.error.code === NO_STANDING) continue;
          return refused(`Helm’s authority service did not answer, so nothing that binds accountability can be recorded now: ${a.error.message}`, 'helm-unavailable');
        }
        // Forge's rule decides with the attested party only — never with whom the client said it acts as.
        const v = rules.evaluate({ ...scope, actsAs: [party] }, act, view);
        if (v.outcome === 'REFUSED') return { ...v, policy: HELM_STANDING_POLICY, trusted: true, attestation: a.value.id };
        return { ...v, policy: HELM_STANDING_POLICY, statement: `${v.statement} ${words(a.value, party)}`, trusted: true, attestation: a.value.id };
      }
      const named = candidates.filter((p) => p.ref).map((p) => p.label);
      return named.length === 0
        ? refused('Nobody Helm knows holds this act: the commitment names no Helm person for it, so Helm cannot attest who may act.', 'no-helm-party')
        : refused(`Helm’s records do not let you act for ${named.join(' or ')}: you are not them, and you are not acting in a seat they hold.`, 'no-standing');
    },
  };
}

/** The attestor over Helm's trusted service, as its edge function answers: a verified identity and a JSON body. */
export function helmStandingAttestor(call: (body: { op: 'attest-standing'; orgId: string; forUserId: string }) => Promise<{ status: number; body: Record<string, unknown> }>): StandingAttestor {
  return async (scope, forUserId) => {
    const res = await call({ op: 'attest-standing', orgId: scope.orgId, forUserId });
    const body = res.body as { ok?: boolean; attestation?: { id: string; basis: StandingAttestation['basis'] }; error?: { code: string; message: string } };
    if (res.status === 200 && body.ok && body.attestation) return { ok: true, value: { id: body.attestation.id, basis: body.attestation.basis } };
    return { ok: false, error: { code: body.error?.code ?? `helm.http_${res.status}`, message: body.error?.message ?? `Helm’s authority service answered ${res.status}.` } };
  };
}
