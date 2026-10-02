# ADR-0024 — Words carry only what their writer could read

**Amends** [ADR-0020](0020-words-keep-the-ceiling-of-their-commitment.md)

**Context.** ADR-0020 sealed every word written on a protected commitment at the commitment's ceiling, because no one
can tell from a sentence whether it quotes a protected value. Building precedents (ADR-0025) showed what that costs: the
Supply Chain Director, not cleared for margin, recorded the lesson of the Rohto reallocation — plan QC re-release time —
on the outcome commitment, which is measured by margin. The lesson was sealed from everyone in operations, its own author
included. The people who most needed it could never read it.

**Decision.** A writer's words take the commitment's ceiling **as far as the writer could read it**: the classes of the
ceiling the writer is cleared for, by Helm's own clearance rule.

- Someone Forge never showed a protected value — and Helm never cleared to see it anywhere, since the clearance is
  Helm's — cannot have quoted it. Their words are not derived from it, so carrying its class would protect nothing and
  hide the words from the people they were written for.
- A cleared writer writes at the full ceiling, exactly as before. Nothing a cleared person wrote is ever lowered; a writer
  may still raise their words above it.
- Enforced the same way everywhere: the runtime stamps it (`readableBy`), the in-memory store checks it against the
  writer's clearances, and the database checks it with `forge_private.readable_ceiling`, which calls Helm's clearance as
  the writer. A session that does not state its reader's clearances writes at the full ceiling — unknown is not
  uncleared — so a browser session loads its clearances from Helm before anyone writes. The act dialog tells a cleared writer that their words will be sealed, and says nothing to one whose words
  will not be.

**Consequences.** On the Meridian story, the lesson is readable by the operations people it was written for; the Country
GM's explanation of the variance, written by someone cleared for margin, stays sealed. The staging suite's "words at
their ceiling" contract now also proves that an uncleared writer's words are stored open.

**What this does not cover.** A person who knows a value from outside the ecosystem — a printout, a conversation — can
still write it down. No rule over records can see that; it is the writer's responsibility, as it was before ADR-0020.
