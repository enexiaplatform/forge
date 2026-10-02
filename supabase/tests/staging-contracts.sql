-- Forge × Helm staging contracts — run on an isolated Supabase project AFTER Helm's migrations and Forge's.
--
-- SYNTHETIC data only: fresh random ids every run, labelled SYNTHETIC, in two synthetic organizations. Nothing here
-- reads or touches real tenants. The same script is proven locally on PGlite with the real migrations
-- (integration/staging-contracts.test.mjs), so a staging run checks the real platform, not a new script.
--
-- Each check acts as a signed-in user the way Supabase presents one (role `authenticated`, the JWT subject in
-- request.jwt.claims), so row-level security, guards and grants decide. A failed check raises
-- 'STAGING CONTRACT FAILED: <check>: <detail>' and stops the run; a passing run returns one row per check.
--
--   tenant isolation · inherited Helm visibility · sensitivity propagation · words at their ceiling · append-only history ·
--   impersonation prevention · idempotency · authority enforced in the database · Forge outcome publication ·
--   Helm's governed intake

CREATE TEMP TABLE IF NOT EXISTS forge_staging_results (n serial, contract text, detail text);
TRUNCATE forge_staging_results;
GRANT ALL ON forge_staging_results TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE forge_staging_results_n_seq TO authenticated;

DO $staging$
DECLARE
  gm uuid := gen_random_uuid();       -- Country GM: org admin
  cd uuid := gen_random_uuid();       -- Commercial Director: manager, decision shared with Commercial, not cleared
  scm uuid := gen_random_uuid();      -- Supply Chain: member, decision not shared
  outsider uuid := gen_random_uuid(); -- admin of another organization
  org_a uuid := gen_random_uuid();
  org_b uuid := gen_random_uuid();
  unit_com uuid := gen_random_uuid();
  dec uuid; rev uuid; alt uuid; snap uuid; cmt uuid; node uuid; review uuid; receipt uuid;
  run text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  fc text := 'fs_' || run;            -- the Forge commitment
  n int;
  refused boolean;
  dfp text := 'dfp_' || substr(md5(run), 1, 16) || '_1';
  fop text := 'fop_' || substr(md5(run || 'p'), 1, 16);
  fep text := 'fep_' || substr(md5(run || 'e'), 1, 16);
  margin_fact jsonb;
  terms jsonb := jsonb_build_object('statement', 'Serve customer R in Q4 (SYNTHETIC)', 'intendedOutcome', 'Customer R is served in full.', 'why', 'Helm decided it.',
    'owner', jsonb_build_object('kind', 'ROLE', 'label', 'Country GM (SYNTHETIC)', 'ref', null), 'principal', jsonb_build_object('kind', 'ROLE', 'label', 'Country GM (SYNTHETIC)', 'ref', null),
    'dueBy', '2026-12-31', 'evidence', '[]'::jsonb, 'measures', '[]'::jsonb, 'value', '[]'::jsonb);
BEGIN
  -- ------------------------------------------------------------ the act-as helper
  -- (inline: set the JWT subject both ways Supabase reads it, then become `authenticated`; 'none' returns to the owner)

  -- --------------------------------------------------------------------- seed
  INSERT INTO auth.users (id, email) VALUES (gm, run || '-gm@synthetic.invalid'), (cd, run || '-cd@synthetic.invalid'), (scm, run || '-scm@synthetic.invalid'), (outsider, run || '-out@synthetic.invalid');
  INSERT INTO public.organizations (id, name, created_by) VALUES (org_a, 'Meridian SYNTHETIC ' || run, gm), (org_b, 'Elsewhere SYNTHETIC ' || run, outsider);
  INSERT INTO public.organization_memberships (org_id, user_id, role) VALUES (org_a, gm, 'admin'), (org_a, cd, 'manager'), (org_a, scm, 'member'), (org_b, outsider, 'admin');
  INSERT INTO public.org_units (id, org_id, name, unit_type) VALUES (unit_com, org_a, 'Commercial SYNTHETIC', 'department');
  INSERT INTO public.org_unit_memberships (unit_id, org_id, user_id) VALUES (unit_com, org_a, cd);
  INSERT INTO public.helm_decisions (org_id, title, management_question, kernel_state, trigger_type, effective_as_of, recorded_through, observation_policy, created_by)
    VALUES (org_a, 'Q4 allocation (SYNTHETIC)', 'How do we serve customer R this quarter?', 'DRAFT', 'MANUAL', now() - interval '1 day', now() - interval '1 day', 'SOURCE_TRUTH', gm) RETURNING id INTO dec;
  INSERT INTO public.helm_decision_revisions (org_id, decision_id, revision_number, reason, effective_as_of, recorded_through, observation_policy, created_by)
    VALUES (org_a, dec, 1, 'OPENED', now() - interval '1 day', now() - interval '1 day', 'SOURCE_TRUTH', gm) RETURNING id INTO rev;
  INSERT INTO public.helm_decision_alternatives (org_id, decision_id, revision_id, name, status, unmodelled_reason) VALUES (org_a, dec, rev, 'Reallocate (SYNTHETIC)', 'UNMODELLED', 'Synthetic staging data.') RETURNING id INTO alt;
  INSERT INTO public.helm_decision_commitment_snapshots (org_id, decision_id, revision_id, effective_as_of, recorded_through, observation_policy, fingerprint)
    VALUES (org_a, dec, rev, now() - interval '1 day', now() - interval '1 day', 'SOURCE_TRUTH', 'dsn_' || substr(md5(run), 1, 16) || '_1') RETURNING id INTO snap;
  INSERT INTO public.helm_value_nodes (org_id, metric_id, scope_kind, scope_ref, time_horizon, label) VALUES (org_a, 'vm_grossmarginpct', 'customer', 'synthetic-' || run, 'quarter', 'Gross margin % (SYNTHETIC)') RETURNING id INTO node;
  INSERT INTO public.helm_decision_commitments (org_id, decision_id, revision_id, chosen_alternative_id, authorship, committed_by, committed_by_label, committed_at, summary, rationale, expected_outcomes, fingerprint, snapshot_id)
    VALUES (org_a, dec, rev, alt, 'MANAGEMENT_AUTHORED', gm, 'Country GM (SYNTHETIC)', now() - interval '1 day', 'Reallocate stock (SYNTHETIC).',
      jsonb_build_array(jsonb_build_object('kind', 'JUDGEMENT', 'ref', null, 'label', 'Because', 'statement', 'Synthetic.')),
      jsonb_build_array(jsonb_build_object('label', 'Gross margin %', 'kind', 'MODELLED', 'nodeId', node, 'metricKey', 'GrossMarginPct', 'period', jsonb_build_object('start', '2026-10-01T00:00:00.000Z', 'end', '2027-01-01T00:00:00.000Z', 'grain', 'QUARTER'), 'expectedValue', '32.3878', 'unit', 'percentage', 'currency', null, 'statement', null)),
      dfp, snap) RETURNING id INTO cmt;
  INSERT INTO public.helm_decision_visibility (org_id, decision_id, org_unit_id, org_unit_label, reason, granted_by) VALUES (org_a, dec, unit_com, 'Commercial SYNTHETIC', 'Commercial executes it (synthetic).', gm);

  -- ----------------------------------------------- 1. inherited Helm visibility
  PERFORM set_config('request.jwt.claim.sub', gm::text, true); PERFORM set_config('request.jwt.claims', json_build_object('sub', gm, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
  INSERT INTO public.forge_commitments (id, org_id, origin_kind, origin_system, origin_ref, origin, terms, capture, proposed_by, proposed_at, fingerprint)
    VALUES (fc, org_a, 'DECISION', 'helm', 'helm:decision-commitment:' || cmt, jsonb_build_object('kind', 'DECISION', 'system', 'helm', 'ref', 'helm:decision-commitment:' || cmt, 'label', 'Q4 allocation (SYNTHETIC)', 'fingerprint', dfp, 'snapshot', null),
      terms, '{}'::jsonb, jsonb_build_object('kind', 'PERSON', 'id', gm, 'label', 'Country GM (SYNTHETIC)'), now(), 'cfp_' || substr(md5(run), 1, 16));
  SELECT count(*) INTO n FROM public.forge_commitments WHERE id = fc AND helm_decision_id = dec;
  IF n <> 1 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: visibility: the Helm decision was not derived onto the commitment'; END IF;
  refused := false;
  BEGIN
    INSERT INTO public.forge_commitments (id, org_id, origin_kind, origin_system, origin_ref, origin, terms, capture, proposed_by, proposed_at, fingerprint)
      VALUES (fc || '_forged', org_a, 'DECISION', 'helm', 'helm:decision-commitment:' || gen_random_uuid(), '{"kind":"DECISION"}'::jsonb, terms, '{}'::jsonb, jsonb_build_object('kind', 'PERSON', 'id', gm, 'label', 'GM'), now(), 'cfp_' || substr(md5(run || 'f'), 1, 16));
  EXCEPTION WHEN others THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: visibility: a commitment claimed a Helm origin that does not exist'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', scm::text, true); PERFORM set_config('request.jwt.claims', json_build_object('sub', scm, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.forge_commitments WHERE id = fc;
  IF n <> 0 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: visibility: a member Helm does not show the decision to reads its Forge commitment'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', cd::text, true); PERFORM set_config('request.jwt.claims', json_build_object('sub', cd, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.forge_commitments WHERE id = fc;
  IF n <> 1 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: visibility: a member of the unit Helm shared the decision with cannot read its Forge commitment'; END IF;
  RESET ROLE;
  INSERT INTO forge_staging_results (contract, detail) VALUES ('inherited Helm visibility', 'derived from Helm; hidden from an unshared member; visible to the shared unit; a missing Helm origin refused');

  -- ---------------------------------------------------------- 2. tenant isolation
  PERFORM set_config('request.jwt.claim.sub', outsider::text, true); PERFORM set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.forge_commitments WHERE org_id = org_a;
  IF n <> 0 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: tenancy: another organization reads Forge commitments'; END IF;
  SELECT count(*) INTO n FROM public.helm_decisions WHERE org_id = org_a;
  IF n <> 0 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: tenancy: another organization reads Helm decisions'; END IF;
  refused := false;
  BEGIN
    INSERT INTO public.forge_commitment_events (id, org_id, commitment_id, event_type, effective_at, actor, payload)
      VALUES ('fe_' || run || '_x', org_a, fc, 'ACCEPTED', now(), jsonb_build_object('kind', 'PERSON', 'id', outsider, 'label', 'Outsider'), '{}'::jsonb);
  EXCEPTION WHEN others THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: tenancy: another organization wrote an event'; END IF;
  RESET ROLE;
  INSERT INTO forge_staging_results (contract, detail) VALUES ('tenant isolation', 'another organization reads none of it and writes nothing into it');

  -- ------------------------------------------ 3. impersonation · 4. idempotency
  PERFORM set_config('request.jwt.claim.sub', gm::text, true); PERFORM set_config('request.jwt.claims', json_build_object('sub', gm, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
  refused := false;
  BEGIN
    INSERT INTO public.forge_commitment_events (id, org_id, commitment_id, event_type, effective_at, actor, payload)
      VALUES ('fe_' || run || '_imp', org_a, fc, 'ACCEPTED', now(), jsonb_build_object('kind', 'PERSON', 'id', scm, 'label', 'Supply Chain'), '{}'::jsonb);
  EXCEPTION WHEN others THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: impersonation: an event was written in another person''s name'; END IF;
  refused := false;
  BEGIN
    INSERT INTO public.forge_commitment_events (id, org_id, commitment_id, event_type, effective_at, actor, payload)
      VALUES ('fe_' || run || '_sys', org_a, fc, 'EVIDENCE_RECORDED', now(), jsonb_build_object('kind', 'SYSTEM', 'id', 'helm-connector', 'label', 'helm connector'),
        jsonb_build_object('evidence', jsonb_build_object('id', 'ev0', 'channel', 'SYSTEM_EVENT', 'epistemic', 'FACT', 'confidence', null, 'statement', 'x')));
  EXCEPTION WHEN others THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: impersonation: a client recorded a connector''s system event'; END IF;
  INSERT INTO public.forge_commitment_events (id, org_id, commitment_id, event_type, effective_at, actor, idempotency_key, payload)
    VALUES ('fe_' || run || '_acc', org_a, fc, 'ACCEPTED', now(), jsonb_build_object('kind', 'PERSON', 'id', gm, 'label', 'Country GM (SYNTHETIC)'), 'accept:' || run,
      jsonb_build_object('party', terms->'owner', 'confirmed', '[]'::jsonb, 'evidence', null));
  refused := false;
  BEGIN
    INSERT INTO public.forge_commitment_events (id, org_id, commitment_id, event_type, effective_at, actor, idempotency_key, payload)
      VALUES ('fe_' || run || '_acc2', org_a, fc, 'ACCEPTED', now(), jsonb_build_object('kind', 'PERSON', 'id', gm, 'label', 'Country GM (SYNTHETIC)'), 'accept:' || run, '{}'::jsonb);
  EXCEPTION WHEN unique_violation THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: idempotency: the same idempotency key was recorded twice'; END IF;
  RESET ROLE;
  INSERT INTO forge_staging_results (contract, detail) VALUES ('impersonation prevention', 'no event in another person''s name; no client-written system event');
  INSERT INTO forge_staging_results (contract, detail) VALUES ('idempotency', 'one event per idempotency key and organization');

  -- -------------------------------------------------------- 5. append-only history
  refused := false;
  BEGIN UPDATE public.forge_commitment_events SET reason = 'rewritten' WHERE id = 'fe_' || run || '_acc'; EXCEPTION WHEN others THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: append-only: the owner rewrote an event'; END IF;
  refused := false;
  BEGIN DELETE FROM public.forge_commitments WHERE id = fc; EXCEPTION WHEN others THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: append-only: the owner deleted a commitment'; END IF;
  INSERT INTO forge_staging_results (contract, detail) VALUES ('append-only history', 'not even the database owner rewrites or deletes it');

  -- ------------------------------------------------- 6. sensitivity propagation
  PERFORM set_config('request.jwt.claim.sub', gm::text, true); PERFORM set_config('request.jwt.claims', json_build_object('sub', gm, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
  INSERT INTO public.forge_commitment_events (id, org_id, commitment_id, event_type, effective_at, actor, payload, protection, sealed)
    VALUES ('fe_' || run || '_ev', org_a, fc, 'EVIDENCE_RECORDED', now(), jsonb_build_object('kind', 'PERSON', 'id', gm, 'label', 'Country GM (SYNTHETIC)'),
      jsonb_build_object('evidence', jsonb_build_object('id', 'ev1', 'requirementKey', 'actual-grossmarginpct', 'stance', 'SUPPORTS', 'epistemic', 'FACT', 'channel', 'DOCUMENT',
        'source', jsonb_build_object('system', 'helm', 'ref', 'helm:value-node:' || node, 'url', null), 'statement', 'Withheld: this evidence carries financially sensitive values, shown only to people cleared for them.',
        'observedAt', now(), 'confidence', null, 'observationId', null, 'protection', jsonb_build_array('FINANCIAL_SENSITIVE'), 'withheld', jsonb_build_array('FINANCIAL_SENSITIVE'))),
      '["FINANCIAL_SENSITIVE"]'::jsonb, jsonb_build_object('statement', 'Gross margin %: actual 31.421 (SYNTHETIC)'));
  refused := false;
  BEGIN
    INSERT INTO public.forge_commitment_events (id, org_id, commitment_id, event_type, effective_at, actor, payload, protection)
      VALUES ('fe_' || run || '_unsealed', org_a, fc, 'EVIDENCE_RECORDED', now(), jsonb_build_object('kind', 'PERSON', 'id', gm, 'label', 'GM'),
        jsonb_build_object('evidence', jsonb_build_object('id', 'ev2', 'epistemic', 'FACT', 'channel', 'DOCUMENT', 'confidence', null, 'statement', 'actual 31.421')), '["FINANCIAL_SENSITIVE"]'::jsonb);
  EXCEPTION WHEN others THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: sensitivity: a protected event was stored without sealing its values'; END IF;
  SELECT count(*) INTO n FROM public.forge_sealed_values WHERE event_id = 'fe_' || run || '_ev';
  IF n <> 1 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: sensitivity: a cleared reader (org admin) cannot read the sealed value'; END IF;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.forge_commitment_events WHERE id = 'fe_' || run || '_ev' AND (sealed IS NOT NULL OR payload::text LIKE '%31.421%');
  IF n <> 0 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: sensitivity: the protected value stayed on the event row'; END IF;
  PERFORM set_config('request.jwt.claim.sub', cd::text, true); PERFORM set_config('request.jwt.claims', json_build_object('sub', cd, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.forge_commitment_events WHERE id = 'fe_' || run || '_ev';
  IF n <> 1 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: sensitivity: an uncleared reader of the commitment cannot see that the evidence exists'; END IF;
  SELECT count(*) INTO n FROM public.forge_sealed_values WHERE event_id = 'fe_' || run || '_ev';
  IF n <> 0 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: sensitivity: a reader without Helm clearance read the sealed value'; END IF;
  RESET ROLE;
  INSERT INTO forge_staging_results (contract, detail) VALUES ('sensitivity propagation (Forge)', 'sealed off the row; existence visible, value only under Helm''s clearance; unsealed protected events refused');

  -- ------------------------------------------------- 6b. words at their ceiling
  -- The commitment now rests on a financially sensitive value; a reason written on it carries that class.
  PERFORM set_config('request.jwt.claim.sub', gm::text, true); PERFORM set_config('request.jwt.claims', json_build_object('sub', gm, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
  refused := false;
  BEGIN
    INSERT INTO public.forge_commitment_events (id, org_id, commitment_id, event_type, effective_at, actor, reason, payload)
      VALUES ('fe_' || run || '_lowered', org_a, fc, 'CONTEXT_REAFFIRMED', now(), jsonb_build_object('kind', 'PERSON', 'id', gm, 'label', 'GM'),
        'Margin at 31.421 still carries it (SYNTHETIC).', jsonb_build_object('contextEventId', 'none'));
  EXCEPTION WHEN others THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: words: a reason was stored below the ceiling of the commitment it was written on'; END IF;
  INSERT INTO public.forge_commitment_events (id, org_id, commitment_id, event_type, effective_at, actor, reason, payload, protection, text_protection, sealed)
    VALUES ('fe_' || run || '_said', org_a, fc, 'CONTEXT_REAFFIRMED', now(), jsonb_build_object('kind', 'PERSON', 'id', gm, 'label', 'Country GM (SYNTHETIC)'),
      'Withheld: written on a commitment that rests on financially sensitive values, and shown only to people cleared for them.', jsonb_build_object('contextEventId', 'none'),
      '["FINANCIAL_SENSITIVE"]'::jsonb, '["FINANCIAL_SENSITIVE"]'::jsonb, jsonb_build_object('text', jsonb_build_object('reason', 'Margin at 31.421 still carries it (SYNTHETIC).')));
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', cd::text, true); PERFORM set_config('request.jwt.claims', json_build_object('sub', cd, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.forge_commitment_events WHERE id = 'fe_' || run || '_said' AND reason NOT LIKE '%31.421%';
  IF n <> 1 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: words: an uncleared reader cannot see that a reason was given, or read the words'; END IF;
  SELECT count(*) INTO n FROM public.forge_sealed_values WHERE event_id = 'fe_' || run || '_said';
  IF n <> 0 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: words: a reader without Helm clearance read a sealed reason'; END IF;
  RESET ROLE;
  INSERT INTO forge_staging_results (contract, detail) VALUES ('words at their ceiling', 'a reason below its commitment''s ceiling refused; at it, sealed and read only under Helm''s clearance');

  -- ----------------------------------------- 7. outcome publication · authority
  PERFORM set_config('request.jwt.claim.sub', gm::text, true); PERFORM set_config('request.jwt.claims', json_build_object('sub', gm, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
  refused := false;
  BEGIN
    INSERT INTO public.forge_commitment_events (id, org_id, commitment_id, event_type, effective_at, actor, payload)
      VALUES ('fe_' || run || '_badpub', org_a, fc, 'OUTCOME_PUBLISHED', now(), jsonb_build_object('kind', 'PERSON', 'id', gm, 'label', 'GM'), jsonb_build_object('publication', jsonb_build_object('fingerprint', 'unsigned')));
  EXCEPTION WHEN others THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: publication: an unfingerprinted publication was recorded'; END IF;
  INSERT INTO public.forge_commitment_events (id, org_id, commitment_id, event_type, effective_at, actor, payload, protection, sealed)
    VALUES ('fe_' || run || '_pub', org_a, fc, 'OUTCOME_PUBLISHED', now(), jsonb_build_object('kind', 'PERSON', 'id', gm, 'label', 'Country GM (SYNTHETIC)'),
      jsonb_build_object('publication', jsonb_build_object('fingerprint', fop, 'outcome', 'Withheld: this outcome carries financially sensitive values, shown only to people cleared for them.', 'measures', '[]'::jsonb, 'realizedValue', '[]'::jsonb, 'protection', jsonb_build_array('FINANCIAL_SENSITIVE'), 'withheld', jsonb_build_array('FINANCIAL_SENSITIVE'))),
      '["FINANCIAL_SENSITIVE"]'::jsonb, jsonb_build_object('outcome', 'Margin landed at 31.421% (SYNTHETIC).', 'realizedValue', '[]'::jsonb, 'measures', '[]'::jsonb));
  RESET ROLE;
  INSERT INTO forge_staging_results (contract, detail) VALUES ('Forge outcome publication', 'only a person, only fingerprinted, and sealed like the facts it carries');

  -- ------------------------------------------------ 8. Helm's governed intake
  margin_fact := jsonb_build_object('contract', 'helm.contextual-fact.v1', 'value', '31.421', 'statement', null, 'unit', 'percentage', 'currency', null,
    'entity', jsonb_build_object('ref', 'helm:value-node:' || node || '@2026-10-01T00:00:00.000Z', 'label', 'Gross margin %'), 'metric', jsonb_build_object('key', 'GrossMarginPct', 'label', 'Gross margin %'),
    'period', jsonb_build_object('start', '2026-10-01T00:00:00.000Z', 'end', null), 'observedAt', '2026-10-24', 'source', jsonb_build_object('system', 'helm', 'ref', 'helm:value-node:' || node),
    'provenance', jsonb_build_object('basis', 'SYSTEM_RECORD', 'via', jsonb_build_array('helm'), 'fingerprint', fop), 'epistemic', 'FACT', 'sensitivity', jsonb_build_array('FINANCIAL_SENSITIVE'),
    'scope', jsonb_build_object('orgId', org_a, 'decisionId', null), 'authority', null);
  PERFORM set_config('request.jwt.claim.sub', gm::text, true); PERFORM set_config('request.jwt.claims', json_build_object('sub', gm, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
  refused := false;
  BEGIN
    INSERT INTO public.helm_execution_outcomes (org_id, decision_id, commitment_id, source_system, contract, publication_fingerprint, publication, episode_ref, episode_fingerprint, commitment_fingerprint, resolution, closed_at, facts, narrative, sensitivity_classes, submitted_by, submitted_by_label)
      VALUES (org_a, dec, cmt, 'forge', 'helm.execution-outcome.v1', fop, '{}'::jsonb, 'forge:commitment:' || fc, fep, dfp, 'PARTIALLY_FULFILLED', now(),
        jsonb_build_array(margin_fact || jsonb_build_object('sensitivity', '[]'::jsonb)), jsonb_build_object('outcome', 'x', 'sensitivity', '[]'::jsonb), ARRAY[]::text[], gm, 'GM');
  EXCEPTION WHEN others THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: intake: Helm received a margin fact without its class'; END IF;
  INSERT INTO public.helm_execution_outcomes (org_id, decision_id, commitment_id, source_system, contract, publication_fingerprint, publication, episode_ref, episode_fingerprint, commitment_fingerprint, resolution, closed_at, facts, narrative, sensitivity_classes, submitted_by, submitted_by_label)
    VALUES (org_a, dec, cmt, 'forge', 'helm.execution-outcome.v1', fop, jsonb_build_object('fingerprint', fop), 'forge:commitment:' || fc, fep, dfp, 'PARTIALLY_FULFILLED', now(),
      jsonb_build_array(margin_fact), jsonb_build_object('outcome', 'Margin landed below plan (SYNTHETIC).', 'sensitivity', jsonb_build_array('FINANCIAL_SENSITIVE')), ARRAY['FINANCIAL_SENSITIVE'], gm, 'Country GM (SYNTHETIC)')
    RETURNING id INTO receipt;
  INSERT INTO public.helm_decision_outcome_reviews (org_id, decision_id, commitment_id, reviewed_at, reviewed_by_label, variances, assumption_results, notes, statement)
    VALUES (org_a, dec, cmt, now(), 'Country GM (SYNTHETIC)', jsonb_build_array(jsonb_build_object('label', 'Gross margin %', 'metricKey', 'GrossMarginPct', 'nodeId', node, 'expected', '32.3878', 'actual', '31.421', 'variance', '-0.9668', 'unit', 'percentage', 'currency', null, 'note', null)),
      '[]'::jsonb, 'Adopted from Forge ' || fop, 'Expected against actual (SYNTHETIC).') RETURNING id INTO review;
  INSERT INTO public.helm_execution_outcome_adoptions (org_id, receipt_id, decision_id, review_id, adopted_by, adopted_by_label) VALUES (org_a, receipt, dec, review, gm, 'Country GM (SYNTHETIC)');
  refused := false;
  BEGIN
    INSERT INTO public.helm_execution_outcome_adoptions (org_id, receipt_id, decision_id, review_id, adopted_by, adopted_by_label) VALUES (org_a, receipt, dec, review, gm, 'again');
  EXCEPTION WHEN others THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: intake: an outcome was adopted twice'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', cd::text, true); PERFORM set_config('request.jwt.claims', json_build_object('sub', cd, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.helm_execution_outcomes WHERE id = receipt;
  IF n <> 0 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: intake: an uncleared reader of the decision read the receipt'; END IF;
  SELECT count(*) INTO n FROM public.helm_decision_outcome_reviews WHERE id = review;
  IF n <> 0 THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: intake: an uncleared reader of the decision read the outcome review'; END IF;
  refused := false;
  BEGIN
    INSERT INTO public.helm_execution_outcome_adoptions (org_id, receipt_id, decision_id, review_id, adopted_by, adopted_by_label) VALUES (org_a, receipt, dec, review, gm, 'not me');
  EXCEPTION WHEN others THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'STAGING CONTRACT FAILED: authority: an adoption was recorded in another person''s name'; END IF;
  RESET ROLE;
  INSERT INTO forge_staging_results (contract, detail) VALUES ('Helm governed intake', 'a lowered class refused; received, adopted once, as oneself; receipt and review only under clearance');
  INSERT INTO forge_staging_results (contract, detail) VALUES ('authority in the database', 'person-only publication; adoption only in one''s own name by a manager');
END
$staging$;

SELECT contract, detail FROM forge_staging_results ORDER BY n;
