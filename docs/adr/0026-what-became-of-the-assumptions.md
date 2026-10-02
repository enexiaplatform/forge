# ADR-0026 — What became of the assumptions a decision rested on

**Context.** Every Helm decision states what it rests on without proof — "Distributor D will release its eight units",
"the provincial tender remains material". Forge inherited them as context (epistemic ASSUMPTION) and showed them in
the episode, and that was all. Nobody could say whether one held, nothing happened when one broke, and §15's question —
"which assumptions repeatedly prove wrong?" — had no answer anywhere in the ecosystem.

**Decision.** What became of an assumption is a person's judgment, recorded as an event: `ASSUMPTION_ASSESSED` — it
**held** or it **broke**, with the reason that shows it and, optionally, the evidence it points to.

- **Who says.** The owner, the principal, a manager — and whoever stands behind the assumption, as Helm names them
  (`ContextField.standsBehind`), even when they are no party to the commitment. Never an agent or a connector: an
  inference about an assumption is not its assessment. The database requires a person, a reason, a known key.
- **A broken assumption while the promise is open changes the world it rests on.** Forge records a material context
  change with it, so the principal is asked — the same ask any changed context gets — whether the promise still stands,
  should change, or should end. Saying it broke twice does not change the world twice; breaking after the end changes
  nothing the commitment still rests on.
- **Asked once, by exception.** When the root of a decision's tree ends with assumptions nobody examined, its principal
  is asked, noted and never urgent, what became of them. Not asked of each commitment beneath it, and never asked while
  work is going on.
- **Remembered.** The episode states each assumption and what was said of it — or that nobody said. The publication to
  Helm carries them, sealed with the outcome where it is protected.
- **Across decisions, a record.** `assumptionRecords` lists each assumption by its words, once per decision, with how
  many times it was said to hold or break, how many times nobody examined it, and every case with its reason. Counts and
  cases, never a rate; ordered by the words; a handful of cases says it is a handful. Shown on the memory page as
  "Assumptions, as they turned out".
- **Words are words.** A reason is sealed at what its writer could read (ADR-0020, ADR-0024): the Commercial Director's
  account of the distributor stays readable; the Country GM's, written by someone cleared for margin, is sealed.

**Consequences.** On the Meridian story the Commercial Director, who stands behind two of the Rohto assumptions, says
they held and why; the Country GM answers for the one nobody stood behind. Intake now keeps an assumption's words as its
value and who stands behind it in its label and `standsBehind`, so the same assumption reads the same across decisions.

**Not yet.** Helm's intake does not read assessments as their own contextual facts; they reach Helm inside the
published outcome. Whether Helm's genome should learn from them directly is Helm's decision.
