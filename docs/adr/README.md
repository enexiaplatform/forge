# Architecture decision records

Each decision, why it was made, and what it costs. Format: context · decision · consequences.

| ADR | Decision |
| --- | --- |
| [0001](0001-commitment-as-the-central-object.md) | The commitment is the central object; tasks are not modelled |
| [0002](0002-separate-repository-shared-database.md) | A separate repository on Helm's shared database; contracts, not shared code |
| [0003](0003-append-only-events-derived-state.md) | Append-only events; every status derived at a lens, none stored |
| [0004](0004-evidence-requirements-and-matchers.md) | Evidence requirements with matchers; only a specific matcher is watched |
| [0005](0005-authority-as-a-port.md) | Authority is a port; an interim policy until Helm's service answers it |
| [0006](0006-epistemic-classes.md) | Six epistemic classes on everything shown; inferences never become facts by repetition |
| [0007](0007-intake-tree-from-helm-decisions.md) | A committed Helm decision becomes an outcome commitment and one child per action intent |
| [0008](0008-postgres-proven-on-pglite.md) | The Postgres adapter is proven on PGlite applying the real migration, under RLS |
| [0009](0009-candidates-are-inference-until-a-person-confirms.md) | What Forge reads becomes a candidate — inference — until a person confirms, edits or dismisses it |
| [0010](0010-memoire-promises-are-linked-not-copied.md) | Memoire owns the promise; an enterprise obligation is promoted by link, through API v1 and verified webhooks |
| [0011](0011-verified-outcome-publication.md) | A verified outcome is published; Helm records it through its own outcome-review API |
| [0012](0012-llm-extraction-governance.md) | The first model job reads notes; Forge's governance, not the model, decides what is offered |
| [0013](0013-trusted-authority-gate-and-deployment-progression.md) | Consequential acts need a trusted authority in production; Local → Staging → Helm authority → production |
| [0014](0014-execution-records-are-observed-facts.md) | Execution records are observed facts with their sample — never a score, rank or rating |
| [0015](0015-helm-visibility-inherited-sensitivity-not-yet.md) | Forge inherits Helm's decision visibility; value sensitivity is a named gap |
| [0016](0016-integration-suite-runs-the-siblings-own-code.md) | The integration suite runs Helm's and Memoire's own code, schemas and rules |
| [0017](0017-sensitivity-never-lowers.md) | A fact keeps its sensitivity wherever it goes: carried, sealed, enforced by Helm's own clearance |
| [0018](0018-submitting-outcomes-through-helms-governed-intake.md) | Verified outcomes reach Helm through Helm's governed intake, as contextual facts; the genome references the episode, typed and pinned |
| [0019](0019-decision-fidelity-is-a-record-of-departures.md) | Decision fidelity: where execution departs from what Helm committed, as a derived record — never scored |
| [0020](0020-words-keep-the-ceiling-of-their-commitment.md) | Words people write take the ceiling of their commitment: stamped, sealed, enforced in both stores — never classified, never lowered |
| [0021](0021-acts-that-bind-accountability-rest-on-helms-standing.md) | Acts that bind accountability rest on Helm's standing attestation; Forge's database binds it to the act; an organization moves to TRUSTED authority on the record |
| [0022](0022-reading-an-organization-at-scale.md) | Reading at scale: pages and slices so nothing is truncated, a reader's warm ledger, remembered derivations — never stored state |
| [0023](0023-the-transport-between-the-products.md) | The transport: Forge sends outcomes as the person to Helm's own intake host and derives what is pending; Forge hosts its Memoire receiver |
| [0024](0024-words-carry-only-what-their-writer-could-read.md) | Words carry only the classes of their commitment's ceiling that their writer could read — a cleared writer is sealed as before |
| [0025](0025-precedents-bring-lessons-back.md) | Precedents: concluded commitments that resemble this one, and lessons that may apply, as labelled inference — never ranked |
| [0026](0026-what-became-of-the-assumptions.md) | What became of the assumptions: a person says held or broke, with a reason; a broken one asks the principal; across decisions, counts and cases — never a rate |
| [0027](0027-the-open-door-for-execution-surfaces.md) | The open door: forge.observation.v1 — any surface reports its own records, signed, kept once in a durable ledger, ingested like Helm's and Memoire's |
| [0028](0028-value-as-claimed-and-as-realized.md) | Value, as claimed and as realized, beside what it took — commitments, people, days; nothing priced, no ratio, no ranking |
| [0029](0029-what-work-waited-on.md) | What work waited on: each dependency, how often it came after the date it was needed, and every case — never a rate |
| [0030](0030-reading-a-review-for-what-it-taught.md) | Reading a review: Forge proposes the notes' own explanations and lessons as inference; a person records one, and it remembers where it came from |
