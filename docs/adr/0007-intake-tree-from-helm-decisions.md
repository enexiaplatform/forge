# ADR-0007 — The intake tree

**Context.** §9 and §11: capture once; context flows; ask people only for what does not
yet exist. A Helm commitment already holds the summary, rationale, expected outcomes,
review triggers and action intents with owners and dates.

**Decision.** One committed Helm decision becomes an outcome commitment owned by the
decision owner — measured by the outcomes Helm expected, proven by the actuals Helm
later observes — and one child per action intent. Each term is marked INHERITED,
INFERRED or MISSING; only MISSING terms are inputs. Intake happens once per decision.

**Consequences.** The canonical decision needs nothing typed. Owners confirm inferences
by accepting. The tree carries the decision's lineage to whoever executes (§14).
