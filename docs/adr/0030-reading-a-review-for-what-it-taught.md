# ADR-0030 — Reading a review for what it taught

**Context.** When a commitment ends differently from what was promised, Forge asks its principal what explains the
difference and what the enterprise should remember (LEARNING_OPEN). The answer usually already exists: the people who
were there said it in a review meeting, and someone typed the notes. Asking them to type it again is the redundant
entry §9 forbids, and §20 names "helping explain outcomes" as a job for AI — without letting an inference become what
the enterprise believes.

**Decision.** In the dialog where a person records a learning, Forge can read the review notes they paste and propose
which sentences explain the outcome and which state a lesson.

- **The same discipline as reading commitments** (ADR-0012). A model — Claude on the server
  (`createClaudeLearningExtractor`, Opus 5.5, structured outputs, Anthropic's default fallback) or the offline reference
  reader — returns raw findings only; Forge's `governLearnings` removes any quote not in the notes, leaves anything that
  neither explains nor teaches as not taken and says so, and keeps "where it applies next time" only in words the notes
  use. The console asks the server first and falls back to the reference reader.
- **Nothing is recorded by reading.** Proposals live only in the dialog, labelled INFERENCE, each with where it was found.
  The person picks one into the form, may edit it, and records it — as theirs, with the authority any learning needs.
- **The learning remembers where it came from.** `Learning.drawnFrom` keeps the notes' reference and label, the quoted
  words and the line; the commitment's page shows it. The quote is words too: it is sealed with the learning at what its
  writer could read (ADR-0020, ADR-0024), while which notes it came from stays visible.

**Consequences.** On the Meridian story, the DEMO outcome review yields the two explanations (re-labelling outside the
transfer cost; QC re-release on returned consignment stock) and the two lessons, each with its line; a lesson recorded
from it carries "drawn from Rohto outcome review, line 8". A refusal or a truncated answer from the model is a failure
said plainly, never an empty reading.

**Not done.** Notes are pasted, not fetched: Forge has no connector to a notes system. And the live model has not been
run on a review (no API key — development plan 0.3).
