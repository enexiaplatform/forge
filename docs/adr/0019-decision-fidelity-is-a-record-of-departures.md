# ADR-0019 — Decision fidelity is a record of departures, derived, never scored

**Context.** The source of truth asks "Where do decisions lose fidelity during execution?"
(§15) and wants execution to keep its decision context (§14). Forge could show what
happened to each commitment, but not where execution had parted from what management
decided. The link from a commitment back to the Helm action intent it came from existed
only as a copied title.

**Decision.** `decisionFidelity` (`fabric/fidelity.ts`) compares a Helm committed decision
with the Forge commitments that answer to it and lists every departure, stated as the
record holds it: an intent nobody took up, an expected outcome Forge cannot compare or no
system can prove, a commitment nobody has accepted, a declined one, a moved date (against
the date Helm's intent carried), a changed scope, a target moved away from Helm's committed
value, a new owner, a commitment execution added, a material change of context, an ending
short of fulfilled, and a later Helm commitment of the same decision. Each names when, who
asked, the reason, and the authority it rested on — the approver and their reason when it
needed one, and whether that authority was Helm's or Forge's interim policy. What still
stands as decided is listed too. Intake now records the intent on each commitment it drafts
(`decision.action_intent`, by reference); older commitments fall back to the copied title.

Nothing is stored: departures are derived from the same events, at the same lens. The trace
page opens the section with a computed sentence; the decisions page carries it per decision.

**Consequences.** A departure is not a fault — an approved redate or an added commitment may
be exactly right — so the UI marks only what asks for someone now (not owned, not taken up,
recommitted) and sets the rest in ink. There is no fidelity score, rate or ranking:
`verify:boundaries` holds `fidelity.ts` and its component to the records rule (ADR-0014).
Departures do not yet travel to Helm; carrying them in the execution episode, so the genome
can learn where its decisions lose fidelity, is the natural next step and needs Helm's say.
