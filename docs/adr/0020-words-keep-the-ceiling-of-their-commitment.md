# ADR-0020 — Words keep the ceiling of the commitment they are written on

**Amends** [ADR-0017](0017-sensitivity-never-lowers.md), which named this residual.

**Context.** ADR-0017 carries a fact's class from its source into everything derived from it. Words people write — a
close reason, a redate's reason, an explanation, a lesson — had no source class: Forge could not tell whether "margin
landed at 31.4, so we stopped" quotes a protected value, and stored it open. The reason travelled into episodes,
execution records, decision fidelity and the publication Helm receives. A classifier cannot close this: a model's
judgement about a sentence is an inference, and an inference never lowers a class.

**Decision.** Words take the **ceiling** of the commitment they are written on: the union of every class it rests on
when they are written — its measures (Helm's value classes), a rescope's measures, its evidence, its outcome, and the
words written before them.

- **Stamped, not classified.** The runtime stamps `textProtection` on every event that carries words (a reason, or a
  learning). The writer may raise it (`ActOptions.textProtection`); nothing lowers it. Lowering is a clearance act in
  Helm, not a field in Forge.
- **Sealed like values.** Words above general management are sealed with the event (`sealEvent`): the open event says
  that words were written and withholds them (`textWithheld`, never a silent absence); the words live in
  `forge_sealed_values` under Helm's own clearance check.
- **Enforced in both stores.** The in-memory store and Postgres refuse words stored below the ceiling
  (`event.text_below_ceiling`; trigger `forge_events_ceiling`, which computes the ceiling as the database's owner, not
  as the reader). `text_protection` is always contained in the event's protection.
- **Carried onward.** An episode quoting the words carries their class; a publication seals its explanations and
  lessons with its outcome; Helm receives the narrative at the publication's classes; a reader who received withheld
  words cannot publish.
- **Said before it is written.** The act dialog tells the writer, before they type, that what they write will be
  sealed and at which classes.

**Consequences.** On a commitment measured by gross margin, an uncleared reader sees that the owner gave a reason and
which act it explains — never the words. This is deliberately conservative: words that quote nothing protected are
sealed too, because nobody can prove they do not. Words written before the commitment came to rest on a protected
value keep what they had; the ceiling rises, history is not rewritten.

`verify:schema` refuses a free-text column that no protection column covers, unless it is named as a residual with its
reason, and refuses a migration that drops the ceiling trigger. The staging suite gains a tenth contract, "words at
their ceiling", and fails by name when the trigger is removed.

**Residual, named.** A candidate's dismissal reason (`forge_candidate_dispositions.reason`) answers notes that carry no
class yet; it stays open until meeting notes do.
