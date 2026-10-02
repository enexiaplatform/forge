#!/usr/bin/env node
/**
 * verify:schema — what every Forge migration must keep, read from the SQL itself.
 *
 *  - Every table it creates is public.forge_*.
 *  - No table stores a status, score, rating, rank, progress or verdict: a
 *    commitment's state is derived from its record, never kept beside it.
 *  - Every forge table has row-level security, an append-only guard and a
 *    record-time stamp, and is revoked from anon.
 *  - No policy lets a client update or delete.
 *  - A column added later obeys the same rule as one created with its table.
 *  - Visibility never widens: as the migrations stand at the end, a commitment
 *    and its events are read and written only where Helm shows the decision
 *    they execute (forge_private.can_see_helm_decision).
 *  - Every SECURITY DEFINER function pins its search_path.
 *  - Sensitivity never lowers (ADR-0017): sealed values and protected
 *    observations are read only under Helm's clearance, and protected values
 *    are moved off the event row by the seal trigger.
 *
 * The behaviour behind these lines is proven on Postgres by
 * packages/kernel/test/postgres.test.mjs; this contract catches a migration
 * that quietly stops declaring them.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const violations = [];
const FORBIDDEN_COLUMNS = ['status', 'state', 'phase', 'score', 'rating', 'rank', 'progress', 'percent_complete', 'pct_complete', 'health', 'verdict', 'winner', 'priority'];

let tables = 0;
const finalPolicies = new Map();
for (const file of files) {
  const raw = readFileSync(join(dir, file), 'utf8');
  const sql = raw.replace(/--.*$/gm, '');

  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_."]+)\s*\(([\s\S]*?)\n\);/gi)) {
    tables += 1;
    const name = m[1].replace(/"/g, '');
    const table = name.replace(/^public\./, '');
    if (!/^public\.forge_[a-z_]+$/.test(name)) violations.push(`${file}: creates ${name} — Forge creates public.forge_* tables only`);
    const columns = m[2]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[a-z_]+\s/.test(l) && !/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)\b/i.test(l))
      .map((l) => l.split(/\s+/)[0]);
    for (const c of columns) if (FORBIDDEN_COLUMNS.includes(c)) violations.push(`${file}: ${table}.${c} — state is derived, never stored`);

    const has = (re) => re.test(sql);
    if (!has(new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'))) violations.push(`${file}: ${table} has no row-level security`);
    if (!has(new RegExp(`BEFORE\\s+UPDATE\\s+OR\\s+DELETE\\s+ON\\s+public\\.${table}\\s+FOR\\s+EACH\\s+ROW\\s+EXECUTE\\s+FUNCTION\\s+public\\.forge_guard_append_only`, 'i')))
      violations.push(`${file}: ${table} is not guarded append-only`);
    if (!has(new RegExp(`BEFORE\\s+INSERT\\s+ON\\s+public\\.${table}\\s+FOR\\s+EACH\\s+ROW\\s+EXECUTE\\s+FUNCTION\\s+public\\.forge_stamp_`, 'i')))
      violations.push(`${file}: ${table} does not have its record time stamped by the database`);
    if (!new RegExp(`REVOKE\\s+ALL\\s+ON\\s+[^;]*public\\.${table}\\b[^;]*FROM\\s+anon`, 'i').test(sql)) violations.push(`${file}: ${table} is not revoked from anon`);
    if (!/recorded_at\s+timestamptz/i.test(m[2])) violations.push(`${file}: ${table} has no recorded_at`);
  }

  for (const m of sql.matchAll(/CREATE\s+POLICY\s+(\w+)\s+ON\s+[\w.]+\s+FOR\s+(\w+)/gi)) {
    if (/^(UPDATE|DELETE|ALL)$/i.test(m[2])) violations.push(`${file}: policy ${m[1]} is FOR ${m[2]} — clients only read and append`);
  }
  for (const m of sql.matchAll(/CREATE\s+POLICY\s+(\w+)\s+ON\s+[\w.]+\s+([\s\S]*?);/gi)) finalPolicies.set(m[1], { file, body: m[2] });

  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_.]+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)/gi)) {
    if (FORBIDDEN_COLUMNS.includes(m[2])) violations.push(`${file}: ${m[1]}.${m[2]} — state is derived, never stored`);
  }

  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\([^)]*\)([\s\S]*?)\bAS\s+\$/gi)) {
    if (/SECURITY\s+DEFINER/i.test(m[2]) && !/SET\s+search_path/i.test(m[2])) violations.push(`${file}: ${m[1]} is SECURITY DEFINER without a pinned search_path`);
  }
  if (/GRANT\s+[^;]*\b(UPDATE|DELETE|TRUNCATE)\b[^;]*\bTO\s+(authenticated|anon)/i.test(sql)) violations.push(`${file}: grants UPDATE, DELETE or TRUNCATE to a client role`);
}

if (tables === 0) violations.push('no tables found — the contract would pass vacuously');

const CLEARED = /forge_private\.has_helm_clearance\s*\(\s*org_id\s*,\s*protection\s*\)/i;
const SEES_THE_DECISION = /forge_private\.can_see_helm_decision\s*\(\s*helm_decision_id\s*\)/i;
const SEES_THE_COMMITMENT = /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.forge_commitments\s+c\s+WHERE\s+c\.id\s*=\s*commitment_id\s*\)/i;
for (const [policy, rule] of [
  ['forge_commitments_read', SEES_THE_DECISION],
  ['forge_commitments_propose', SEES_THE_DECISION],
  ['forge_events_read', SEES_THE_COMMITMENT],
  ['forge_events_record', SEES_THE_COMMITMENT],
  ['forge_sealed_values_read', CLEARED],
  ['forge_observations_read', CLEARED],
]) {
  const p = finalPolicies.get(policy);
  if (!p) violations.push(`policy ${policy} is not defined`);
  else if (!rule.test(p.body)) violations.push(`${p.file}: policy ${policy} no longer limits it to those who may see the Helm decision or are cleared for what it carries`);
}
// ADR-0017: a protected event's values leave the event row in the same statement that writes it.
const all = files.map((f) => readFileSync(join(dir, f), 'utf8')).join(';\n');
const lastSealTrigger = [...all.matchAll(/(DROP|CREATE)\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?forge_events_seal\b[^;]*;/gi)].pop();
if (!lastSealTrigger || !/^CREATE/i.test(lastSealTrigger[1]) || !/BEFORE\s+INSERT\s+ON\s+public\.forge_commitment_events/i.test(lastSealTrigger[0])) {
  violations.push('forge_events_seal is not the last word on forge_commitment_events: protected values could stay on the event row');
}

if (violations.length > 0) {
  console.error(`verify:schema — ${violations.length} violation(s):`);
  for (const v of violations) console.error(`  ✖ ${v}`);
  process.exit(1);
}
console.log(
  `verify:schema — ${files.length} migration(s), ${tables} forge tables: namespaced, no stored state, row-level security, append-only, database record time, anon revoked, no client update or delete, Helm’s decision visibility inherited, Helm’s clearance enforced on protected values, definer functions pinned.`,
);
