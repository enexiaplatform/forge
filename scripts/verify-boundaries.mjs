#!/usr/bin/env node
/**
 * verify:boundaries — the lines Forge does not cross, as code.
 *
 *  1. Forge never writes a Helm or a Memoire table. It reads them; it publishes
 *     events Helm reads back. No insert/update/upsert/delete against helm_* or
 *     Memoire's tables anywhere, and no SQL that alters or drops them.
 *  2. Layers point one way: kernel ← fabric ← demo ← app, and kernel ← fabric ←
 *     server. The kernel imports no other package and no framework; the fabric
 *     never imports the demo or the app; packages never import the app; nothing
 *     the browser loads imports the server.
 *  3. The kernel is pure: no ambient clock, no randomness, no network, no
 *     storage. Time and ids arrive through ports.
 *  4. Permanent absences: no stored percent-complete or progress, no health or
 *     performance score of a person, and no score, rank, rating, league table
 *     or percentile in execution records.
 *  5. A language model lives on the server only: the Anthropic SDK is imported
 *     under server/ and nowhere else, and no other model SDK is a dependency.
 *
 * The integration suite (integration/) is not scanned: there Helm's and
 * Memoire's own code writes their own tables, which is the point of it.
 *
 * Exits non-zero, naming each violation, if any line is crossed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const violations = [];
const fail = (rule, file, detail) => violations.push(`${rule} — ${relative(root, file)}: ${detail}`);

function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const code = [...walk(join(root, 'packages'), ['.ts', '.tsx']), ...walk(join(root, 'src'), ['.ts', '.tsx']), ...walk(join(root, 'server'), ['.ts'])].filter(
  (f) => !f.includes(`${'test'}${'/'}`) && !/[\\/]test[\\/]/.test(f),
);
const sql = walk(join(root, 'supabase', 'migrations'), ['.sql']);
// Contract scripts for an isolated staging project seed Helm's tables with synthetic rows on purpose; they are never
// migrations, and each must say it touches synthetic data only.
for (const f of walk(join(root, 'supabase', 'tests'), ['.sql'])) {
  if (!/SYNTHETIC data only/.test(readFileSync(f, 'utf8'))) violations.push(`synthetic-seeds-only — ${relative(root, f)}: a staging contract script that does not declare synthetic data only`);
}
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ------------------------------------------------ 1. never write Helm or Memoire
const MEMOIRE_TABLES = ['accounts', 'opportunities', 'stakeholders', 'commercial_events', 'commercial_commitments', 'commercial_threads', 'commercial_value_outcomes'];
const foreign = (t) => t.startsWith('helm_') || MEMOIRE_TABLES.includes(t) || ['organizations', 'organization_memberships', 'org_units', 'org_unit_memberships'].includes(t);
for (const f of code) {
  const s = strip(readFileSync(f, 'utf8'));
  for (const m of s.matchAll(/\.from\(\s*['"`]([a-z_]+)['"`]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/g)) {
    if (foreign(m[1])) fail('never-write-the-ecosystem', f, `.from('${m[1]}').${m[2]}()`);
  }
  for (const m of s.matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?"?([a-z_]+)"?/gi)) {
    if (foreign(m[2].toLowerCase())) fail('never-write-the-ecosystem', f, `${m[1]} ${m[2]}`);
  }
}
for (const f of sql) {
  // Statement by statement, function bodies set aside: a trigger declared BEFORE UPDATE is not an UPDATE.
  const s = strip(readFileSync(f, 'utf8').replace(/--.*$/gm, '')).replace(/\$\$[\s\S]*?\$\$/g, '$$$$');
  for (const statement of s.split(';')) {
    const m = /^\s*(ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-z_]+)"?/i.exec(statement);
    if (m && !m[2].toLowerCase().startsWith('forge_')) fail('migrations-touch-forge-only', f, `${m[1]} ${m[2]}`);
  }
}

// --------------------------------------------------------- 2. one-way layers
const layerOf = (f) => {
  const r = relative(root, f).replace(/\\/g, '/');
  if (r.startsWith('packages/kernel/')) return 'kernel';
  if (r.startsWith('packages/fabric/')) return 'fabric';
  if (r.startsWith('packages/demo/')) return 'demo';
  if (r.startsWith('server/')) return 'server';
  return 'app';
};
const allowed = {
  kernel: [],
  fabric: ['@forge/kernel'],
  demo: ['@forge/kernel', '@forge/fabric'],
  server: ['@forge/kernel', '@forge/fabric'],
};
const SERVER_DEPENDENCIES = ['@anthropic-ai/sdk'];
for (const f of code) {
  const layer = layerOf(f);
  const s = readFileSync(f, 'utf8');
  if (layer === 'app') {
    for (const m of s.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      if (/(^|\/)server\//.test(m[1])) fail('the-browser-never-loads-the-server', f, `imports ${m[1]}`);
    }
    continue;
  }
  for (const m of s.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    if (layer === 'server' && (spec.startsWith('node:') || SERVER_DEPENDENCIES.includes(spec))) continue;
    if (spec.startsWith('.')) {
      if (/\.\.\/\.\.\/(src|packages)\b/.test(spec) || spec.includes('/src/') && !spec.startsWith('./')) fail('layers-point-one-way', f, `relative import out of its package: ${spec}`);
      continue;
    }
    if (spec.startsWith('@forge/')) {
      const base = spec.split('/').slice(0, 2).join('/');
      if (!allowed[layer].includes(base)) fail('layers-point-one-way', f, `${layer} imports ${spec}`);
      continue;
    }
    fail('packages-have-no-dependencies', f, `${layer} imports ${spec}`);
  }
}

// ------------------------------------------------------------ 3. pure kernel
for (const f of code.filter((x) => layerOf(x) === 'kernel' && !x.endsWith('postgres.ts'))) {
  const s = strip(readFileSync(f, 'utf8'));
  const checks = [
    [/Date\.now\s*\(/, 'Date.now()'],
    [/new Date\(\s*\)/, 'new Date() without an instant'],
    [/Math\.random\s*\(/, 'Math.random()'],
    [/\bcrypto\./, 'crypto'],
    [/\bfetch\s*\(/, 'fetch()'],
    [/\b(localStorage|sessionStorage|indexedDB)\b/, 'browser storage'],
  ];
  for (const [re, what] of checks) if (re.test(s)) fail('kernel-is-pure', f, what);
}

// ---------------------------------------------------- 4. permanent absences
for (const f of code) {
  const s = strip(readFileSync(f, 'utf8'));
  if (/\b(percent_?complete|percentComplete|progressPct|progressPercent|completionPct)\b/i.test(s)) fail('no-self-reported-progress', f, 'a percent-complete field');
  if (/\b(healthScore|performanceScore|personScore|reliabilityScore|ownerRating)\b/.test(s)) fail('no-score-of-a-person', f, 'a score or rating');
  if (/from\s+['"](openai|@google\/generative-ai|langchain)/.test(s)) fail('one-model-sdk-on-the-server', f, 'another language-model SDK');
  if (/from\s+['"]@anthropic-ai\/sdk/.test(s) && layerOf(f) !== 'server') fail('one-model-sdk-on-the-server', f, 'the Anthropic SDK outside server/');
}

// Execution records are observed facts: nothing in them, or in how they are shown, is a score, a rank or a rating.
// Decision fidelity is a record of the same kind: departures, never a fidelity score or rate.
// Precedents are records of the same kind: what resembles a commitment, ordered by time, never by likeness or ending.
const RECORD_FILES = code.filter(
  (f) =>
    /packages[\\/]kernel[\\/]src[\\/]records\.ts$/.test(f) ||
    /src[\\/]components[\\/]records[\\/]/.test(f) ||
    /packages[\\/]fabric[\\/]src[\\/]fidelity\.ts$/.test(f) ||
    /packages[\\/]kernel[\\/]src[\\/]precedents\.ts$/.test(f) ||
    /src[\\/]components[\\/]commitment[\\/]Precedents\.tsx$/.test(f) ||
    /src[\\/]components[\\/]commitment[\\/]Fidelity\.tsx$/.test(f),
);
if (RECORD_FILES.length === 0) fail('records-are-not-scores', root, 'the records code was not found to check');
if (!RECORD_FILES.some((f) => /fidelity\.ts$/.test(f))) fail('records-are-not-scores', root, 'the decision fidelity code was not found to check');
for (const f of RECORD_FILES) {
  const s = strip(readFileSync(f, 'utf8'));
  const m = /\b(\w*(?:score|Score|rank|Rank|rating|Rating|leaderboard|Leaderboard|leagueTable|percentile|Percentile)\w*)\s*[:=(]/.exec(s);
  if (m) fail('records-are-not-scores', f, m[1]);
  if (/\.sort\([^)]*(?:concluded|onOrBefore|after|median|endings)/.test(s)) fail('records-are-not-scores', f, 'parties ordered by an outcome');
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
  if (/^(openai|langchain|@google\/generative-ai)$/.test(dep)) fail('one-model-sdk-on-the-server', join(root, 'package.json'), dep);
}

if (violations.length > 0) {
  console.error(`verify:boundaries — ${violations.length} violation(s):`);
  for (const v of violations) console.error(`  ✖ ${v}`);
  process.exit(1);
}
console.log(
  `verify:boundaries — ${code.length} source files, ${sql.length} migration(s): Forge writes only forge_* tables, layers point one way, the kernel is pure, the model stays on the server, records hold no scores, and the permanent absences hold.`,
);
