# Forge — the next development plan

**Written** 2 Oct 2026 · **Baseline when written** 142 unit, 37 integration, three contracts ·
**Reads with** [source of truth](source-of-truth.md) · [architecture §14–15](../architecture/forge-architecture.md#14-what-is-not-proven) ·
[ADR-0013](../adr/0013-trusted-authority-gate-and-deployment-progression.md)

## Status — 2 Oct 2026, end of day

| Item | State | Where |
| --- | --- | --- |
| 0.1 Commit | **Done.** Forge on `main`, pushed to github.com/enexiaplatform/forge. Helm's work on local branch `forge/execution-outcomes` (4 commits), not pushed | — |
| 0.2 Staging route | **Waiting on the owner** — a paid plan or pausing a project is the owner's decision | [staging runbook](../operations/staging.md) |
| 0.3 API key | **Waiting on the owner** — no Forge-owned `ANTHROPIC_API_KEY` exists | — |
| 1.1–1.4 | **Blocked** on 0.2 and 0.3; every script is ready and proven locally (the staging suite now has eleven contracts) | — |
| 2.1 Trusted authority | **Done.** Helm attests standing (Helm ADR-0036); Forge binds every consequential act to it in the database (ADR-0021); integration loop 4 | ADR-0021 |
| 2.2 Transport | **Done, not deployed.** Helm's intake host and edge function (Helm ADR-0037); Forge's derived outbox (`deliverOutcomes`); Forge's Memoire webhook host (ADR-0023) | ADR-0023 |
| 2.3 Free text | **Done.** Words take their commitment's ceiling, sealed and enforced in both stores (ADR-0020) | ADR-0020 |
| 2.4 Scale | **Done.** Found and fixed silent truncation at PostgREST's row cap; warm ledger and remembered derivations (ADR-0022). Numbers below | ADR-0022 |
| 3.1 Departures to Helm | **Done.** Typed, each at its classes (Helm ADR-0038); loop 1 sends the Rohto departures | Helm ADR-0038 |
| 3.2 A real execution surface | **Not started** — needs the owner to name a system and a sandbox; a fixture reader does not count | — |
| 3.3 Assumptions against what happened | **Not started** — needs the owner's boundary decision; nothing yet maps an observation to a Helm assumption without inference | — |
| 4 Production | **Closed** until stage 1 runs on staging and an organization is recorded TRUSTED there | Stage 4 checklist |

**Features since (2 Oct, later):**

| Feature | ADR |
| --- | --- |
| Precedents — concluded commitments that resemble a new one, and lessons that may apply, at intake and acceptance | ADR-0025 |
| Words carry only what their writer could read — operational lessons no longer sealed from their own authors | ADR-0024 |
| Assumptions held or broke — said by people, a broken one asks the principal, a record across decisions | ADR-0026 |
| forge.observation.v1 — the open, signed door for any execution surface, with a durable observation ledger | ADR-0027 |
| Value, as claimed and as realized, beside what it took | ADR-0028 |
| What work waited on — dependencies and their lateness, as a record | ADR-0029 |
| Reading a review for what it taught — proposed explanations and lessons, recorded by a person | ADR-0030 |

The 3.2 question changes shape: any system can now report through forge.observation.v1, so what waits on the owner is
an adapter author and a sandbox to prove one real surface end to end, not a Forge connector.

`npm run check`: 220 unit (one opt-in live test skipped), 46 integration, three contracts — green.

**Reads at scale** (`npm run bench:reads`, SYNTHETIC, 10 000 commitments, 186 668 events; PGlite under RLS):

| Reading | Read whole | Through the ledger cache |
| --- | --- | --- |
| The ledger (every commitment) | 8.5 s | first 19.1 s, then **50 ms** |
| Conditions across the organization | 8.4 s | 59 ms |
| One trace | 8.5 s | 42 ms |
| The ledger after one write | 8.6 s | 42 ms |

In memory the same ledger reads in 60–100 ms (it was about 1 s before the store stopped copying on every read).

## Where Forge stands

The whole chain — a Helm decision, Forge's commitments, evidence from Memoire and fixtures, the verified outcome
through Helm's governed intake, Helm's genome binding the episode — runs on one Postgres under Helm's own guards
(PGlite). Sensitivity never lowers (ADR-0017), outcomes reach Helm as contextual facts (ADR-0018), and departures from
the committed decision are a derived record (ADR-0019).

What stands between this and an enterprise relying on it is not more surface. It is five gaps, in the order they
block production:

| Gap | Why it blocks |
| --- | --- |
| **Nothing is committed**, in Forge or in Helm's Phase 3 work | one bad disk or one wrong edit loses three days of proven work; no review is possible |
| **No staging** | no migration has met Supabase Auth, PostgREST or the advisors; ADR-0013's second step |
| **No trusted authority for Forge's acts** | Helm's trusted service (Helm ADR-0024) evaluates *decision* commitments only; Forge's accept, decide-a-change, close and reopen have nothing trusted to answer them, so production stays gated (ADR-0013) |
| **No transport** | a submission to Helm's intake and a Memoire webhook are composed in the test suite; nothing hosts them |
| **Free text is unclassified** | a reason or a lesson can quote a protected value and carry it below its class (architecture §14) |

Scale (every read derives every commitment of an organization) is a sixth, and becomes a gap at staging volume.

## The plan

Four stages. A stage ends when its proof exists, not when its code does. Items marked **owner** wait on a decision
only the product owner can take; everything else can start now.

### Stage 0 — make the work durable (days)

| # | Item | Done means |
| --- | --- | --- |
| 0.1 | **owner** — Commit Forge as its first commit on `main`; commit Helm's Phase 3 work (ADR-0034, ADR-0035, migration `20261005090000`, `verify:execution-intake`) on a branch in Helm | both repos have history; `npm run check` green at that commit |
| 0.2 | **owner** — Choose the staging route: Pro plan and a `forge-staging` branch of `memories`, or pause/upgrade a free project and create a separate `forge-staging` project ([staging runbook](../operations/staging.md)) | a staging target exists, or the decision to wait is recorded |
| 0.3 | **owner** — Provide a Forge-owned `ANTHROPIC_API_KEY` for one controlled run (never Memoire's) | key present in the dev server's environment only |

### Stage 1 — prove it on real infrastructure (one to two weeks after 0.2/0.3)

| # | Item | Done means |
| --- | --- | --- |
| 1.1 | **Live extraction eval** — `npm run eval:extraction:live` on the SYNTHETIC gold meetings; record precision, missed promises and every governance refusal in [docs/evals](../evals/extraction-reference.md) | a dated result beside the reference extractor's; a written rule for when Claude becomes the default extractor (or why not yet) |
| 1.2 | **Staging schemas and advisors** — Helm's migrations then Forge's, per the runbook; fix every advisor finding on `forge_*` and `helm_execution_*` | advisors clean for both namespaces |
| 1.3 | **Staging contracts** — `supabase/tests/staging-contracts.sql` as `postgres` | nine contracts pass on the real database |
| 1.4 | **Loops through Auth and PostgREST** — run the integration loops against staging with a signed-in test session through `createSupabaseTableClient` | loop 1–3 green over the network; architecture §14 "live services" narrowed to what is still not exercised |

### Stage 2 — close the trust gaps (the path to production, two to four weeks; parallel with stage 1)

These are what ADR-0013 actually waits on. 2.1 and 2.2 change both products and need the owner's say for the
Helm half (this repository's rules forbid editing Helm from here without it).

**2.1 Trusted authority for execution acts** — Forge ADR-0020 with a matching Helm ADR.

- *Helm side:* one more operation on Helm's trusted service, with the same discipline — allowlisted body, every
  fact loaded by the service, nothing supplied by the client:
  `{ op: 'evaluate-execution-act', orgId, forgeCommitmentId, act }`. The service reads the Forge commitment and its
  events (read-only; Helm never writes Forge), resolves who holds the act — the owner, the principal, or a Helm
  authority rule for execution acts above a line — and records an evaluation with
  `evaluator.kind = TRUSTED_SERVICE`.
- *Forge side:* `createHelmAuthority` answering `kernel/authority.ts`, trusted only when Helm's verdict is; every
  consequential event carries the Helm evaluation id; a database check refuses a trusted verdict whose evaluation
  does not exist in Helm's table (a read, not a write).
- *Proven by:* the conformance suite with `requireTrustedAuthority` on; integration loop 1 with Helm's real
  service in-process; a tampered client recording "trusted" refused in Postgres.

**2.2 Transport** — Forge hosts what the suite now composes; nothing new is invented.

- an **outbox relay** (`server/`, or a Supabase edge function): reads `outboundEvents()` — derived, keys stable —
  and submits `helm.execution-outcome.v1` to Helm's intake as the publishing person; a receipt is a fact, a refusal
  is an ask to the principal;
- the **Memoire webhook receiver** hosted (`fabric/memoireWebhooks.ts` is already the verified handler);
- *proven by:* replaying the stream twice delivers once; a dropped connection resumes from the last receipt;
  Helm's refusal of a lowered class reaches the principal as an ask.

**2.3 Free text keeps its ceiling** — Forge only; an ADR-0017 amendment.

- a reason, an explanation or a lesson takes, by default, the highest class of what the commitment rests on, and is
  sealed with it; the writer may raise it, never lower it; lowering is a Helm clearance act, not a Forge field;
- no classifier decides — a model may at most *flag* a passage as possibly quoting a value (INFERENCE), for the
  writer;
- *proven by:* a lesson on a commitment resting on a protected margin is invisible to an uncleared reader in memory
  and on PGlite; `verify:schema` refuses a free-text column without a class.

**2.4 Reads at organization scale** — Forge only.

- a SYNTHETIC benchmark: 10 000 commitments, 200 000 events; measure the console's reads;
- then derive per commitment, memoized by the event high-water mark in memory — never a stored state column
  (`verify:schema` stays as it is);
- *proven by:* the benchmark's numbers in this file, before and after; conformance unchanged.

### Stage 3 — depth, still narrow (after stage 2's ADRs are accepted)

Each item deepens §15's traceability without a new kind of screen. Each needs one owner decision before it starts.

| # | Item | Owner question |
| --- | --- | --- |
| 3.1 | **Departures travel with the episode** — ADR-0019's record carried to Helm in the execution outcome, so the genome can learn *where decisions lose fidelity* | Helm's contextual-fact schema gains a typed departure; Helm's say |
| 3.2 | **One real execution surface** beyond Helm and Memoire — activity only from a tracker (Jira), or evidence from a system of record (ERP shipment) | which system, and a sandbox to prove it against; a fixture-shaped reader does not count (product decision 8) |
| 3.3 | **Assumptions against what happened** — for each Helm assumption a commitment rests on, the observations that bore on it, as a record with its sample | whether Forge records this or only hands Helm the observations (Helm owns LEARN) |

### Stage 4 — production

Applying `forge_*` to the shared project happens once, on the owner's say-so, when every line holds:

- [ ] stage 1 green on staging, including the loops through Auth and PostgREST
- [ ] 2.1 — Helm's trusted service answers Forge's authority port through its deployed edge function, and the organization is recorded TRUSTED (proven locally in one database)
- [ ] 2.2 — the relay delivers to Helm's intake on staging, once per key (proven locally)
- [x] 2.3 — free text sealed at its ceiling
- [ ] advisors clean; Helm's own Postgres suites green on staging
- [ ] a rollback note: Forge's migrations are additive, so rolling back is revoking Forge's grants, not dropping tables

## What this plan will not do

- add a screen for breadth, a task, a board, a progress field, a score or a ranking;
- move work into Forge that a system of record already does;
- let a model accept, approve, close or speak for a person;
- touch the shared project before stage 4.

## Start now, without waiting

In order: **0.1** (the owner's commit), then **2.3** and **2.4** — Forge-only, no money, no Helm change — while the
owner decides **0.2**, **0.3** and whether to open the Helm half of **2.1** and **2.2**.
