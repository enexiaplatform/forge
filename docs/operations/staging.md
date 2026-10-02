# Staging — runbook

Progression (ADR-0013): Local → **isolated staging** → real Helm / Memoire / Forge integration → authority
completion → production. The shared project (`memories`, which holds Memoire's and Helm's production schemas) is
never touched by this runbook.

## Status (2026-10-01)

Not yet created. Supabase branching requires the Pro plan, and the organization's owner already has the maximum of
two active free projects (`memories`, `Bio-Wiki-Pro`). One of these unblocks it, and each is the owner's decision:

- upgrade the organization to Pro, then create branch `forge-staging` of `memories` ($0.01344/hour as quoted); or
- pause or upgrade one of the two free projects, then create project `forge-staging` ($0/month as quoted).

## Once a staging project exists

1. **Schemas, in order** (a fresh project; on a branch of `memories`, Helm's earlier migrations are already there —
   apply only what its history lacks):
   - Helm's `supabase/migrations/*.sql` in filename order, ending with `20261005090000_helm_execution_outcomes.sql`;
   - Forge's `supabase/migrations/*.sql` in filename order.
2. **Advisors.** Run Supabase's security and performance advisors; anything about `forge_*` or the new `helm_execution_*`
   tables is fixed before step 3.
3. **Contracts.** Execute `supabase/tests/staging-contracts.sql` as the project's `postgres` role. It seeds SYNTHETIC
   organizations and people with fresh ids every run, acts as signed-in users through `authenticated` and the JWT
   claims, and returns one row per contract:
   tenant isolation · inherited Helm visibility · impersonation prevention · idempotency · append-only history ·
   sensitivity propagation · Forge outcome publication · Helm's governed intake · authority in the database.
   A failure stops the run with `STAGING CONTRACT FAILED: <contract>: <detail>`.
   The same script is proven locally on every `npm run check` (`integration/staging-contracts.test.mjs`).
4. **Not covered by the SQL suite** — Supabase Auth and PostgREST themselves. To exercise them, run the integration
   loops against staging with a signed-in test session (as Helm's own Postgres suites do), which needs a staging URL,
   its publishable key and a test user's access token supplied by the owner.

Staging proves infrastructure integrity; it is not a place to grow product scope.
