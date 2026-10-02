-- Forge — what became of the assumptions a decision rested on (ADR-0026).
--
-- A commitment drafted from a Helm decision inherits its assumptions as context (epistemic ASSUMPTION). A person who
-- was there may now say what became of one — it held, or it broke — with the reason that shows it. It is an event like
-- every other: append-only, attributed, its words sealed at what their writer could read (ADR-0020, ADR-0024).
-- Additive: one more event type, and the checks that keep it honest.

ALTER TABLE public.forge_commitment_events DROP CONSTRAINT IF EXISTS forge_commitment_events_event_type_check;
ALTER TABLE public.forge_commitment_events ADD CONSTRAINT forge_commitment_events_event_type_check CHECK (event_type IN (
  'ACCEPTED', 'DECLINED', 'CHANGE_REQUESTED', 'CHANGE_DECIDED', 'TERMS_CHANGED',
  'DEPENDENCY_DECLARED', 'DEPENDENCY_SETTLED', 'EXECUTION_LINKED', 'ACTIVITY_OBSERVED',
  'EVIDENCE_RECORDED', 'EVIDENCE_DISPUTED', 'OUTCOME_OBSERVED', 'CONTEXT_CHANGED',
  'CONTEXT_REAFFIRMED', 'CLOSED', 'REOPENED', 'LEARNING_RECORDED', 'OUTCOME_PUBLISHED',
  'ASSUMPTION_ASSESSED'
));

-- A person's judgment, with its reason, about an assumption the commitment actually rests on.
ALTER TABLE public.forge_commitment_events DROP CONSTRAINT IF EXISTS forge_events_assumption_assessed;
ALTER TABLE public.forge_commitment_events ADD CONSTRAINT forge_events_assumption_assessed CHECK (
  event_type <> 'ASSUMPTION_ASSESSED'
  OR (
    payload->>'assessment' IN ('HELD', 'BROKE')
    AND payload->>'key' ~ '^assumption\.[0-9]+$'
    AND jsonb_typeof(payload->'evidenceIds') = 'array'
    AND actor->>'kind' = 'PERSON'
    AND reason IS NOT NULL AND char_length(btrim(reason)) > 0
  )
);
