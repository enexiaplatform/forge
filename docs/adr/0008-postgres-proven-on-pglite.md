# ADR-0008 — The Postgres adapter, proven on PGlite

**Context.** Helm's Postgres conformance suites are skipped for want of an isolated,
authenticated environment (its blocker B). A store that has never met its database is
not proven.

**Decision.** The Postgres store speaks through a narrow `TableClient` (insert rows,
select rows), implemented over supabase-js or raw SQL. Tests run PGlite, apply a stub of
Supabase (roles, `auth.uid()`, default privileges) and of Helm's organization layer,
then the real Forge migration, and run the store conformance suite as authenticated
users under row-level security — plus refusals, each paired with a legal control.

**Consequences.** Tenancy, append-only guards, database record time, actor integrity
and the epistemic CHECKs are proven on real Postgres. The stub can drift from Supabase
and Helm, and the shared project itself stays unproven until the migration is applied.
