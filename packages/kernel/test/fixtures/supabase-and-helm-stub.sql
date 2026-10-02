-- What the Forge migration expects to find in the shared Supabase project, and
-- nothing more — so PGlite can apply the real migration in tests.
--
-- Supabase: the authenticated / anon / service_role roles, auth.users,
-- auth.uid() reading the JWT subject, and Supabase's default privileges (which
-- grant everything on new public tables to anon and authenticated — the reason
-- the Forge migration revokes before it grants).
--
-- Helm: the organization layer, mirroring 20260808090000_helm_foundation.sql
-- (organizations, organization_memberships, is_org_member, org_role_rank,
-- has_org_role), reduced to the columns Forge's policies read.

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id)
);

CREATE TABLE public.organization_memberships (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'manager', 'member', 'viewer')),
  PRIMARY KEY (org_id, user_id)
);

CREATE FUNCTION public.is_org_member(check_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = check_org AND m.user_id = auth.uid());
$$;

CREATE FUNCTION public.org_role_rank(check_org uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE m.role WHEN 'admin' THEN 4 WHEN 'manager' THEN 3 WHEN 'member' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END
    FROM public.organization_memberships m WHERE m.org_id = check_org AND m.user_id = auth.uid()
  ), 0);
$$;

CREATE FUNCTION public.has_org_role(check_org uuid, min_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.org_role_rank(check_org) >= CASE min_role
    WHEN 'admin' THEN 4 WHEN 'manager' THEN 3 WHEN 'member' THEN 2 WHEN 'viewer' THEN 1 ELSE 5 END;
$$;

REVOKE ALL ON FUNCTION public.is_org_member(uuid), public.org_role_rank(uuid), public.has_org_role(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid), public.org_role_rank(uuid), public.has_org_role(uuid, text) TO authenticated, service_role;

-- Helm's clearance rule (helm_private.has_clearance, 20260929090000_helm_management_twin.sql), reduced:
-- general management needs none; org admins hold every class; others need a clearance row.
CREATE SCHEMA helm_private;
GRANT USAGE ON SCHEMA helm_private TO authenticated, service_role;
CREATE TABLE helm_private.stub_clearances (org_id uuid NOT NULL, user_id uuid NOT NULL, sensitivity text NOT NULL);
CREATE FUNCTION helm_private.has_clearance(p_org uuid, p_sensitivity text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(p_sensitivity, 'GENERAL_MANAGEMENT') = 'GENERAL_MANAGEMENT'
    OR public.has_org_role(p_org, 'admin')
    OR EXISTS (SELECT 1 FROM helm_private.stub_clearances c WHERE c.org_id = p_org AND c.user_id = auth.uid() AND c.sensitivity = p_sensitivity);
$$;
GRANT EXECUTE ON FUNCTION helm_private.has_clearance(uuid, text) TO authenticated, service_role;
