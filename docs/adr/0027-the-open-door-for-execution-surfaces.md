# ADR-0027 — The open door for execution surfaces: forge.observation.v1

**Context.** "Forge should not become another closed system" (§8); "external systems are first-class citizens" (§24).
Forge's ingestion already treated every surface alike — activity, evidence, dependency, context — but the only surfaces
that could reach it were Helm and Memoire, through their own contracts, and the demo's fixtures. A team running Jira or
an ERP had no way in except waiting for Forge to write their connector, and Forge writing a reader for every vendor is
the "fixture-shaped reader" the product owner ruled out (decision 8 of 2026-10-01). And although `forge_observations`
existed in the schema, nothing wrote it: unmatched observations lived only in memory.

**Decision.** One open, signed contract any surface can implement, and a durable ledger behind it.

- **forge.observation.v1.** An envelope naming the system and up to 500 observations (id, event type, the record it is
  about, when, the source's own words, a flat payload, optional entity, url and sensitivity classes). Signed like
  Memoire's webhooks v1 — HMAC-SHA256 over `<timestamp>.<body>`, five minutes — with the shared check (`verifyHmacV1`).
  Contract for adapter authors: [docs/contracts/forge-observation-v1.md](../contracts/forge-observation-v1.md).
- **A surface speaks only for itself.** The secret is found by the system the request names; the envelope's system must
  be that one; Helm, Memoire and Forge are reserved. Nothing in the request can make it a different actor.
- **Accepted whole or not at all, and once.** Every problem in a batch is listed back to the sender. The ledger
  (`ObservationLedger`; `forge_observations` in Postgres, written only by the service role) keeps each organization,
  system and id once. The whole batch is ingested on every delivery — ingestion is idempotent per observation and
  effect — so a retry after a 503 finishes what an interrupted delivery began instead of skipping it as already held.
- **The same four questions.** What arrives through the door is treated exactly as Helm's and Memoire's observations
  are: activity is never evidence; only what a commitment named proves it; classes are carried and never lowered.
- **A host, not a server.** `handleObservationDelivery` (server) is one request and one status, for whatever hosts it;
  `scripts/send-observation.mjs` is a reference sender for adapters.

**Consequences.** An ERP shipment Forge has no connector for proves the commitment that named it, once; a wrong secret,
a stale timestamp, another system's records and a malformed batch are refused with what to do next; a fact's class
travels into the evidence and is withheld from an uncleared reader; on PGlite under RLS, no client can write the
ledger and a protected observation is read whole or not at all.

**Not done.** Registering a surface — issuing its secret, naming the system — is a deployment step (the host's
environment), not a screen; there is no deployed endpoint yet. Which event types a generic surface may raise as a
change of context is not open to it: only Forge's own list decides that, so a surface cannot ask principals questions
by naming an event type.
