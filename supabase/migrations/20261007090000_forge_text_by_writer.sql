-- Forge — words carry only what their writer could read (ADR-0024, amending ADR-0020).
--
-- ADR-0020 sealed every word written on a protected commitment at the commitment's ceiling. That sealed operational
-- lessons from the very people who wrote them: a Supply Chain Director, not cleared for margin, could not read the
-- lesson they had just recorded on a commitment measured by margin. Yet someone Helm never cleared for a class was
-- never shown a value of that class — not by Forge, not by Helm — so their words cannot quote it.
--
-- The ceiling a writer must meet is therefore the commitment's ceiling AS FAR AS THE WRITER COULD READ IT, by Helm's
-- own clearance check, called as the writer. A cleared writer still writes at the full ceiling; nothing lowers what a
-- cleared person wrote, and a writer may still raise their words above it.

CREATE OR REPLACE FUNCTION forge_private.readable_ceiling(p_org uuid, p_commitment text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(c ORDER BY c), '[]'::jsonb)
  FROM jsonb_array_elements_text(forge_private.text_ceiling(p_commitment)) c
  WHERE forge_private.has_helm_clearance(p_org, jsonb_build_array(c));
$$;

REVOKE ALL ON FUNCTION forge_private.readable_ceiling(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION forge_private.readable_ceiling(uuid, text) TO authenticated, service_role;

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
  ceiling := forge_private.readable_ceiling(NEW.org_id, NEW.commitment_id);
  IF NOT (NEW.text_protection @> ceiling) THEN
    RAISE EXCEPTION 'forge.text_below_ceiling: words written on this commitment must carry every class it rests on that the writer can read (%); they cannot be stored less protected', ceiling;
  END IF;
  IF jsonb_array_length(NEW.text_protection) > 0 AND NOT coalesce(NEW.sealed ? 'text', false) THEN
    RAISE EXCEPTION 'forge.unsealed: protected words must arrive sealed';
  END IF;
  RETURN NEW;
END;
$$;
