# ADR-0005 — Authority is a port

**Context.** §16: Forge must not invent its own permission philosophy; authority belongs
to Helm's Decision & Authority Runtime, whose trusted service is not yet deployed. AI
agents must follow the same boundaries.

**Decision.** `AuthorityPort.evaluate(scope, act, view)` returns ALLOWED,
REQUIRES_APPROVAL (naming the approver) or REFUSED, with a policy and a rule. The interim
policy `forge-interim-authority@1` encodes only what a commitment already implies:
owners accept and report delivery; principals change the promise; an owner's change
becomes a request the principal decides; agents propose and infer only; connectors
report only; viewers read. Every event records the verdict it rested on.

**Consequences.** Swapping in Helm's authority rewrites no history. Until a trusted
service evaluates acts server-side, authority is enforced in the runtime, not in the
database — a gap Forge shares with Helm (its blocker A).
