-- Forge — words keep the ceiling of the commitment they are written on (ADR-0017, amended).
--
-- A reason, an explanation or a lesson is written by a person, and nobody can tell from a sentence whether it
-- quotes a protected value. So the words take the CEILING of their commitment: every class it rests on when they
-- are written — its measures (from Helm's value classes), its evidence, its outcome, the words before them. The
-- writer may raise it; nothing lowers it. Lowering is a clearance act in Helm, not a field in Forge.
--
--   * forge_commitment_events.text_protection — the class of the words written with the event; always contained
--     in the event's protection, so the words are sealed in forge_sealed_values with everything else.
--   * forge_events_ceiling refuses words stored below the commitment's ceiling, and words marked protected that
--     did not arrive sealed. It runs before forge_events_seal (triggers fire in name order).

ALTER TABLE public.forge_commitment_events ADD COLUMN IF NOT EXISTS text_protection jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.forge_commitment_events DROP CONSTRAINT IF EXISTS forge_events_text_protection_known;
ALTER TABLE public.forge_commitment_events ADD CONSTRAINT forge_events_text_protection_known
  CHECK (forge_private.is_protection(text_protection) AND protection @> text_protection);
COMMENT ON COLUMN public.forge_commitment_events.text_protection IS
  'The classes of the words written with this event (its reason, a learning): at least the commitment''s ceiling when written (ADR-0017).';

-- The highest class a commitment rests on: its measures, a rescope's measures, and every event already on it.
-- Runs as its owner so the ceiling is the commitment's, not what this reader happens to be able to see.
CREATE OR REPLACE FUNCTION forge_private.text_ceiling(p_commitment text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(DISTINCT c ORDER BY c), '[]'::jsonb)
  FROM (
    SELECT jsonb_path_query(c.terms, '$.measures[*].protection[*]') #>> '{}' AS c
      FROM public.forge_commitments c WHERE c.id = p_commitment
    UNION
    SELECT jsonb_array_elements_text(e.protection)
      FROM public.forge_commitment_events e WHERE e.commitment_id = p_commitment
    UNION
    SELECT jsonb_path_query(e.payload, '$.change.measures[*].protection[*]') #>> '{}'
      FROM public.forge_commitment_events e WHERE e.commitment_id = p_commitment AND e.event_type = 'TERMS_CHANGED'
  ) classes
  WHERE c IN ('FINANCIAL_SENSITIVE', 'COMMERCIAL_CONFIDENTIAL', 'HR_RESTRICTED', 'STRATEGIC_RESTRICTED');
$$;

REVOKE ALL ON FUNCTION forge_private.text_ceiling(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION forge_private.text_ceiling(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.forge_guard_text_ceiling()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  has_text boolean := (NEW.reason IS NOT NULL AND btrim(NEW.reason) <> '') OR NEW.event_type = 'LEARNING_RECORDED';
  ceiling jsonb;
BEGIN
  IF NOT has_text THEN
    IF jsonb_array_length(NEW.text_protection) > 0 THEN
      RAISE EXCEPTION 'forge.text_unwritten: only words can carry a class for words';
    END IF;
    RETURN NEW;
  END IF;
  ceiling := forge_private.text_ceiling(NEW.commitment_id);
  IF NOT (NEW.text_protection @> ceiling) THEN
    RAISE EXCEPTION 'forge.text_below_ceiling: words written on this commitment must carry every class it rests on (%); they cannot be stored less protected', ceiling;
  END IF;
  IF jsonb_array_length(NEW.text_protection) > 0 AND NOT coalesce(NEW.sealed ? 'text', false) THEN
    RAISE EXCEPTION 'forge.unsealed: protected words must arrive sealed';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.forge_guard_text_ceiling() FROM anon, public;

DROP TRIGGER IF EXISTS forge_events_ceiling ON public.forge_commitment_events;
CREATE TRIGGER forge_events_ceiling BEFORE INSERT ON public.forge_commitment_events
  FOR EACH ROW EXECUTE FUNCTION public.forge_guard_text_ceiling();
