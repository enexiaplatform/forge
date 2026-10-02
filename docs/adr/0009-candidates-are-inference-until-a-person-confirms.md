# ADR-0009 — Candidates are inference until a person confirms

**Context.** Forge should reduce administrative capture: promises are made in meetings
and in Memoire long before anyone types them into a system. But a commitment is
accountability, and nothing may become one silently — not because a model read it,
and not because a promise exists somewhere else.

**Decision.** Anything Forge reads that might be a commitment becomes a **candidate**
(`kernel/candidates.ts`, `forge_candidates`), never a commitment. A candidate is
always `INFERENCE`, carries the exact words it rests on (quote, locator, source), what
was proposed and what was not said (owner text that matched nobody, date words that
gave no date), the extractor that read it and its confidence. Only the classes
COMMITMENT and DECISION are offered; discussion, requests and intentions are kept as
findings with the reason they were not proposed. A dedupe key per source sentence or
promise means re-reading changes nothing.

Only a **person** disposes of a candidate, once (`forge_candidate_dispositions`,
one row per candidate): **Confirm** proposes a linked commitment (origin
`COMMUNICATION` for what was said, `OBLIGATION` for a Memoire promise) whose terms the
source supplied are captured `EXTRACTED` or `INHERITED` and whose terms the person
supplied are captured `MANUAL` and listed on the disposition; **Edit** is the same act
with every term open; **Dismiss** keeps the reason. The owner still accepts the
commitment before it is theirs.

**Consequences.** The ledger never holds a commitment nobody stood behind. The cost is a
step: someone must confirm, and an unconfirmed candidate is visible on Asks until they
do. Agents and connectors may suggest; the runtime and the database both refuse them
confirming or dismissing.
