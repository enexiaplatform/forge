# ADR-0002 — A separate repository on the shared database

**Context.** Helm and Memoire are separate repositories sharing one Supabase project,
one identity and Helm's organization layer. Helm keeps its boundary with Memoire by
contract tests, not by sharing code.

**Decision.** Forge is its own repository with its own packages, on the same shared
database. Its tables are `forge_*`, carry `org_id`, and use Helm's `is_org_member` and
`has_org_role`. Forge imports no Helm code: it mirrors Helm's conventions (ports,
`Result`, injected clock, fingerprints, derived statuses) and reads Helm through a read
model shaped like Helm's own types. Migrations are additive and `forge_*` only.

**Consequences.** Forge ships on its own cadence and Helm's kernel is not coupled to it.
A small amount of convention is duplicated (`primitives.ts`). A change to Helm's
decision types must be reflected in `fabric/helm.ts` by hand — the read model is the
contract.
