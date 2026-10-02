# ADR-0014 — Execution records are observed facts, not scores

**Context.** The product owner wants historical execution records for organizational
units, and no performance scores, rankings, league tables or synthetic ratings. A track
record is evidence, not a judgment.

**Decision.** `executionRecords(views, 'owner' | 'principal')` (`kernel/records.ts`)
returns, per party, only what the ledger observed: commitments observed, open and
concluded; how they ended (fulfilled, partly, missed, superseded, …); timing against the
date first promised, as each commitment's days plus on-or-before/after counts, median
and range; date changes; dependencies that recurred and how often they were late; what
people said explains the differences (explanations and the reasons given for moved
dates, attributed); what recurred (lessons, and commitments kept on time with a
system's record behind them); the contexts; and the sample, with a caveat below five
concluded commitments. Parties are ordered by name. The Memory page shows them under a
standing note that Forge does not score, rank or rate.

**Consequences.** `verify:boundaries` refuses any score, rank, rating, league-table or
percentile identifier in the records code and any ordering of parties by an outcome.
There is no single number to compare people by — by design. Records reflect the
commitments Forge observed, not everything a unit did.
