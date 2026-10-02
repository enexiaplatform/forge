-- ============================================================================
-- FORGE — candidates, communication origins, published outcomes
--
-- Additive, forge_* only. Implements three product decisions of 2026-10-01:
--
--   * A customer promise in Memoire, or a sentence in meeting notes, may become
--     a CANDIDATE commitment. A candidate is an inference: it binds nobody, and
--     only a person confirms or dismisses it. One disposition per candidate,
--     forever; a confirmation names the commitment it proposed.
--   * A commitment can answer to a COMMUNICATION — the meeting or message where
--     it was made.
--   * A verified outcome can be PUBLISHED for Helm's enterprise memory, by a
--     person, as an append-only event Helm reads.
--
-- Same rules as the foundation: org-scoped RLS on the row itself, append-only
-- guards, database record time, no stored state, nobody writes in another
-- person's name. Agents and connectors suggest candidates through the service
-- role, server side.
-- ============================================================================

-- --------------------------------------------- vocabulary on existing tables

ALTER TABLE public.forge_commitments DROP CONSTRAINT IF EXISTS forge_commitments_origin_kind_check;
ALTER TABLE public.forge_commitments ADD CONSTRAINT forge_commitments_origin_kind_check
  CHECK (origin_kind IN ('DECISION', 'OBJECTIVE', 'OBLIGATION', 'RISK', 'OPPORTUNITY', 'COMMITMENT', 'COMMUNICATION', 'DIRECT'));

ALTER TABLE public.forge_commitment_events DROP CONSTRAINT IF EXISTS forge_commitment_events_event_type_check;
ALTER TABLE public.forge_commitment_events ADD CONSTRAINT forge_commitment_events_event_type_check CHECK (event_type IN (
  'ACCEPTED', 'DECLINED', 'CHANGE_REQUESTED', 'CHANGE_DECIDED', 'TERMS_CHANGED',
  'DEPENDENCY_DECLARED', 'DEPENDENCY_SETTLED', 'EXECUTION_LINKED', 'ACTIVITY_OBSERVED',
  'EVIDENCE_RECORDED', 'EVIDENCE_DISPUTED', 'OUTCOME_OBSERVED', 'CONTEXT_CHANGED',
  'CONTEXT_REAFFIRMED', 'CLOSED', 'REOPENED', 'LEARNING_RECORDED', 'OUTCOME_PUBLISHED'
));

-- Publishing to enterprise memory is a person's act, and what is published is fingerprinted.
ALTER TABLE public.forge_commitment_events DROP CONSTRAINT IF EXISTS forge_events_publication_by_person;
ALTER TABLE public.forge_commitment_events ADD CONSTRAINT forge_events_publication_by_person CHECK (
  event_type <> 'OUTCOME_PUBLISHED'
  OR (actor->>'kind' = 'PERSON' AND payload->'publication'->>'fingerprint' ~ '^fop_[0-9a-f]{16}$')
);

-- ---------------------------------------------------------------- candidates

CREATE TABLE IF NOT EXISTS public.forge_candidates (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('MEETING_NOTES', 'TRANSCRIPT', 'MESSAGE', 'MEMOIRE_PROMISE')),
  source_ref text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 300),
  source jsonb NOT NULL CHECK (jsonb_typeof(source) = 'object'),
  -- Discussion, requests and intentions are never candidates.
  utterance_class text NOT NULL CHECK (utterance_class IN ('COMMITMENT', 'DECISION')),
  proposal jsonb NOT NULL CHECK (jsonb_typeof(proposal) = 'object' AND proposal ? 'statement'),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  -- A candidate is an inference, always.
  epistemic text NOT NULL DEFAULT 'INFERENCE' CHECK (epistemic = 'INFERENCE'),
  extractor jsonb NOT NULL CHECK (extractor ? 'name'),
  suggested_by jsonb NOT NULL CHECK (suggested_by ?& ARRAY['kind', 'id', 'label'] AND suggested_by->>'kind' IN ('PERSON', 'AGENT', 'SYSTEM')),
  suggested_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 400),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^cnd_[0-9a-f]{16}$'),
  recorded_by uuid DEFAULT auth.uid(),
  CONSTRAINT forge_candidates_dedupe UNIQUE (org_id, dedupe_key),
  -- A candidate read from a conversation quotes the words it rests on.
  CONSTRAINT forge_candidates_conversations_quoted CHECK (
    source_kind = 'MEMOIRE_PROMISE' OR (source->>'quote' IS NOT NULL AND char_length(btrim(source->>'quote')) > 0)
  )
);

CREATE INDEX IF NOT EXISTS forge_candidates_org_idx ON public.forge_candidates (org_id, recorded_at);

COMMENT ON TABLE public.forge_candidates IS
  'Forge: what might be a commitment, read from a Memoire promise or a conversation. An inference; it binds nobody.';

CREATE TABLE IF NOT EXISTS public.forge_candidate_dispositions (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id text NOT NULL REFERENCES public.forge_candidates(id),
  kind text NOT NULL CHECK (kind IN ('CONFIRMED', 'DISMISSED')),
  -- Only a person confirms or dismisses: a model never turns language into an obligation.
  actor jsonb NOT NULL CHECK (actor ?& ARRAY['kind', 'id', 'label'] AND actor->>'kind' = 'PERSON'),
  at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 4000),
  commitment_id text REFERENCES public.forge_commitments(id),
  edited jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(edited) = 'array'),
  recorded_by uuid DEFAULT auth.uid(),
  CONSTRAINT forge_dispositions_once UNIQUE (candidate_id),
  CONSTRAINT forge_dispositions_confirmed_names_commitment CHECK (kind <> 'CONFIRMED' OR commitment_id IS NOT NULL),
  CONSTRAINT forge_dispositions_dismissed_reasoned CHECK (kind <> 'DISMISSED' OR (reason IS NOT NULL AND char_length(btrim(reason)) > 0 AND commitment_id IS NULL))
);

COMMENT ON TABLE public.forge_candidate_dispositions IS
  'Forge: a person''s confirmation (naming the commitment it proposed) or dismissal (with a reason) of a candidate. Once per candidate.';

-- -------------------------------------------------------------------- guards

CREATE OR REPLACE FUNCTION public.forge_stamp_candidate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.recorded_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.forge_stamp_disposition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE candidate_org uuid; commitment_org uuid;
BEGIN
  SELECT c.org_id INTO candidate_org FROM public.forge_candidates c WHERE c.id = NEW.candidate_id;
  IF candidate_org IS NULL OR candidate_org <> NEW.org_id THEN
    RAISE EXCEPTION 'forge.candidate_not_found: the candidate does not exist in this organization';
  END IF;
  IF NEW.commitment_id IS NOT NULL THEN
    SELECT c.org_id INTO commitment_org FROM public.forge_commitments c WHERE c.id = NEW.commitment_id;
    IF commitment_org IS NULL OR commitment_org <> NEW.org_id THEN
      RAISE EXCEPTION 'forge.commitment_not_found: the confirmed commitment does not exist in this organization';
    END IF;
  END IF;
  NEW.recorded_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS forge_candidates_stamp ON public.forge_candidates;
CREATE TRIGGER forge_candidates_stamp BEFORE INSERT ON public.forge_candidates
  FOR EACH ROW EXECUTE FUNCTION public.forge_stamp_candidate();
DROP TRIGGER IF EXISTS forge_candidates_append_only ON public.forge_candidates;
CREATE TRIGGER forge_candidates_append_only BEFORE UPDATE OR DELETE ON public.forge_candidates
  FOR EACH ROW EXECUTE FUNCTION public.forge_guard_append_only();

DROP TRIGGER IF EXISTS forge_dispositions_stamp ON public.forge_candidate_dispositions;
CREATE TRIGGER forge_dispositions_stamp BEFORE INSERT ON public.forge_candidate_dispositions
  FOR EACH ROW EXECUTE FUNCTION public.forge_stamp_disposition();
DROP TRIGGER IF EXISTS forge_dispositions_append_only ON public.forge_candidate_dispositions;
CREATE TRIGGER forge_dispositions_append_only BEFORE UPDATE OR DELETE ON public.forge_candidate_dispositions
  FOR EACH ROW EXECUTE FUNCTION public.forge_guard_append_only();

-- ----------------------------------------------------------------------- RLS

ALTER TABLE public.forge_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forge_candidate_dispositions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forge_candidates_read ON public.forge_candidates;
CREATE POLICY forge_candidates_read ON public.forge_candidates
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS forge_candidates_suggest ON public.forge_candidates;
CREATE POLICY forge_candidates_suggest ON public.forge_candidates
  FOR INSERT TO authenticated WITH CHECK (
    public.has_org_role(org_id, 'member')
    AND recorded_by = (SELECT auth.uid())
    AND suggested_by->>'kind' = 'PERSON'
    AND suggested_by->>'id' = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS forge_dispositions_read ON public.forge_candidate_dispositions;
CREATE POLICY forge_dispositions_read ON public.forge_candidate_dispositions
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS forge_dispositions_record ON public.forge_candidate_dispositions;
CREATE POLICY forge_dispositions_record ON public.forge_candidate_dispositions
  FOR INSERT TO authenticated WITH CHECK (
    public.has_org_role(org_id, 'member')
    AND recorded_by = (SELECT auth.uid())
    AND actor->>'id' = (SELECT auth.uid())::text
  );

-- ---------------------------------------------------------------- privileges

REVOKE ALL ON public.forge_candidates, public.forge_candidate_dispositions FROM anon, public;
REVOKE UPDATE, DELETE, TRUNCATE ON public.forge_candidates, public.forge_candidate_dispositions FROM authenticated;
GRANT SELECT, INSERT ON public.forge_candidates, public.forge_candidate_dispositions TO authenticated;

REVOKE ALL ON FUNCTION public.forge_stamp_candidate() FROM anon, public;
REVOKE ALL ON FUNCTION public.forge_stamp_disposition() FROM anon, public;
