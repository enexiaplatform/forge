# Forge, Helm and Memoire — the boundaries

> Memoire records what happened commercially. Helm decides what to do about it.
> Forge makes sure what was decided is owned, done, proven and remembered.

## Ownership

| Capability | Owner | Forge may |
| --- | --- | --- |
| Accounts, opportunities, commercial activity, commercial promises to customers | **Memoire** | read as the promise's owner through Commercial API v1; keep a reference and the fields seen, as context; observe changes as evidence; propose an enterprise obligation as a candidate a person confirms |
| Enterprise ontology, value graph, scenarios | **Helm** | read expected values from a committed future; observe value actuals as outcome evidence |
| Decisions, alternatives, criteria, assumptions, the decision commitment and its action intents | **Helm** | read by reference, with the commitment fingerprint and a frozen snapshot, under Helm's RLS — and show its execution only to whom Helm shows the decision |
| Decision authority | **Helm** | answer its authority port when Helm's service is deployed |
| Outcome reviews, genome, patterns, lessons review | **Helm** | publish verified outcomes in the shape of Helm's outcome review; a Helm person records them |
| — | — | — |
| Commitments people own, their events, evidence, outcomes, variance, learning | **Forge** | own |
| Execution surfaces' observations, ingested once | **Forge** | own (`forge_observations`) |
| Asks — who must act on what | **Forge** | own, derived |
| Candidates read from notes and Memoire, and their dispositions | **Forge** | own; inference until a person confirms |

## Rules

1. **Forge never writes to Helm or Memoire.** No insert, update, upsert or delete on
   any of their tables, from anywhere (`verify:boundaries`). A migration never alters
   or drops a table that is not `forge_*` (`verify:boundaries`, `verify:schema`).
2. **Forge never copies a Memoire or Helm record.** It stores a reference plus an
   immutable snapshot of what was seen when the commitment was made — the rule Helm
   keeps for Memoire, for the same reason: a commitment is judged against what was
   known when it was made.
3. **Forge does not import Helm or Memoire code.** The products meet through data
   contracts. The Helm read model in `fabric/helm.ts` mirrors Helm's own types.
4. **Forge publishes; Helm reads.** Execution reality goes to Helm as events in the
   envelope Helm's integration fabric already reads from Memoire:
   `{ eventType, occurredAt, sourceSystem, sourceRef, payload, idempotencyKey }`.
5. **One database, one identity, one organization layer.** Forge's tables carry
   `org_id` and their policies call Helm's `is_org_member` and `has_org_role`.
7. **Facts travel with their context, and sensitivity never lowers.** The ecosystem exchanges contextualized facts —
   value, entity, metric definition, period, source, provenance, epistemic class, sensitivity, scope, authority where
   relevant — never naked values (Helm ADR-0034, the Helm Fabric's `helm.contextual-fact.v1`). A fact derived from a
   classified value carries at least that class into everything derived from it, in every product: Forge seals it
   (ADR-0017), Helm's intake refuses it lowered, and Helm's reviews and genome read it only under clearance. The
   same contract applies to Memoire, Sentinel and Flow as they send facts.
6. **Helm decides who sees a decision, in Forge too.** A commitment executing a Helm
   decision — and its whole tree — is visible only where Helm's own
   `can_see_decision` allows (ADR-0015).

## The three contracts

### Helm → Forge: a committed decision

`HelmCommittedDecision` (`fabric/helm.ts`): the decision (question, context, scope,
owner, horizon, trigger references), the commitment (id, fingerprint, committed by
and when, summary, chosen alternative, rationale, accepted trade-offs, expected
outcomes in Helm's own shape — node, metric, period, expected value, unit — and the
metric's direction, review triggers), the action intents, and the assumptions.
`createHelmTableSource` (`fabric/helmSource.ts`) reads Helm's `helm_decisions`,
`helm_decision_commitments`, `helm_decision_alternatives`, `helm_decision_assumptions`,
`helm_actions` and `helm_value_metrics` under the reader's own RLS; every column it
reads (`HELM_READ_CONTRACT`) is one Helm's own adapter reads, checked by the
integration suite. Helm's own `DecisionStore` answers the same port.
`createHelmValueSurface` reads Helm's ACTUAL value observations — under Helm's
clearance rules — as evidence on the very node and period an outcome was committed to.
The demo serves the same shape from a fixture.

### Memoire → Forge: context and evidence

`MemoireOpportunity` (`fabric/memoire.ts`) becomes inherited context with
`memoire:account:<id>` and `memoire:opportunity:<id>` entity references.

Promises come through **Commercial API v1** with Memoire's own SDK, as their owner
(`fabric/memoireCommercial.ts`): each is an observation (`commitment.open`,
`.completed`, `.cancelled`), and the promotion rule proposes the ones the enterprise
owes — named person, date — as candidates (ADR-0010). Memoire's **commercial webhooks
v1** announce changes (`fabric/memoireWebhooks.ts`): verified (HMAC, five minutes)
before parsing, deduplicated by id, then read through the API. A completed promise is
evidence; a cancelled one is a context change that asks the principal.

### Forge → Helm: what happened

`outboundEvents()` (`fabric/outbound.ts`): `commitment.proposed`, `.accepted`,
`.declined`, `.redated`, `.rescoped`, `.reassigned`, `.closed`, `outcome.observed`,
`learning.recorded`, `review_trigger.observed` — fired when a dependency that stands
for one of the decision's own review triggers goes late — and `outcome.published`,
the verified outcome (ADR-0011). `toHelmOutcomeReview` (`fabric/helmMemory.ts`) gives
exactly the input of Helm's `recordOutcomeReview`; Helm computes the variance itself.
Keys are derived, so re-deriving the stream yields the same idempotency keys.

Since ADR-0018 the publication reaches Helm through **Helm's governed intake** (`helm.execution-outcome.v1`, Helm
ADR-0034): `toHelmExecutionOutcome` sends it as contextual facts; Helm validates the commitment fingerprint, every
fact and its class, and keeps a receipt; a Helm manager adopts it into Helm's outcome review; Helm's genome
references the Forge episode by a typed, pinned `EXECUTION_EPISODE` reference (Helm ADR-0035). Forge has no grant
on any Helm table.

## Signs the boundary is eroding

- A Forge screen that edits a Memoire account or opportunity, or a Helm decision.
- A `forge_*` column that duplicates a Helm or Memoire field instead of referencing it.
- Forge computing a commercial forecast or a modelled value instead of reading one.
- Forge recommending, ranking or scoring a decision or a person.
- A task list, a board, or a percent-complete field.
