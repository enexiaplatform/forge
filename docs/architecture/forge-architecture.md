# Forge — Architecture

The one document that describes Forge as built. It answers the
[source of truth](../product/source-of-truth.md) section by section, states the
distinctions Forge will not blur, and is plain about what is proven and what is
not. Decisions and their reasons are in the [ADRs](../adr/README.md); how Forge
meets Helm and Memoire is in [ecosystem-boundaries](ecosystem-boundaries.md).

## 1. What Forge is

Forge is the execution layer between enterprise decisions and enterprise
outcomes. It holds one central object — the **commitment**: an accountable
promise, made by an owner to a principal, to produce an outcome, by a date,
proven by evidence — and keeps the chain from why it exists to what the
enterprise learned from it:

```text
WHY → DECISION → COMMITMENT → OWNERSHIP → EXECUTION → EVIDENCE → OUTCOME → LEARNING
```

It is not a project-management tool. There are no tasks, boards, sprints or
percent-complete fields. Work happens wherever the enterprise already does it —
Jira, the ERP, the warehouse, Memoire — and reaches Forge as **execution links**,
**activity** and **evidence**.

In the Helm ecosystem Forge owns COMMIT → EXECUTE → OBSERVE OUTCOME. It reads what
Helm decided, turns it into commitments people own, observes execution where it
happens, and publishes what happened in the envelope Helm already reads. It never
writes into Helm or Memoire.

## 2. The stack

```text
packages/kernel   @forge/kernel   the commitment, its events, everything derived      pure; postgres.ts is the one I/O boundary
packages/fabric   @forge/fabric   Helm and Memoire read models, intake, surfaces,     depends on the kernel only
                                  ingestion, inference port, outbound events
packages/demo     @forge/demo     DEMO: Meridian after Helm's Rohto decision          depends on kernel + fabric
src/                              the console (React 19, Vite, Tailwind 3)            presentation only
supabase/migrations               forge_* tables on the shared database               additive, forge_* only
```

Layers point one way — kernel ← fabric ← demo ← app — and `verify:boundaries`
fails the build if they do not. The stack and conventions deliberately mirror
Helm's (ports with an in-memory and a Postgres implementation, `Result` at
boundaries, injected clock and ids, statuses derived and never stored), so the two
read alike; but Forge imports no Helm code. They meet through data contracts
([ADR-0002](../adr/0002-separate-repository-shared-database.md)).

## 3. The model

```text
CommitmentRecord (written once)
  origin ── kind · system · ref · label · fingerprint · immutable snapshot      (reference + snapshot, never a copy)
  terms ─── statement · intendedOutcome · why · owner · principal · dueBy
            evidence requirements (OUTPUT | OUTCOME, with a matcher)
            measures (expected, comparator) · value claims (precision explicit)
  capture ─ per term: INHERITED · SYSTEM_EVENT · EXTRACTED · INFERRED · CONFIRMED · MANUAL
  context ─ inherited facts with their source, class and shared-entity reference
  parentId  the commitment it decomposes

CommitmentEvent (append-only, many)
  ACCEPTED · DECLINED · CHANGE_REQUESTED · CHANGE_DECIDED · TERMS_CHANGED
  DEPENDENCY_DECLARED · DEPENDENCY_SETTLED · EXECUTION_LINKED · ACTIVITY_OBSERVED
  EVIDENCE_RECORDED · EVIDENCE_DISPUTED · OUTCOME_OBSERVED
  CONTEXT_CHANGED · CONTEXT_REAFFIRMED · CLOSED · REOPENED · LEARNING_RECORDED
  each with: actor (PERSON | AGENT | SYSTEM) · effective time · record time · reason · authority verdict · idempotency key

Derived at a lens, never stored (derive.ts, conditions.ts, variance.ts, episode.ts)
  phase (PROPOSED · ACTIVE · DECLINED · CLOSED) · current terms · requirement status
  conditions and asks · variance · the execution episode
```

| Primitive (§6) | Where it lives |
| --- | --- |
| Decision | an `Origin` — a reference to a Helm decision commitment with its fingerprint and a frozen snapshot |
| Commitment | `CommitmentRecord` + its events |
| Owner | `terms.owner` — and `ACCEPTED`, because ownership is not assignment: nothing binds an owner until they accept |
| Dependency | `Dependency` on another commitment (settles itself when that one is delivered), an external object (settled by an observation), or a party |
| Evidence | `EvidenceItem` with an epistemic class, a channel and a source; requirements say what would prove the promise |
| Outcome | `ObservedOutcome` — what changed, measure actuals, realized value — kept apart from activity and output |
| Variance | `varianceOf()` — time, scope, each measure, each value claim, and the activity-to-outcome gap, never summed |
| Learning | `LEARNING_RECORDED` — explanations and lessons, attributed |

## 4. Distinctions Forge will not blur

| Distinction | Enforced by |
| --- | --- |
| **Activity ≠ output ≠ outcome ≠ value** (§7) — tracked issues are activity on a link and never evidence; requirements are OUTPUT or OUTCOME; value is stated, not inferred | the model; `variance.activityOutcomeGap`; story test "delivery day" |
| **Evidence ≠ status report** (§12) — a requirement is EVIDENCED by a fact, and the record says whether a system or only a person stood behind it | `requirementState`; schema has no status or progress column (`verify:schema`, `verify:boundaries`) |
| **Fact ≠ inference** (§20) — an inference never satisfies a requirement; a person files facts, an agent files inferences, a connector files system records | kernel validation, interim authority, and two CHECK constraints in Postgres |
| **Ownership ≠ assignment** (§6) — a proposed commitment binds nobody; reassignment sends it back for acceptance | `ACCEPTED`; runtime tests |
| **Delay and rescoping ≠ endings** (§13) — seven resolutions; a moved date keeps the date first promised | `resolutions`; `originalDueBy`; variance against original and agreed dates |
| **A conflict ≠ something to average** — facts that disagree ask a person; disputed evidence stays on the record and stops counting; a system's later record of the same object supersedes its earlier one | `CONFLICTED`; `EVIDENCE_DISPUTED`; `supersede()` |
| **Visibility ≠ authority** (§16) — reading a commitment confers no right to change it | authority port; per-reader acts in the console |
| **A departure ≠ a fault** (§13–§15) — where execution parts from what Helm committed is listed with who asked, why and on what authority, and never scored | `decisionFidelity` (ADR-0019); `verify:boundaries` records rule |
| **Recorded ≠ effective time** — when it happened and when Forge learned it are both kept; any reading is reproducible at its lens | `Lens`; story test "reading at an earlier moment" |

## 5. Time

Every event carries `effectiveAt` (when it happened) and `recordedAt` (when Forge
learned it, stamped by the store — by the database in Postgres). A **lens** is a pair
`(asOf, recordedThrough)`. `lensAt(t)` reads as Forge knew things at `t`; a later
fact never changes an earlier reading. The default reading, `latestAt(now)`, sees
everything recorded and judges deadlines at now — so a browser whose clock runs
behind the database still sees what it just wrote.

## 6. Zero redundant entry (§9, §11)

Intake (`fabric/intake.ts`) turns one committed Helm decision into a tree: an
**outcome commitment** owned by the decision owner — measured by the outcomes Helm
expected, read from the committed future state — and one **child per action
intent**, owned by the person Helm named. Every term is marked:

- INHERITED from Helm or Memoire (the question, the summary, rationale, trade-offs,
  assumptions, owners, dates, expected values, the account and the opportunity);
- INFERRED by the inference port, for the owner to confirm when accepting;
- MISSING — the only inputs the intake page shows.

For the Rohto decision: 34 facts inherited, 8 inferred, nothing to type. For the
buffer decision: 28 inherited, 7 inferred, and 2 missing fields — which are the
whole form. The commitment
page reports how many of its terms a person typed.

## 7. Evidence over status reporting (§12, §24)

An **execution surface** is any system that records work or results, reached
through one port; it reports **observations** (`fabric/surfaces.ts`). Ingestion
(`fabric/ingest.ts`) asks four questions of every observation:

1. **Activity** — about an object a commitment is linked to, with done/total? Recorded as activity, never evidence.
2. **Evidence** — does it match a requirement's matcher? A matcher that pins an object
   reads a different payload from that object as a contradiction; one that pins
   none only filters. A matcher that names no object and filters on nothing is
   never acted on — "any stock transfer" is not evidence of this one — and the
   console says so until the owner names the object.
3. **Dependency** — does it settle something a commitment waits on?
4. **Context** — does it change the world a commitment rests on (a lost opportunity, a reconsidered decision)?

Everything is recorded by the source's connector as a SYSTEM actor, idempotently.

## 8. Authority (§16)

Forge has no permission philosophy of its own. Authority is a **port**
(`kernel/authority.ts`); its interim implementation, `forge-interim-authority@1`,
applies what a commitment already implies:

- the owner accepts or declines, and reports delivery (fulfilled, partly, missed);
- the principal — the party the promise was made to — changes it; an owner's redate,
  rescope, handover or withdrawal becomes a change request the principal decides;
- the principal publishes the verified outcome for Helm;
- an **agent** may propose, infer and suggest candidates, never accept, approve, close,
  confirm a candidate or speak for a person;
- a **connector** may only report its system's records and suggest what it read;
- a viewer reads.

Every event records the verdict it rested on (policy, rule, statement, approval,
**trusted or not**). The interim policy's verdicts are untrusted. With
`requireTrustedAuthority` — on in production — consequential acts (accept, decide a
change, change, close, reopen) are refused unless a trusted authority answered:
Helm's Decision & Authority Runtime, when it answers the same port (ADR-0013).

**Helm answers it** (ADR-0021; Helm ADR-0036). `createHelmAuthority` asks Helm's trusted service to attest, from Helm's
own seat records, that the caller may act for the party who holds the act — themselves, or acting in that person's
seat — never taking the client's word for whom it acts; Forge's rule then decides with that attested party, and the
verdict carries Helm's attestation id. **The database checks it**: an event that claims a trusted verdict must name an
attestation that is Helm's, recent, the writer's own and for the person who holds that act on that commitment
(`forge_events_standing`); and once an organization is recorded as TRUSTED (`forge_authority_modes`, service role only),
every consequential event needs one — the interim policy cannot decide them, even from a client that skips the runtime.

## 9. Human-in-the-loop by exception (§21)

`conditionsOf()` derives facts about a commitment at a lens — awaiting acceptance,
declined, past due, evidence conflict or contradiction, an unconfirmed inference,
evidence complete, a late or at-risk dependency, a change awaiting decision, a
material context change, an unrecorded outcome, an unpublished verified outcome, open
learning — each with a severity (cannot wait · this week · noted) and, where a person
must act, one **ask** to one party with the acts that answer it. Forge never asks for
a status, and asks nobody twice: a learning recorded higher in the tree answers for
what is beneath it. Candidates read from notes and Memoire wait on Asks beside them
(ADR-0009).

## 10. AI (§20)

Two ports, both proposing and neither deciding.

- The **inference port** (`fabric/inference.ts`) proposes what nobody has stated —
  what would prove an intent, which value dimension a metric speaks to — through the
  deterministic `forge-reference-rules@1`, every proposal labelled INFERENCE with its
  rule.
- The **extraction port** (`fabric/extraction.ts`) reads meeting notes for candidate
  commitments (ADR-0012). The Claude extractor (`server/extraction/claude.ts`,
  `claude-opus-5-5`, structured outputs, server-side only) and the offline
  `forge-reference-extractor@1` return raw findings; `governExtraction` — Forge's code —
  removes anything not verbatim in the notes, never proposes discussion, requests or
  intentions, and matches owners only to people Forge knows. Survivors become
  candidates; a person confirms, edits or dismisses (ADR-0009).

Every statement Forge shows carries one of six classes: FACT, INFERENCE, ASSUMPTION,
PREDICTION, RECOMMENDATION, DECISION.

## 11. Memory (§18, §19)

When a commitment ends, `assembleEpisode()` keeps it in the shape the source of truth
names — situation, decision, assumptions, commitment, dependencies, execution,
evidence, outcome, variance, explanation, learning — every line classed and resting on
record ids, with a stable reference (`forge:commitment:<id>`) and a fingerprint.

For a decision's commitment, the principal **publishes** the verified outcome
(ADR-0011) and submits it to **Helm's governed intake** as contextual facts (ADR-0018): each actual with what it rests on (a system's record of that very Helm node
and period, or only a person's word), fingerprinted, as `outcome.published`. A Helm
person records it through Helm's own `recordOutcomeReview`; Helm computes the variance
and its genome binds the review to an episode. Helm's genome references the Forge
episode by a typed, pinned `EXECUTION_EPISODE` reference once a Helm manager has adopted the outcome. Delivery
(ADR-0023): `deliverOutcomes` derives what Helm has not received — from Helm's receipts, by reference — and sends it
once, as the person, to Helm's own intake host; nothing about delivery is stored in Forge.

**Sensitivity** (ADR-0017): every fact keeps the class its source gave it, and everything derived from it carries the
union; protected values are sealed and read only under Helm's own clearance; an uncleared reader sees that a value
exists and what status it supports, never the value. Words people write — reasons, explanations, lessons — take the
**ceiling** of their commitment, the union of every class it rests on when they are written, and are sealed with it
(ADR-0020) — as far as their writer could read it, since someone never shown a value cannot have quoted it (ADR-0024);
nobody classifies a sentence, and nothing a cleared writer wrote is lowered.

**Precedents** (ADR-0025): when something begins — a draft at intake, a commitment being accepted — Forge brings back
the concluded commitments that resemble it, every tie stated, with how they ended and what people said explains it, and
the lessons whose stated scope names it. The match is INFERENCE; nothing is ranked.

**Execution records** (ADR-0014) show, per owner or principal, what the ledger
observed — endings, timing against the first promised date, date changes, recurring
dependencies, what people said explains the differences, what recurred — with the
sample size, ordered by name, and never a score, rank or rating.

## 12. Persistence

The store is a port with two implementations held to one conformance suite
(`kernel/test/conformance.mjs`): the in-memory reference, and `postgres.ts` over a
narrow `TableClient` that runs on supabase-js (`createSupabaseTableClient`) or raw SQL.
Six migrations: `forge_foundation` (commitments, events, observations),
`forge_candidates_and_publication` (candidates, dispositions, publication),
`forge_helm_decision_visibility` (ADR-0015), `forge_sensitivity` (ADR-0017),
`forge_text_ceiling` (ADR-0020) and `forge_trusted_standing` (ADR-0021). **None has been applied to the shared Supabase
project.**

Reading at scale (ADR-0022): the supabase-js client reads page by page until a page comes back empty, so PostgREST's
row cap never truncates a ledger; id filters go in slices; `createLedgerCache` keeps a reader's ledger warm and asks
only for what was recorded since, re-reading an overlap window as ids; the runtime remembers derived views per reader
and commitment. None of it is stored state. The progression is Local → Staging (an isolated branch) → Helm
authority integration → production (ADR-0013).

## 13. Verification

`npm run check` = typecheck · lint · tests · integration loops · contracts.

| | |
| --- | --- |
| Kernel | runtime, candidates, trusted authority, publication and records tests |
| Store | one conformance suite run in memory and **on Postgres (PGlite) with the real migrations under RLS**, for commitments and candidates, plus database refusals each matched by a legal control |
| Fabric | intake, matchers, ingestion, outbound, Memoire, and extraction governance |
| Server | the Claude extractor's request and every failure mode, with an injected client; `/api/extract`; an opt-in live test (`FORGE_LIVE_LLM=1`) |
| Story | the Meridian story moment by moment, now with a Memoire obligation, meeting-note candidates and a published outcome |
| **Integration** | four loops against Helm's and Memoire's own code and migrations (ADR-0016) — loop 4 runs Helm's trusted authority service; skipped, and saying so, without the sibling repositories |
| `verify:boundaries` | Forge writes only `forge_*`; layers point one way; the kernel is pure; the model SDK lives under `server/` only and never reaches the browser; records hold no scores; no percent-complete |
| `verify:schema` | `forge_*` only; no stored state column (created or added); RLS, append-only, database record time, anon revoked, no client update/delete; Helm's decision visibility cannot be dropped by a later policy; free text carries a class or is a named residual; the ceiling and standing triggers stay the last word; definer functions pin `search_path` |
| `bench:reads` | not a contract: SYNTHETIC reads at organization scale, in memory and on PGlite, with and without the ledger cache |
| `verify:loop` | the §28 chain on the record the story produced, plus the Memoire and memory loops |

Each new rule was broken on purpose and seen to catch it.

## 14. What is not proven

- **The shared database.** All five migrations are proven on PGlite with Helm's real
  migrations — not on the shared project, and not applied there. No staging branch exists.
- **Helm's trusted service as deployed.** Standing is proven with Helm's real service code over its real Postgres store
  in one database (loop 4) — not through Helm's edge function and Supabase Auth, and no organization is TRUSTED anywhere.
- **Free text beyond events.** Reasons and learnings take their commitment's ceiling and are sealed (ADR-0020); a
  candidate's dismissal reason is still open, because the notes it answers carry no class yet.
- **Deployed transport.** Forge delivers through Helm's intake host code and hosts its Memoire receiver (ADR-0023), proven
  in the integration suite; neither edge function is deployed, and the Memoire receiver has no deployed wrapper.
- **Live services.** Supabase Auth, PostgREST, Memoire's deployed API and webhook
  delivery over the network, and the Claude API itself (opt-in test only).
- **Execution surfaces.** Jira, ERP, WMS, SCM remain fixtures; no connector service runs.
- **Scale, first reading.** A warm reader catches up in milliseconds (ADR-0022); the first reading by each reader still
  reads the whole organization.

## 15. Product decisions taken, and open questions

Taken (see ADR-0009 to ADR-0016): records without scores; staging before production,
production after Helm's trusted authority; Memoire promises linked, not copied, and
promoted only by a person; extraction of candidates from notes as the first model job,
never creating a commitment silently.

Open, for the product owner:

Decided since: sensitivity before staging (ADR-0017); Helm's governed intake and typed execution episodes
(ADR-0018; Helm ADR-0034, ADR-0035); a staging branch after the sensitivity fix; one controlled live extraction test.
