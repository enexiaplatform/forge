# ADR-0025 — Precedents: what was learned comes back when something like it begins

**Context.** Forge kept explanations and lessons when a commitment ended (§18), published them to Helm, and then never
showed them again. The source of truth asks for more: "finding relevant historical precedents" (§20), and a loop that
ends in "LEARNING → BETTER FUTURE DECISIONS" (§30). On the Meridian story, Helm's second decision asks Supply Chain to
move eight units back to Distributor D on consignment — weeks after a transfer of the same kind ended late for want of
QC re-release time, and a lesson saying so was recorded. Forge drafted the second decision without a word about it.

**Decision.** `precedentsFor` (kernel, pure) reads, for a commitment or a draft not yet proposed, the concluded
commitments that resemble it, and the lessons that may apply.

- **Ties are concrete and stated.** A precedent shares a promise that reads alike (three or more distinctive words in
  common, named), the same record (a Helm value node, a requirement's object, a dependency, an execution link), or a
  shared entity (an account, an opportunity, a promise) together with a second tie. A shared customer alone is not a
  resemblance — everything done for a key account shares it — and neither is a shared owner: that is the owner's
  execution record (ADR-0014).
- **Precedents come from elsewhere.** A decision's own tree is not its precedent.
- **Lessons travel with their tree.** A lesson recorded higher in a precedent's tree comes with it; a lesson whose stated
  scope ("applies to …") names what this promise is about may apply even without a precedent, and says which words.
- **Inference, and labelled so.** Every match is INFERENCE under `forge-precedent-rules@1`, with its reason; the lessons
  are what people wrote, attributed, withheld where the reader is not cleared.
- **No ranking.** Precedents come most recent first; nothing is ordered by likeness or by how it ended. The headline is a
  computed sentence of facts, and a handful of cases says it is a handful. `verify:boundaries` holds precedents to the
  same no-score rule as execution records.
- **Shown where it changes something.** On a commitment's page ("Been here before"), on every draft at intake, and in
  the accept dialog — read before someone takes something on, not after.

**Consequences.** Drafting the buffer decision now shows, on the return transfer, the Rohto transfer it resembles, how
it ended against the date first promised, and the QC lesson; the consignment-terms draft shows the lesson alone, because
its stated scope names consignment. Replenishment from a supplier shares too little with anything to be called a
precedent, and Forge says nothing about it.

**Not done.** Forge does not ask anyone to acknowledge a lesson — that would be asking for a status. Whether a lesson was
heeded shows in how the new commitment ends, which is where Forge already looks.
