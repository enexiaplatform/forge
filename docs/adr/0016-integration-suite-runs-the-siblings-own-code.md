# ADR-0016 — The integration suite runs Helm's and Memoire's own code

**Context.** Contracts shaped like a sibling's types prove only that Forge agrees with
itself. The three loops — Helm decision → Forge commitment, Memoire reality → Forge
observation, Forge verified outcome → Helm memory — need the siblings' real code,
schemas and rules.

**Decision.** `integration/` runs, read-only from the sibling repositories:

- **Loop 1.** One PGlite database with a Supabase stub, Helm's nineteen migrations and
  Forge's. Helm's canonical decision (Helm's own harness) is written by Helm's own
  `PostgresDecisionStore` through a PostgREST-shaped client, as signed-in users under
  Helm's RLS; ids are mapped and the fingerprint recomputed with Helm's
  `commitmentFingerprint`. Forge reads Helm's tables under the same RLS; every column it
  reads is checked against Helm's adapter and Helm's schema.
- **Loop 2.** Memoire's sixty-seven migrations in a database of its own; Memoire's
  Commercial API v1 handler, SDK, revision triggers, delivery RPCs and webhook worker.
- **Loop 3.** Helm's decision runtime and genome (Helm's harness) taking Forge's
  publication through `recordOutcomeReview`, `openEpisode`, `bindRef`, `proposePattern`
  and `classifyEpisode`.

Stood in, and only these: Supabase Auth's token check, the network (in-process fetch and
webhook delivery), Helm's scenario runs (alternatives replayed as unmodelled, with the
reason), and pgvector (Memoire's embedding columns become `real[]`; they are off the
commitments path). A module-resolution hook maps `@helm/*` to Helm's sources without
installing anything into Helm. When a sibling is absent its loop is **skipped and says
so**, never passed.

**Consequences.** The suite found two real defects — Forge widening Helm's decision
visibility (ADR-0015) and Forge refusing Memoire's newer `shared-workspace` notification
(ADR-0010) — and one named gap (sensitivity). It does not prove the shared Supabase
project, Supabase Auth, or PostgREST itself.
