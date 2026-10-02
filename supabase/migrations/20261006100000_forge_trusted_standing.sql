-- Forge — acts that bind accountability rest on Helm's standing, and the database checks it (ADR-0021).
--
-- Who may accept a promise, decide a change to it, close or reopen it was enforced in the runtime only: the
-- interim policy, in the browser, from parties the client says it acts as (ADR-0013). Helm now attests, from its
-- own seat records, whether a verified caller may act for a person (Helm ADR-0036). This migration binds Forge's
-- consequential events to that attestation, in the database, where a tampered client cannot reach:
--
--   * an event that CLAIMS a trusted verdict must name a Helm standing attestation that is Helm's, made in the
--     last ten minutes, by the person writing the event, for a person who holds that act on that very commitment —
--     computed here from Forge's own record (the owner, a handover, the principal, the request's approver);
--   * forge_authority_modes records, append-only, when an organization moved to TRUSTED authority; from then on
--     every consequential event needs that attestation — the interim policy can no longer decide them. Only the
--     service role records a mode change (a deployment step, with its reason), never a client.
--
-- Called dynamically: where Helm's attestations are absent, a trusted claim is refused — closed, not open.

-- ------------------------------------------------------------------ modes

CREATE TABLE IF NOT EXISTS public.forge_authority_modes (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('INTERIM', 'TRUSTED')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 4 AND 2000),
  recorded_by uuid DEFAULT auth.uid(),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forge_authority_modes_org_idx ON public.forge_authority_modes (org_id, recorded_at);

COMMENT ON TABLE public.forge_authority_modes IS
  'Forge: when an organization''s consequential acts began to need Helm''s trusted authority (ADR-0021). Append-only; written by the service role.';

CREATE OR REPLACE FUNCTION public.forge_stamp_authority_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.recorded_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS forge_authority_modes_stamp ON public.forge_authority_modes;
CREATE TRIGGER forge_authority_modes_stamp BEFORE INSERT ON public.forge_authority_modes
  FOR EACH ROW EXECUTE FUNCTION public.forge_stamp_authority_mode();
DROP TRIGGER IF EXISTS forge_authority_modes_append_only ON public.forge_authority_modes;
CREATE TRIGGER forge_authority_modes_append_only BEFORE UPDATE OR DELETE ON public.forge_authority_modes
  FOR EACH ROW EXECUTE FUNCTION public.forge_guard_append_only();

ALTER TABLE public.forge_authority_modes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forge_authority_modes_read ON public.forge_authority_modes;
CREATE POLICY forge_authority_modes_read ON public.forge_authority_modes
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

REVOKE ALL ON public.forge_authority_modes FROM anon, public;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.forge_authority_modes FROM authenticated;
GRANT SELECT ON public.forge_authority_modes TO authenticated;
REVOKE ALL ON FUNCTION public.forge_stamp_authority_mode() FROM anon, public;

CREATE OR REPLACE FUNCTION forge_private.trusted_mode(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((SELECT m.mode = 'TRUSTED' FROM public.forge_authority_modes m WHERE m.org_id = p_org ORDER BY m.recorded_at DESC, m.id DESC LIMIT 1), false);
$$;

-- ------------------------------------------------------------- the holders

-- Who holds an act on a commitment, by Forge's own record: the owner (after any handover) accepts, declines,
-- requests a change and reports delivery; the principal changes, closes and reopens; a request's approver decides it.
CREATE OR REPLACE FUNCTION forge_private.act_holders(p_commitment text, p_event_type text, p_payload jsonb)
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  owner_ref text;
  handed_to text;
  principal_ref text;
  approver_ref text;
BEGIN
  SELECT c.terms->'owner'->>'ref', c.terms->'principal'->>'ref' INTO owner_ref, principal_ref
    FROM public.forge_commitments c WHERE c.id = p_commitment;
  -- A handover moves the owner; without one, the owner is the one first named (a SELECT that finds nothing
  -- leaves its target NULL, so the handover is read into its own variable).
  SELECT e.payload->'change'->'owner'->>'ref' INTO handed_to
    FROM public.forge_commitment_events e
    WHERE e.commitment_id = p_commitment AND e.event_type = 'TERMS_CHANGED' AND e.payload->'change'->>'kind' = 'REASSIGN'
    ORDER BY e.recorded_at DESC, e.seq DESC LIMIT 1;
  owner_ref := coalesce(handed_to, owner_ref);
  IF p_payload ? 'requestId' AND p_payload->>'requestId' IS NOT NULL THEN
    SELECT e.payload->'approver'->>'ref' INTO approver_ref
      FROM public.forge_commitment_events e
      WHERE e.commitment_id = p_commitment AND e.event_type = 'CHANGE_REQUESTED' AND e.payload->>'requestId' = p_payload->>'requestId'
      LIMIT 1;
  END IF;
  RETURN array_remove(CASE p_event_type
    WHEN 'ACCEPTED' THEN ARRAY[owner_ref]
    WHEN 'DECLINED' THEN ARRAY[owner_ref]
    WHEN 'CHANGE_REQUESTED' THEN ARRAY[owner_ref, principal_ref]
    WHEN 'CHANGE_DECIDED' THEN ARRAY[coalesce(approver_ref, principal_ref)]
    WHEN 'TERMS_CHANGED' THEN ARRAY[principal_ref, approver_ref]
    WHEN 'CLOSED' THEN CASE WHEN p_payload->>'resolution' IN ('FULFILLED', 'PARTIALLY_FULFILLED', 'MISSED')
      THEN ARRAY[owner_ref, principal_ref, approver_ref] ELSE ARRAY[principal_ref, approver_ref] END
    WHEN 'REOPENED' THEN ARRAY[principal_ref]
    ELSE ARRAY[]::text[]
  END, NULL);
END;
$$;

-- -------------------------------------------------------------- the guard

CREATE OR REPLACE FUNCTION public.forge_guard_standing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claims_trust boolean := coalesce((NEW.authority->>'trusted')::boolean, false);
  attestation text := NEW.authority->>'attestation';
  a_org uuid;
  a_caller uuid;
  a_for text;
  a_at timestamptz;
BEGIN
  IF NEW.event_type NOT IN ('ACCEPTED', 'DECLINED', 'CHANGE_REQUESTED', 'CHANGE_DECIDED', 'TERMS_CHANGED', 'CLOSED', 'REOPENED') THEN
    RETURN NEW;
  END IF;
  IF NOT claims_trust AND NOT forge_private.trusted_mode(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  IF attestation IS NULL OR attestation !~ '^[0-9a-f-]{36}$' THEN
    RAISE EXCEPTION 'forge.untrusted: this act binds accountability, and it needs Helm''s standing attestation';
  END IF;
  IF to_regclass('public.helm_standing_attestations') IS NULL THEN
    RAISE EXCEPTION 'forge.untrusted: Helm''s standing record is not in this database, so no act can claim it';
  END IF;
  EXECUTE 'SELECT org_id, caller_user_id, for_user_id::text, attested_at FROM public.helm_standing_attestations WHERE id = $1::uuid'
    INTO a_org, a_caller, a_for, a_at USING attestation;
  IF a_org IS NULL OR a_org <> NEW.org_id THEN
    RAISE EXCEPTION 'forge.untrusted: no such Helm attestation in this organization';
  END IF;
  IF NEW.recorded_by IS NULL OR a_caller <> NEW.recorded_by THEN
    RAISE EXCEPTION 'forge.untrusted: the attestation is someone else''s';
  END IF;
  IF a_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'forge.untrusted: the attestation is too old to rest an act on; ask Helm again';
  END IF;
  IF NOT (a_for = ANY (forge_private.act_holders(NEW.commitment_id, NEW.event_type, NEW.payload))) THEN
    RAISE EXCEPTION 'forge.untrusted: Helm attested standing for someone who does not hold this act on this commitment';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION forge_private.trusted_mode(uuid), forge_private.act_holders(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION forge_private.trusted_mode(uuid), forge_private.act_holders(text, text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.forge_guard_standing() FROM anon, public;

DROP TRIGGER IF EXISTS forge_events_standing ON public.forge_commitment_events;
CREATE TRIGGER forge_events_standing BEFORE INSERT ON public.forge_commitment_events
  FOR EACH ROW EXECUTE FUNCTION public.forge_guard_standing();
