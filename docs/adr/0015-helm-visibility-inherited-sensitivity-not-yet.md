# ADR-0015 — Forge inherits Helm's decision visibility; value sensitivity is not yet carried

> **Update, 2026-10-01:** the sensitivity gap below is closed by [ADR-0017](0017-sensitivity-never-lowers.md); the loop 1 test that named it now passes.

**Context.** Helm shows a decision only to organization admins, its creator, and the
units it is shared with. Its value graph additionally restricts sensitive metrics
(gross margin and cash are `FINANCIAL_SENSITIVE`) to people cleared for them. Forge's
first read policy was organization-wide, so a commitment drafted from a restricted
decision — its question, expected outcomes, trade-offs — was visible to every member
through Forge. Loop 1 found this.

**Decision.** `forge_commitments.helm_decision_id` is derived by the database, never
supplied: from the origin when it names a Helm decision commitment (resolved by a
`SECURITY DEFINER` lookup), else from the parent, so a whole tree shares its root's
reach. Commitments and their events are read and written only where Helm's own
`helm_private.can_see_decision` allows (migration `20261003090000`); Helm's helper is
called, not copied. A Helm origin that does not resolve is refused once Helm's tables
exist. Sharing the decision in Helm shares its execution in Forge.

**Consequences.** Proven on Postgres with Helm's migrations: a member Helm hides the
decision from sees none of its Forge commitments or events and cannot act on them, and
sees and acts on them once the decision is shared with their unit. `verify:schema`
refuses a later policy that drops the rule. **Gap, named:** Forge's value surface reads
Helm's actuals as the reader, so Helm's clearance applies to the read — but once an
actual is Forge evidence, any reader of the commitment sees it. A member without
financial clearance can therefore read a margin actual in Forge's evidence. The
integration suite carries this as a `todo` test. Closing it means evidence carries
Helm's sensitivity class and Forge's event policy consults Helm's clearance — to be
designed with Helm before the tables reach production.
