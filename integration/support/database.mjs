/**
 * One Postgres for the ecosystem: Supabase's baseline, then Helm's real
 * migrations, then Forge's — in the order the shared project receives them.
 * PGlite runs it in-process. Each test reads and writes as a signed-in user, so
 * Helm's and Forge's row-level security decide, exactly as they will in the
 * shared database.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { FORGE, HELM } from './siblings.mjs';

const sql = (dir) => readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(dir, f), 'utf8'));

/**
 * PostgREST returns dates as 'YYYY-MM-DD', instants as ISO strings and numerics as numbers. PGlite's defaults
 * differ, so the parsers below make every reader — Helm's adapter included — see what production gives it.
 */
export const POSTGREST_PARSERS = {
  1082: (v) => v, // date
  1114: (v) => new Date(`${v}Z`).toISOString(), // timestamp
  1184: (v) => new Date(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString(), // timestamptz
  1700: (v) => Number(v), // numeric
};

export async function ecosystemDatabase() {
  const db = await PGlite.create();
  await db.exec(readFileSync(new URL('../fixtures/supabase-stub.sql', import.meta.url), 'utf8'));
  for (const m of sql(join(HELM, 'supabase/migrations'))) await db.exec(m);
  for (const m of sql(join(FORGE, 'supabase/migrations'))) await db.exec(m);
  return db;
}

/** Run every statement as `role`, carrying `uid` as the JWT subject — how Supabase presents a signed-in user. */
export function runnerAs(db, role, uid) {
  return async (text, params = []) => {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ''}', false); SET ROLE ${role};`);
    try {
      return await db.query(text, params, { parsers: POSTGREST_PARSERS });
    } finally {
      await db.exec('RESET ROLE');
    }
  };
}

/** An organization in Helm's own org layer, with its members. */
export async function seedOrganization(db, { orgId, name, members }) {
  for (const m of members) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [m.uid]);
  await db.query('INSERT INTO public.organizations (id, name, created_by) VALUES ($1, $2, $3)', [orgId, name, members[0].uid]);
  for (const m of members) await db.query('INSERT INTO public.organization_memberships (org_id, user_id, role) VALUES ($1, $2, $3)', [orgId, m.uid, m.role]);
}
