-- Forge — a commitment taken from a Helm decision is seen by whoever may see that decision.
--
-- Helm restricts who sees a decision: an organization admin, its creator, and
-- members of the units it is shared with (helm_private.can_see_decision). Forge
-- commitments drafted from a Helm commitment carry that decision's question,
-- expected outcomes and trade-offs, so an org-wide read policy would show a
-- restricted decision to every member through Forge. Here Forge INHERITS Helm's
-- rule rather than copying it:
--
--   * forge_commitments.helm_decision_id is derived by the database, never
--     supplied: from origin_ref when it names a Helm decision commitment, else
--     from the parent commitment (so every descendant shares the root's reach).
--   * Reads and writes of a commitment and its events require Helm's own
--     helm_private.can_see_decision when the commitment answers to a Helm
--     decision. Sharing the decision in Helm shares its execution in Forge.
--   * A Helm origin that does not resolve to a Helm commitment is refused once
--     Helm's tables are present: a broken link would otherwise read as public.
--
-- Helm's helper is called dynamically, so this migration also applies where
-- Helm's private schema is absent (Forge's own test fixture); there no
-- commitment resolves to a Helm decision and the rule is inert.

CREATE SCHEMA IF NOT EXISTS forge_private;
REVOKE ALL ON SCHEMA forge_private FROM PUBLIC;
GRANT USAGE ON SCHEMA forge_private TO authenticated, service_role;
COMMENT ON SCHEMA forge_private IS
  'Forge helpers used inside RLS policies and triggers. Not exposed through the API.';

ALTER TABLE public.forge_commitments ADD COLUMN IF NOT EXISTS helm_decision_id uuid;
COMMENT ON COLUMN public.forge_commitments.helm_decision_id IS
  'The Helm decision this commitment (or its root) executes. Derived by forge_stamp_commitment; governs visibility.';
CREATE INDEX IF NOT EXISTS forge_commitments_helm_decision_idx ON public.forge_commitments (helm_decision_id);

-- The Helm decision behind a 'helm:decision-commitment:<id>' reference. SECURITY DEFINER: resolving the link must
-- not depend on the writer's own view of Helm; whether the writer may SEE the decision is the policy's question.
CREATE OR REPLACE FUNCTION forge_private.helm_decision_of(p_ref text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE d uuid;
BEGIN
  IF p_ref IS NULL OR p_ref NOT LIKE 'helm:decision-commitment:%' THEN
    RETURN NULL;
  END IF;
  IF to_regclass('public.helm_decision_commitments') IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT c.decision_id FROM public.helm_decision_commitments c WHERE c.id::text = $1'
    INTO d USING substr(p_ref, char_length('helm:decision-commitment:') + 1);
  IF d IS NULL THEN
    RAISE EXCEPTION 'forge.helm_origin_not_found: % does not name a Helm decision commitment', p_ref;
  END IF;
  RETURN d;
END;
$$;

-- Helm's own visibility rule for a decision, as the caller. No decision: nothing to restrict.
CREATE OR REPLACE FUNCTION forge_private.can_see_helm_decision(p_decision uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE visible boolean;
BEGIN
  IF p_decision IS NULL THEN
    RETURN true;
  END IF;
  IF to_regprocedure('helm_private.can_see_decision(uuid)') IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT helm_private.can_see_decision($1)' INTO visible USING p_decision;
  RETURN coalesce(visible, false);
END;
$$;

REVOKE ALL ON FUNCTION forge_private.helm_decision_of(text), forge_private.can_see_helm_decision(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION forge_private.helm_decision_of(text), forge_private.can_see_helm_decision(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.forge_stamp_commitment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  parent_org uuid;
  parent_decision uuid;
BEGIN
  NEW.recorded_at := now();
  IF NEW.parent_id IS NOT NULL THEN
    SELECT c.org_id, c.helm_decision_id INTO parent_org, parent_decision FROM public.forge_commitments c WHERE c.id = NEW.parent_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN
      RAISE EXCEPTION 'forge.parent_not_found: the parent commitment does not exist in this organization';
    END IF;
  END IF;
  NEW.helm_decision_id := coalesce(
    CASE WHEN NEW.origin_system = 'helm' THEN forge_private.helm_decision_of(NEW.origin_ref) END,
    parent_decision
  );
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------- policies

DROP POLICY IF EXISTS forge_commitments_read ON public.forge_commitments;
CREATE POLICY forge_commitments_read ON public.forge_commitments
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND forge_private.can_see_helm_decision(helm_decision_id));

DROP POLICY IF EXISTS forge_commitments_propose ON public.forge_commitments;
CREATE POLICY forge_commitments_propose ON public.forge_commitments
  FOR INSERT TO authenticated WITH CHECK (
    public.has_org_role(org_id, 'member')
    AND recorded_by = (SELECT auth.uid())
    AND proposed_by->>'kind' = 'PERSON'
    AND proposed_by->>'id' = (SELECT auth.uid())::text
    AND forge_private.can_see_helm_decision(helm_decision_id)
  );

-- An event is visible with its commitment (the subquery runs under the commitment's own policy).
DROP POLICY IF EXISTS forge_events_read ON public.forge_commitment_events;
CREATE POLICY forge_events_read ON public.forge_commitment_events
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND EXISTS (SELECT 1 FROM public.forge_commitments c WHERE c.id = commitment_id));

DROP POLICY IF EXISTS forge_events_record ON public.forge_commitment_events;
CREATE POLICY forge_events_record ON public.forge_commitment_events
  FOR INSERT TO authenticated WITH CHECK (
    public.has_org_role(org_id, 'member')
    AND recorded_by = (SELECT auth.uid())
    AND actor->>'kind' = 'PERSON'
    AND actor->>'id' = (SELECT auth.uid())::text
    AND EXISTS (SELECT 1 FROM public.forge_commitments c WHERE c.id = commitment_id)
  );
