# ADR-0003 — Append-only events; state derived at a lens

**Context.** §13 asks Forge to preserve *why* a commitment's state changed, not only the
state. §18 asks for durable memory. Helm stores no status, score or verdict column and
reconstructs any reading at a lens.

**Decision.** A commitment is an identity record written once plus append-only events,
each with actor, effective time, database record time, reason and authority verdict.
Phase, current terms, requirement status, conditions, variance and episodes are derived
at a lens `(asOf, recordedThrough)`. The schema forbids state columns (`verify:schema`);
a guard refuses UPDATE and DELETE for everyone, the service role and the owner included.

**Consequences.** Any past reading reproduces exactly. Corrections are new events (a
dispute, a reopening), never edits. Reads re-derive from events — cheap at demo scale,
and in need of projections with an invalidation story at enterprise scale.
