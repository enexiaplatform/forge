/**
 * Epistemic classes (§20).
 *
 * Everything Forge says is one of six kinds of statement, and the kind is never
 * dropped on the way to the screen. A system record or a person's confirmation
 * is a FACT; what Forge or an AI concludes from facts is an INFERENCE; what the
 * plan rests on without proof is an ASSUMPTION; a claim about the future is a
 * PREDICTION; a suggestion is a RECOMMENDATION; and a person's choice is a
 * DECISION. An inference never becomes a fact by being repeated — a person
 * confirms it, and the confirmation is the fact.
 */

export const epistemicClasses = ['FACT', 'INFERENCE', 'ASSUMPTION', 'PREDICTION', 'RECOMMENDATION', 'DECISION'] as const;
export type Epistemic = (typeof epistemicClasses)[number];

/** A sentence with its class and what it rests on (event, evidence or record ids). */
export type Statement = {
  readonly class: Epistemic;
  readonly text: string;
  readonly basis: readonly string[];
};

export const fact = (text: string, basis: readonly string[] = []): Statement => ({ class: 'FACT', text, basis });
export const inference = (text: string, basis: readonly string[] = []): Statement => ({ class: 'INFERENCE', text, basis });
export const decision = (text: string, basis: readonly string[] = []): Statement => ({ class: 'DECISION', text, basis });
export const assumption = (text: string, basis: readonly string[] = []): Statement => ({ class: 'ASSUMPTION', text, basis });
