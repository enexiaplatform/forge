# ADR-0029 — What work waited on

**Context.** §15 asks "which dependencies create repeated delays?". Forge recorded every dependency — on an outside
party or record, on a person, on another commitment — and asked the owner when one was late, but its answer to the
question existed only inside each owner's execution record (dependencies that recurred for that owner). Nobody could see
that the same distributor, or the same team's commitments, kept arriving after work needed them.

**Decision.** `dependencyRecords` (kernel, beside the other records) lists each thing commitments waited on — named by
what it is: an outside party or record with its system, a person, or another owner's commitments — with:

- how many commitments waited on it, how many times it came after the date it was needed, and how many still wait;
- every case: who waited, for what, needed by when, came when, how many days after it was needed, and how many times
  the waiting commitment's own date moved after — the knock-on, as a fact;
- a dependency on another commitment settles when that commitment is delivered, as it does in the conditions.

Counts and cases, never a rate; ordered by name; a handful of cases says it is a handful. Shown on the memory page as
"What work waited on".

**Consequences.** The Rohto story reads: Distributor D's release was waited on once and came two days after it was
needed, and the transfer's date moved after it; the delivery waited on Supply Chain's transfer, which came in time.

**Not done.** Forge does not say a dependency *caused* a delay: a moved date after a late dependency is shown as two
facts side by side. What explains it is what people say (ADR-0014).
