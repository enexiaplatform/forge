# ADR-0004 — Evidence requirements and matchers

**Context.** §12: prefer observable reality over self-reported status. An observation
from an ERP or a warehouse has to reach the right commitment without a person attaching
it — and must never reach the wrong one.

**Decision.** A commitment names its evidence requirements, each OUTPUT or OUTCOME, with
an optional matcher `{ system, eventType, objectRef, where }`. A matcher that pins an
object reads a disagreeing payload from that object as a contradiction; one that pins
none only filters. A matcher that pins nothing and filters on nothing is never acted on,
and the console asks the owner to name the object. A system's later record of the same
object supersedes its earlier one. Facts that disagree are a conflict a person settles
by disputing one — which stays on the record and stops counting.

**Consequences.** Inferred matchers are safe by construction. Owners name an object (a
transfer order, a sales order) once, when they accept. A requirement met only on a
person's word is shown as exactly that.
