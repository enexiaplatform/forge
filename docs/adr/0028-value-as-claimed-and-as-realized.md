# ADR-0028 — Value, as claimed and as realized

**Context.** §17 asks Forge to connect execution to enterprise value without fake precision: "why is this commitment
important?" and "what value was actually produced?". §15 adds "which decisions consumed resources but created little
enterprise value?". Forge held both halves — value claims in the terms (inherited from Helm or stated), realized value
in the outcome — and paired them on each commitment's page, but nowhere set decisions side by side, and nothing said
when a decision ended without anyone saying what value it produced.

**Decision.** `valueRecords` (kernel) reads each decision at the root of its tree and states, side by side:

- **What it was meant to do** — each claim, with what the person who recorded the outcome said became of it (created,
  protected, delayed, destroyed, none, unknown), attributed; and value people said it produced that nobody had claimed.
- **What the measures landed at** — expected, actual, difference, and whether a source system's record of the very
  object the expectation named stands behind the actual, or only a person's word.
- **What it took**, in the only currency Forge observes honestly: commitments in the tree, owners, days from the first
  proposal to the last ending, dates moved, changes asked for, parts still open. Forge does not know what anything cost
  and states no amount nobody stated.
- **Withheld is not unsaid.** Where what people said is sealed from the reader (ADR-0017), the record says so and does
  not count it as unstated.

No ratio of value to effort, no rate, no ranking: decisions come in the order they ended, open ones last, and
`verify:boundaries` holds `value.ts` to the same no-score rule as execution records. When a decision's root ends with an
outcome recorded and a claimed dimension nobody spoke to, its principal is asked once, noted: what value did it actually
create, protect, delay or destroy? Shown on the memory page as "Value, as claimed and as realized".

**Consequences.** The Rohto decision reads: meant to protect margin, customer and cash; the Country GM said each was
protected, with the margin 0.97 points under the committed future — Helm's record behind the actual — and it took five
commitments, two moved dates and eight weeks. A reader not cleared for margin sees that something was said and is
withheld from them.

**Not done.** Effort in money, hours or headcount is not Forge's to know. If an ERP or HRIS reports it through
`forge.observation.v1`, it arrives as observations like any other fact — never as a figure Forge computes.
