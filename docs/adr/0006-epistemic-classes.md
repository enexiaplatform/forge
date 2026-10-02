# ADR-0006 — Epistemic classes on everything shown

**Context.** §20: AI inference is not enterprise truth by default; the system should
distinguish FACT, INFERENCE, ASSUMPTION, PREDICTION, RECOMMENDATION and DECISION.

**Decision.** Every statement Forge renders carries one class. Evidence is a FACT — a
system's record or a person's confirmation — or an INFERENCE, with a confidence, filed
only by an agent through the inference channel. An inference never satisfies a
requirement; a person's confirmation is the fact that does. The database refuses an
inference filed as a fact, and a fact with a confidence.

**Consequences.** The console shows AI output beside facts without dressing it as one.
Accepting a commitment is how its owner confirms what Forge inferred.
