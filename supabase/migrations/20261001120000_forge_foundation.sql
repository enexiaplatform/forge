-- ============================================================================
-- FORGE foundation
--
-- Forge shares one database and one identity with Helm and Memoire. This
-- migration is strictly ADDITIVE: it creates forge_* objects only, and never
-- alters, drops or rewrites a Helm or Memoire table. Re-running it is a no-op.
--
-- It rests on Helm's organization layer (20260808090000_helm_foundation.sql):
-- public.organizations, public.organization_memberships, and the SECURITY
-- DEFINER helpers public.is_org_member(uuid) and public.has_org_role(uuid, text).
-- Forge invents no tenancy of its own.
--
-- Rules the schema keeps (verify:schema checks them):
--   * The hard tenant wall is the organization: every table carries org_id and
--     every policy reads public.is_org_member(org_id) on the row itself, so
--     INSERT ... RETURNING works.
--   * Append-only. Records are inserted, never updated or deleted: clients hold
--     no UPDATE/DELETE privilege, and a guard refuses both for everyone else.
--   * Record time is the database's. A guard stamps recorded_at := now() and
--     assigns each event's per-commitment seq, whatever the client sent.
--   * Nobody writes in another person's name: an authenticated client may only
--     record acts whose actor is itself. Connectors and agents write through the
--     service role, server side.
--   * No stored status, score, rating, rank or progress column. A commitment's
--     phase, its evidence and its conditions are DERIVED from the record.
--
-- What the database does NOT enforce: authority — who may accept, approve or
-- close. The interim policy runs in the Forge runtime; trusted enforcement
-- waits on Helm's authority service (docs/architecture/forge-architecture.md §8).
-- ============================================================================

-- ------------------------------------------------------------- commitments

CREATE TABLE IF NOT EXISTS public.forge_commitments (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_id text REFERENCES public.forge_commitments(id),
  origin_kind text NOT NULL CHECK (origin_kind IN ('DECISION', 'OBJECTIVE', 'OBLIGATION', 'RISK', 'OPPORTUNITY', 'COMMITMENT', 'DIRECT')),
  origin_system text NOT NULL CHECK (char_length(origin_system) BETWEEN 1 AND 60),
  origin_ref text CHECK (origin_ref IS NULL OR char_length(origin_ref) BETWEEN 1 AND 300),
  origin jsonb NOT NULL CHECK (jsonb_typeof(origin) = 'object'),
  terms jsonb NOT NULL CHECK (
    jsonb_typeof(terms) = 'object'
    AND terms ?& ARRAY['statement', 'intendedOutcome', 'why', 'owner', 'principal', 'dueBy', 'evidence', 'measures', 'value']
  ),
  capture jsonb NOT NULL CHECK (jsonb_typeof(capture) = 'object'),
  context jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(context) = 'array'),
  proposed_by jsonb NOT NULL CHECK (proposed_by ?& ARRAY['kind', 'id', 'label'] AND proposed_by->>'kind' IN ('PERSON', 'AGENT', 'SYSTEM')),
  proposed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^cfp_[0-9a-f]{16}$'),
  recorded_by uuid DEFAULT auth.uid(),
  -- A commitment that answers to something must say what.
  CONSTRAINT forge_commitments_origin_referenced CHECK (origin_kind = 'DIRECT' OR origin_ref IS NOT NULL),
  CONSTRAINT forge_commitments_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS forge_commitments_org_idx ON public.forge_commitments (org_id, recorded_at);
CREATE INDEX IF NOT EXISTS forge_commitments_origin_idx ON public.forge_commitments (org_id, origin_ref);
CREATE INDEX IF NOT EXISTS forge_commitments_parent_idx ON public.forge_commitments (parent_id);

COMMENT ON TABLE public.forge_commitments IS
  'Forge: the identity record of an accountable promise, written once. Its phase, current terms and evidence are derived from forge_commitment_events.';

-- -------------------------------------------------------------------- events

CREATE TABLE IF NOT EXISTS public.forge_commitment_events (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  commitment_id text NOT NULL REFERENCES public.forge_commitments(id),
  seq integer NOT NULL DEFAULT 0,
  event_type text NOT NULL CHECK (event_type IN (
    'ACCEPTED', 'DECLINED', 'CHANGE_REQUESTED', 'CHANGE_DECIDED', 'TERMS_CHANGED',
    'DEPENDENCY_DECLARED', 'DEPENDENCY_SETTLED', 'EXECUTION_LINKED', 'ACTIVITY_OBSERVED',
    'EVIDENCE_RECORDED', 'EVIDENCE_DISPUTED', 'OUTCOME_OBSERVED', 'CONTEXT_CHANGED',
    'CONTEXT_REAFFIRMED', 'CLOSED', 'REOPENED', 'LEARNING_RECORDED'
  )),
  effective_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor jsonb NOT NULL CHECK (actor ?& ARRAY['kind', 'id', 'label'] AND actor->>'kind' IN ('PERSON', 'AGENT', 'SYSTEM')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 4000),
  authority jsonb CHECK (authority IS NULL OR authority ?& ARRAY['policy', 'rule', 'statement']),
  idempotency_key text CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 300),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  recorded_by uuid DEFAULT auth.uid(),
  CONSTRAINT forge_events_seq_unique UNIQUE (commitment_id, seq),
  CONSTRAINT forge_events_idempotency_unique UNIQUE (org_id, idempotency_key),
  -- Acts that change the promise carry their reason (§13: preserve why).
  CONSTRAINT forge_events_reason_required CHECK (
    event_type NOT IN ('DECLINED', 'CHANGE_REQUESTED', 'TERMS_CHANGED', 'CLOSED', 'EVIDENCE_DISPUTED', 'CONTEXT_REAFFIRMED', 'REOPENED')
    OR (reason IS NOT NULL AND char_length(btrim(reason)) > 0)
  ),
  CONSTRAINT forge_events_rejection_reasoned CHECK (
    event_type <> 'CHANGE_DECIDED' OR payload->>'decision' <> 'REJECTED' OR (reason IS NOT NULL AND char_length(btrim(reason)) > 0)
  ),
  CONSTRAINT forge_events_resolution_known CHECK (
    event_type <> 'CLOSED'
    OR payload->>'resolution' IN ('FULFILLED', 'PARTIALLY_FULFILLED', 'MISSED', 'SUPERSEDED', 'CANCELLED', 'INVALIDATED', 'ABANDONED')
  ),
  -- An inference is never recorded as a fact, and a fact never carries a confidence.
  CONSTRAINT forge_events_evidence_epistemics CHECK (
    event_type <> 'EVIDENCE_RECORDED'
    OR (
      (payload->'evidence'->>'epistemic' = 'INFERENCE') = (payload->'evidence'->>'channel' = 'INFERENCE')
      AND (payload->'evidence'->>'epistemic' <> 'FACT' OR jsonb_typeof(payload->'evidence'->'confidence') = 'null')
    )
  ),
  -- Only a connector reports a source system's record; only an agent infers.
  CONSTRAINT forge_events_evidence_channel_actor CHECK (
    event_type <> 'EVIDENCE_RECORDED'
    OR (payload->'evidence'->>'channel' IN ('SYSTEM_EVENT', 'API')) = (actor->>'kind' = 'SYSTEM')
  )
);

CREATE INDEX IF NOT EXISTS forge_events_commitment_idx ON public.forge_commitment_events (commitment_id, recorded_at, seq);
CREATE INDEX IF NOT EXISTS forge_events_org_idx ON public.forge_commitment_events (org_id, recorded_at);

COMMENT ON TABLE public.forge_commitment_events IS
  'Forge: everything that happens to a commitment, append-only, with who acted, under which authority verdict, and why.';

-- -------------------------------------------------------------- observations

CREATE TABLE IF NOT EXISTS public.forge_observations (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_system text NOT NULL CHECK (char_length(source_system) BETWEEN 1 AND 60),
  id text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 200),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 120),
  object_ref text NOT NULL CHECK (char_length(object_ref) BETWEEN 1 AND 300),
  entity_ref text,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 2000),
  url text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, source_system, id)
);

CREATE INDEX IF NOT EXISTS forge_observations_checkpoint_idx ON public.forge_observations (org_id, source_system, occurred_at);

COMMENT ON TABLE public.forge_observations IS
  'Forge: the ingestion ledger — what each execution surface reported, once. A surface''s checkpoint is derived from it (max occurred_at), never stored.';

-- -------------------------------------------------------------------- guards

CREATE OR REPLACE FUNCTION public.forge_guard_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'forge.append_only: % is append-only; record a new event instead', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION public.forge_stamp_commitment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE parent_org uuid;
BEGIN
  NEW.recorded_at := now();
  IF NEW.parent_id IS NOT NULL THEN
    SELECT c.org_id INTO parent_org FROM public.forge_commitments c WHERE c.id = NEW.parent_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN
      RAISE EXCEPTION 'forge.parent_not_found: the parent commitment does not exist in this organization';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.forge_stamp_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE commitment_org uuid;
BEGIN
  SELECT c.org_id INTO commitment_org FROM public.forge_commitments c WHERE c.id = NEW.commitment_id;
  IF commitment_org IS NULL OR commitment_org <> NEW.org_id THEN
    RAISE EXCEPTION 'forge.commitment_not_found: the commitment does not exist in this organization';
  END IF;
  -- One writer per commitment at a time, so seq is gap-free and ordered.
  PERFORM pg_advisory_xact_lock(hashtext('forge:' || NEW.commitment_id));
  SELECT COALESCE(MAX(e.seq), 0) + 1 INTO NEW.seq FROM public.forge_commitment_events e WHERE e.commitment_id = NEW.commitment_id;
  NEW.recorded_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.forge_stamp_observation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.recorded_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS forge_commitments_stamp ON public.forge_commitments;
CREATE TRIGGER forge_commitments_stamp BEFORE INSERT ON public.forge_commitments
  FOR EACH ROW EXECUTE FUNCTION public.forge_stamp_commitment();
DROP TRIGGER IF EXISTS forge_commitments_append_only ON public.forge_commitments;
CREATE TRIGGER forge_commitments_append_only BEFORE UPDATE OR DELETE ON public.forge_commitments
  FOR EACH ROW EXECUTE FUNCTION public.forge_guard_append_only();

DROP TRIGGER IF EXISTS forge_events_stamp ON public.forge_commitment_events;
CREATE TRIGGER forge_events_stamp BEFORE INSERT ON public.forge_commitment_events
  FOR EACH ROW EXECUTE FUNCTION public.forge_stamp_event();
DROP TRIGGER IF EXISTS forge_events_append_only ON public.forge_commitment_events;
CREATE TRIGGER forge_events_append_only BEFORE UPDATE OR DELETE ON public.forge_commitment_events
  FOR EACH ROW EXECUTE FUNCTION public.forge_guard_append_only();

DROP TRIGGER IF EXISTS forge_observations_stamp ON public.forge_observations;
CREATE TRIGGER forge_observations_stamp BEFORE INSERT ON public.forge_observations
  FOR EACH ROW EXECUTE FUNCTION public.forge_stamp_observation();
DROP TRIGGER IF EXISTS forge_observations_append_only ON public.forge_observations;
CREATE TRIGGER forge_observations_append_only BEFORE UPDATE OR DELETE ON public.forge_observations
  FOR EACH ROW EXECUTE FUNCTION public.forge_guard_append_only();

-- ----------------------------------------------------------------------- RLS

ALTER TABLE public.forge_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forge_commitment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forge_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forge_commitments_read ON public.forge_commitments;
CREATE POLICY forge_commitments_read ON public.forge_commitments
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS forge_commitments_propose ON public.forge_commitments;
CREATE POLICY forge_commitments_propose ON public.forge_commitments
  FOR INSERT TO authenticated WITH CHECK (
    public.has_org_role(org_id, 'member')
    AND recorded_by = (SELECT auth.uid())
    AND proposed_by->>'kind' = 'PERSON'
    AND proposed_by->>'id' = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS forge_events_read ON public.forge_commitment_events;
CREATE POLICY forge_events_read ON public.forge_commitment_events
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS forge_events_record ON public.forge_commitment_events;
CREATE POLICY forge_events_record ON public.forge_commitment_events
  FOR INSERT TO authenticated WITH CHECK (
    public.has_org_role(org_id, 'member')
    AND recorded_by = (SELECT auth.uid())
    AND actor->>'kind' = 'PERSON'
    AND actor->>'id' = (SELECT auth.uid())::text
  );

-- Observations are written by connectors through the service role; members read them.
DROP POLICY IF EXISTS forge_observations_read ON public.forge_observations;
CREATE POLICY forge_observations_read ON public.forge_observations
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

-- ---------------------------------------------------------------- privileges

REVOKE ALL ON public.forge_commitments, public.forge_commitment_events, public.forge_observations FROM anon, public;
REVOKE UPDATE, DELETE, TRUNCATE ON public.forge_commitments, public.forge_commitment_events, public.forge_observations FROM authenticated;
-- Supabase's default privileges grant everything to authenticated; observations are the connectors' to write.
REVOKE INSERT ON public.forge_observations FROM authenticated;
GRANT SELECT, INSERT ON public.forge_commitments, public.forge_commitment_events TO authenticated;
GRANT SELECT ON public.forge_observations TO authenticated;

REVOKE ALL ON FUNCTION public.forge_guard_append_only() FROM anon, public;
REVOKE ALL ON FUNCTION public.forge_stamp_commitment() FROM anon, public;
REVOKE ALL ON FUNCTION public.forge_stamp_event() FROM anon, public;
REVOKE ALL ON FUNCTION public.forge_stamp_observation() FROM anon, public;
