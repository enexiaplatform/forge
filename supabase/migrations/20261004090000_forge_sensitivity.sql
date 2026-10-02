-- Forge — a fact keeps its sensitivity wherever it goes (ADR-0017).
--
-- Helm classifies values (Helm ADR-0025): gross margin is FINANCIAL_SENSITIVE
-- wherever it appears, and only people Helm has cleared may read it. Forge
-- carries that class with every fact derived from such a value — the evidence
-- built from it, an outcome that states it, a publication that carries it — and
-- enforces it with Helm's own clearance check, not a copy of it.
--
--   * forge_commitment_events.protection — the restricted classes an event
--     carries, derived by the kernel from its payload (sensitivity.ts).
--   * A protected event is written OPEN: protected values removed and marked
--     withheld, the narrative stated with them replaced by a sentence saying so.
--     Its sealed part arrives in the transient column `sealed`, which a trigger
--     moves into forge_sealed_values in the same statement; nothing protected
--     remains readable on the event row.
--   * forge_sealed_values is read only by members who may see the commitment
--     AND are cleared, by Helm, for every class it carries.
--   * A protected observation in the ingestion ledger is read whole or not at
--     all, the rule Helm keeps for genome episodes.
--
-- Redaction, not omission: every reader of a commitment sees the same events
-- and derives the same status; only the protected values differ.

CREATE OR REPLACE FUNCTION forge_private.is_protection(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(p) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p) c
      WHERE jsonb_typeof(c) <> 'string'
         OR c #>> '{}' NOT IN ('FINANCIAL_SENSITIVE', 'COMMERCIAL_CONFIDENTIAL', 'HR_RESTRICTED', 'STRATEGIC_RESTRICTED')
    );
$$;

-- Helm's own clearance rule (helm_private.has_clearance: admins hold every class; others need a current clearance),
-- for every class. Called dynamically so the migration applies where Helm is absent; there, a protected fact is
-- readable by nobody but the service role — closed, not open.
CREATE OR REPLACE FUNCTION forge_private.has_helm_clearance(p_org uuid, p_protection jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c text;
  cleared boolean;
BEGIN
  IF p_protection IS NULL OR jsonb_array_length(p_protection) = 0 THEN
    RETURN true;
  END IF;
  IF to_regprocedure('helm_private.has_clearance(uuid,text)') IS NULL THEN
    RETURN false;
  END IF;
  FOR c IN SELECT jsonb_array_elements_text(p_protection) LOOP
    EXECUTE 'SELECT helm_private.has_clearance($1, $2)' INTO cleared USING p_org, c;
    IF NOT coalesce(cleared, false) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION forge_private.is_protection(jsonb), forge_private.has_helm_clearance(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION forge_private.is_protection(jsonb), forge_private.has_helm_clearance(uuid, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------------ events

ALTER TABLE public.forge_commitment_events ADD COLUMN IF NOT EXISTS protection jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.forge_commitment_events ADD COLUMN IF NOT EXISTS sealed jsonb;
ALTER TABLE public.forge_commitment_events DROP CONSTRAINT IF EXISTS forge_events_protection_known;
ALTER TABLE public.forge_commitment_events ADD CONSTRAINT forge_events_protection_known CHECK (forge_private.is_protection(protection));
COMMENT ON COLUMN public.forge_commitment_events.protection IS
  'The restricted sensitivity classes this event carries (ADR-0017). Its protected values live in forge_sealed_values.';
COMMENT ON COLUMN public.forge_commitment_events.sealed IS
  'Transient: the sealed part arrives here and is moved to forge_sealed_values by forge_seal_event; always NULL once stored.';

CREATE TABLE IF NOT EXISTS public.forge_sealed_values (
  event_id text PRIMARY KEY REFERENCES public.forge_commitment_events(id) DEFERRABLE INITIALLY DEFERRED,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  commitment_id text NOT NULL REFERENCES public.forge_commitments(id),
  protection jsonb NOT NULL CHECK (forge_private.is_protection(protection) AND jsonb_array_length(protection) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS forge_sealed_values_commitment_idx ON public.forge_sealed_values (org_id, commitment_id);

COMMENT ON TABLE public.forge_sealed_values IS
  'Forge: the protected values of protected events, readable only by people Helm has cleared for every class (ADR-0017).';

-- Runs as its owner: a client never writes forge_sealed_values directly, and the sealed part never stays on the event.
CREATE OR REPLACE FUNCTION public.forge_seal_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF jsonb_array_length(NEW.protection) > 0 AND NEW.sealed IS NULL THEN
    RAISE EXCEPTION 'forge.unsealed: an event that carries protected values must arrive with them sealed';
  END IF;
  IF NEW.sealed IS NOT NULL THEN
    IF jsonb_array_length(NEW.protection) = 0 THEN
      RAISE EXCEPTION 'forge.unprotected_seal: sealed values need the class that protects them';
    END IF;
    INSERT INTO public.forge_sealed_values (event_id, org_id, commitment_id, protection, payload)
    VALUES (NEW.id, NEW.org_id, NEW.commitment_id, NEW.protection, NEW.sealed);
    NEW.sealed := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.forge_stamp_sealed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.recorded_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS forge_events_seal ON public.forge_commitment_events;
CREATE TRIGGER forge_events_seal BEFORE INSERT ON public.forge_commitment_events
  FOR EACH ROW EXECUTE FUNCTION public.forge_seal_event();

DROP TRIGGER IF EXISTS forge_sealed_values_stamp ON public.forge_sealed_values;
CREATE TRIGGER forge_sealed_values_stamp BEFORE INSERT ON public.forge_sealed_values
  FOR EACH ROW EXECUTE FUNCTION public.forge_stamp_sealed();
DROP TRIGGER IF EXISTS forge_sealed_values_append_only ON public.forge_sealed_values;
CREATE TRIGGER forge_sealed_values_append_only BEFORE UPDATE OR DELETE ON public.forge_sealed_values
  FOR EACH ROW EXECUTE FUNCTION public.forge_guard_append_only();

ALTER TABLE public.forge_sealed_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forge_sealed_values_read ON public.forge_sealed_values;
CREATE POLICY forge_sealed_values_read ON public.forge_sealed_values
  FOR SELECT TO authenticated
  USING (
    public.is_org_member(org_id)
    AND EXISTS (SELECT 1 FROM public.forge_commitments c WHERE c.id = commitment_id)
    AND forge_private.has_helm_clearance(org_id, protection)
  );

REVOKE ALL ON public.forge_sealed_values FROM anon, public;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.forge_sealed_values FROM authenticated;
GRANT SELECT ON public.forge_sealed_values TO authenticated;

REVOKE ALL ON FUNCTION public.forge_seal_event() FROM anon, public;
REVOKE ALL ON FUNCTION public.forge_stamp_sealed() FROM anon, public;

-- ------------------------------------------------------------ observations

ALTER TABLE public.forge_observations ADD COLUMN IF NOT EXISTS protection jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.forge_observations DROP CONSTRAINT IF EXISTS forge_observations_protection_known;
ALTER TABLE public.forge_observations ADD CONSTRAINT forge_observations_protection_known CHECK (forge_private.is_protection(protection));

DROP POLICY IF EXISTS forge_observations_read ON public.forge_observations;
CREATE POLICY forge_observations_read ON public.forge_observations
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND forge_private.has_helm_clearance(org_id, protection));
