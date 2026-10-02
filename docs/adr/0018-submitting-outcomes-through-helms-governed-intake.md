# ADR-0018 — Verified outcomes reach Helm through Helm's governed intake, as contextual facts

**Context.** ADR-0011 published a verified outcome and showed that a Helm person could
retype it into Helm's outcome review. The product owner asked for a Helm-owned contract
instead: Forge owns execution truth, Helm owns management truth, and Forge never writes
Helm's persistence. Integration also showed that a naked value ("margin = 31.2%") cannot
be governed.

**Decision.** `toHelmExecutionOutcome` (`fabric/helmMemory.ts`) turns a publication into
Helm's `helm.execution-outcome.v1` submission: the publication and episode references
with their fingerprints, the Helm commitment and the fingerprint Forge executed against,
the ending, the narrative with its classes, the authority context the publication
rested on (trusted or not), and one **contextual fact** per measured outcome
(`helm.contextual-fact.v1`, Helm ADR-0034): value · entity (the Helm value node) ·
metric · period · source · provenance (a system's record, a person's statement, or
nothing) · epistemic class · sensitivity · scope · authority. Units are given in Helm's
own vocabulary.

Helm's intake validates it — the commitment by fingerprint, every fact against what the
commitment expected, and that no class is lowered — and keeps a receipt. A Helm manager
adopts it: Helm's decision runtime records the review and computes the variance; Helm's
fabric records the adoption. Helm's genome then references the Forge execution episode
by a typed `EXECUTION_EPISODE` reference pinned to its fingerprint
(`toHelmExecutionEpisodeRef`, Helm ADR-0035).

**Consequences.** Proven against Helm's own code in memory (loop 3) and on Postgres with
Helm's adapters, guards and policies (loop 1): a lowered class or another commitment
version is refused by Helm's runtime and by its database even when the intake is
bypassed; receipts and reviews are read only by cleared readers. Loop 1 also binds the
episode in Helm's genome on Postgres: Helm's own database guard refuses a generic document, a
wrong pin and an episode it never received, and an episode about the margin is hidden whole
from a reader Helm has not cleared. `toHelmOutcomeReview`
and `toHelmGenomeRef` are retired: the first wrote around Helm's governance, the second
was the generic reference Helm now refuses. There is no transport yet between the
products — in production a Forge server submits as the principal's session; today the
integration suite composes both sides.
