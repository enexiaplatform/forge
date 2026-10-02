# ADR-0011 — A verified outcome is published; Helm records it through its own API

> **Update, 2026-10-01:** Helm now receives publications through its governed intake ([ADR-0018](0018-submitting-outcomes-through-helms-governed-intake.md)); the direct review mapping and the generic genome reference described below are retired, and the genome gap is closed by Helm ADR-0035.

**Context.** Helm learns from what happened after a decision. Forge knows what
happened, and what it rests on. Helm must not receive Forge's opinion dressed as fact,
and Forge must not write into Helm.

**Decision.** When a commitment answering to a Helm decision is closed with a delivery
ending, its outcome recorded and its required outcome evidence in, the principal may
**publish** it. `verifyOutcome` (`forge-outcome-verification@1`, `kernel/publication.ts`)
assembles an `OutcomePublication`: each measure with its actual and what that actual
rests on — `SYSTEM` when a requirement watching that very Helm value node and period
was evidenced by a system's record, `PERSON` when only a person said so, `NONE` when no
actual exists — plus the ending, explanations and lessons, fingerprinted `fop_…`. It is
recorded as an `OUTCOME_PUBLISHED` event (a person's act; the database refuses
otherwise) and offered as `outcome.published` in the outbound envelope. Until then the
condition `OUTCOME_UNPUBLISHED` asks the principal.

On Helm's side, a person takes it in through Helm's own APIs:
`toHelmOutcomeReview` produces exactly the input of Helm's
`DecisionRuntime.recordOutcomeReview`, and Helm computes the variance against its own
frozen expectation; Helm's genome then binds that review to an episode.

**Consequences.** Proven against Helm's real runtime: Helm computes −0.9668 on gross
margin from Forge's verified 31.421, and its pattern logic classifies the episode from
it. **Gap, named:** Helm's genome accepts no reference to a Forge execution episode
(`toHelmGenomeRef` is refused — its OUTCOME_REVIEW role takes only Helm reviews), so the
Forge reference travels in the review's notes. The integration suite asserts the refusal,
so it fails the day Helm adds the role.
