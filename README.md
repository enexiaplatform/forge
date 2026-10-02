# Forge

**Commitment & Outcome Execution Infrastructure — part of the Helm ecosystem**

> Organizations do not fail because they lack tasks. They fail because intent,
> accountability, execution, outcomes and learning become disconnected.
> Forge reconnects them.

Forge turns enterprise decisions into accountable commitments, observes execution
where it already happens, proves outcomes with evidence rather than status reports,
and keeps what the enterprise learned:

```text
WHY → DECISION → COMMITMENT → OWNERSHIP → EXECUTION → EVIDENCE → OUTCOME → LEARNING
```

Memoire knows commercial reality. Helm understands and decides. **Forge commits,
executes and observes the outcome**, and Helm learns from it. Forge shares Helm's
database and identity, reads Helm and Memoire, and never writes to either.

- What Forge is for: [the source of truth](docs/product/source-of-truth.md)
- How it is built: [the architecture](docs/architecture/forge-architecture.md) — start here
- Where it meets Helm and Memoire: [ecosystem boundaries](docs/architecture/ecosystem-boundaries.md)
- Why: [architecture decisions](docs/adr/README.md) · Look: [visual system](docs/product/visual-system.md)
- What comes next: [the development plan](docs/product/development-plan.md)

## Run it

```bash
npm install
npm run dev        # http://localhost:5193 — the DEMO Meridian story, in memory
npm run check      # typecheck, lint, tests, the three integration loops, contracts
npm run build
```

`npm run test:integration` runs the three loops against Helm's and Memoire's own code,
read from `../Helm` and `../Memoire` (or `FORGE_HELM_REPO` / `FORGE_MEMOIRE_REPO`); without
them it skips and says so. Reading notes with Claude needs `ANTHROPIC_API_KEY` in the
dev server's environment; without it Forge uses its offline reference extractor. The live
model test is opt-in: `FORGE_LIVE_LLM=1 node --test server/test/claude.live.test.mjs`. The controlled
extraction test (`npm run eval:extraction`, live with `FORGE_LIVE_LLM=1 npm run eval:extraction:live`) scores
an extractor against hand-labelled SYNTHETIC notes; its scorer is itself tested with a stand-in model that
plants one of each failure it counts.

The demo opens on **1 October 2026** in Meridian Life Sciences Vietnam, a week after
management committed in Helm to reallocate Distributor D's consignment stock to serve
Rohto's Q4 order. Pick who you are reading as, act on what Forge asks of them, and move
the demo clock forward: the release slips and Helm's own review trigger fires; the ERP
contradicts a delivery someone confirmed; the outcome lands below the committed future;
a lesson is kept and the verified outcome is published for Helm. A promise Forge read in
Memoire waits as a candidate for the Commercial Director to confirm; at the QC hold,
Forge reads the review's notes and proposes what was promised in them. A second Helm
decision waits to be drafted into commitments. Every object is labelled DEMO and lives
in memory; nothing is written anywhere.

## What is in it

| | |
| --- | --- |
| `packages/kernel` | the commitment, its append-only events, and everything derived from them — phase, terms, evidence, conditions and asks, variance, authority, episodes; an in-memory store and a Postgres store |
| `packages/fabric` | Helm's tables and value graph read under its RLS, Memoire's Commercial API v1 and webhooks, intake, execution surfaces and ingestion, the inference and extraction ports, and what Forge publishes for Helm |
| `packages/demo` | DEMO data and the Meridian story as moments |
| `src` | the console: Asks (with candidates and reading notes), Commitments, a commitment's chain, Decisions with trace and intake, Memory (with execution records), Surfaces |
| `server` | the Claude extractor and `/api/extract` — the only place a model SDK lives |
| `integration` | the three loops against Helm's and Memoire's own code and migrations |
| `supabase/migrations` | `forge_*` tables for the shared database — **not applied** |

## Status, plainly

Proven: the three integration loops against the siblings' own code (ADR-0016) — a Helm
decision written by Helm's Postgres adapter and read by Forge under Helm's RLS, with
Helm's visibility and clearance rules holding; Memoire's API v1 handler, SDK, revision
triggers and webhook worker feeding Forge's verified receiver; Forge's verified outcome
submitted to Helm's governed intake as contextual facts, adopted into Helm's outcome review, and referenced by
Helm's genome as a typed, pinned execution episode (ADR-0018) — the whole chain, decision to Helm's learning, in one
Postgres under Helm's guards (loop 1). Sensitivity never lowers: Helm's classes are carried
and enforced in Forge (ADR-0017). Each decision shows where execution departed from what Helm committed, as a
record — never a score (ADR-0019), and those departures travel to Helm with the outcome (Helm ADR-0038). Words people write keep the ceiling of their commitment, as far as their writer could read it (ADR-0020, ADR-0024). When something begins, Forge brings back the precedents it resembles and the lessons that may apply (ADR-0025); when it ends, people say which assumptions held and which broke (ADR-0026). Any system can report its own records through one open, signed contract, `forge.observation.v1` (ADR-0027). Acts that bind accountability rest on Helm's standing attestation, checked by Forge's database (ADR-0021). Reads stay whole and fast at organization scale (ADR-0022). Outcomes reach Helm through Helm's own intake host, and Memoire's webhooks through Forge's (ADR-0023). 206 unit tests, 46 integration tests,
and three contracts, each new rule broken on purpose once and seen to catch it. The
console is exercised in a browser.

Not proven or not built: no migration is applied to the shared Supabase project and no
staging branch exists; Helm's standing and intake are proven with Helm's code in one
database, not through deployed edge functions, and no organization is TRUSTED anywhere
(production stays gated, ADR-0013); the Claude extractor has not been run live; execution
surfaces other than Helm and Memoire are fixtures. Details:
[architecture §14–15](docs/architecture/forge-architecture.md#14-what-is-not-proven).
