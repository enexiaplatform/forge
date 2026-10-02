# ADR-0017 — A fact keeps its sensitivity wherever it goes

**Context.** Helm classifies values (Helm ADR-0025): gross margin and cash are
FINANCIAL_SENSITIVE wherever they appear, and only people Helm has cleared may read
them. Loop 1 showed that once Helm's margin actual became Forge evidence, any reader of
the commitment could read it (ADR-0015's named gap). The product owner made this a
shared ecosystem invariant, to be fixed before staging:

> A derived fact must never become less protected merely because it crossed an
> application boundary.

**Decision.** Forge adopts Helm's model rather than inventing one. A fact carries the
class its source gave it; anything derived from it carries the union of its sources'
classes; classes are compartments, not levels; general management needs no clearance.

- **Carried, end to end.** Helm's value surface reads each value's class (node, else
  metric; an unreadable class is treated as restricted in every compartment). The
  observation, the evidence built from it (`EvidenceItem.protection`), the measure an
  expected outcome becomes (`OutcomeMeasure.protection`), the outcome that states an
  actual (stamped from its measures and the evidence it rests on), the variance, the
  episode and the publication each carry the union. The publication goes to Helm as
  contextual facts with their classes (ADR-0018), and Helm refuses any that arrive
  lowered.
- **Redaction, not omission.** A protected event is split by the kernel
  (`sensitivity.ts`): the open part — protected values removed and marked withheld, the
  narrative stated with them replaced by a sentence saying so — and the sealed values.
  Every reader sees the same events and derives the same status (a requirement is
  EVIDENCED for everyone); only cleared readers get the values back. A withheld value
  is said, never shown as missing.
- **Enforced by Helm's own rule.** In Postgres the sealed values live in
  `forge_sealed_values`, moved off the event row by a trigger in the same statement,
  and read only where Helm's `helm_private.has_clearance` holds for every class (called,
  not copied). A protected observation in the ingestion ledger is read whole or not at
  all. The in-memory store withholds by the reader's `clearances`.
- **Only someone who can read it all can publish it.** Verification refuses a reader
  who received withheld content.

**Consequences.** Proven in the kernel (both stores, one conformance case), in the
demo, and on Postgres with Helm's real clearance table: an uncleared member sees that
Helm proved the margin and how the commitment ended, never the value; a Helm clearance
grant opens it in Forge too. `verify:schema` refuses a later migration that drops the
clearance check or the sealing trigger. **Residual, named:** text people write
themselves — a close reason, a learning — is not classified; Forge cannot tell whether
it quotes a protected value. The outcome narrative is sealed with its actuals; other
free text is its author's responsibility until people can declare a class.
