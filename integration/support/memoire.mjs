/**
 * Memoire, run for real: its own migrations in a Postgres of its own (Memoire is
 * a separate product with its own database), its own Commercial API v1 handler,
 * its own SDK, its own revision triggers, delivery RPCs and webhook worker —
 * all imported read-only from the Memoire repository.
 *
 * Two things are stood in, and only these:
 *   - Supabase Auth's token check (`verify`): an access token maps to its user.
 *   - The network: the SDK's fetch is handed to the handler in-process, and the
 *     worker's `deliver` hands the signed request to Forge's receiver.
 *
 * Memoire's embedding columns use pgvector, which this PGlite does not ship.
 * They are off the commitments path, so `vector(n)` becomes `real[]` and the
 * ivfflat indexes are dropped; nothing else in Memoire's schema changes.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { postgrestClient } from './postgrest.mjs';
import { runnerAs } from './database.mjs';
import { fromSibling, MEMOIRE } from './siblings.mjs';

const PGVECTOR_SHIM = [
  [/CREATE EXTENSION IF NOT EXISTS vector[^;]*;/gi, ''],
  [/ALTER EXTENSION vector[^;]*;/gi, ''],
  [/CREATE INDEX[^;]*USING ivfflat[^;]*;/gi, ''],
  [/extensions\.vector/g, 'real[]'],
  [/\bvector\(\d+\)/g, 'real[]'],
  [/(query_embedding\s+)vector\b/g, '$1real[]'],
];

export async function memoireDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(readFileSync(new URL('../fixtures/supabase-stub.sql', import.meta.url), 'utf8'));
  // As pg_dump does: function bodies are checked when they run, not when they are created (the shimmed vector ops).
  await db.exec('SET check_function_bodies = off');
  const dir = join(MEMOIRE, 'supabase/migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    let sql = readFileSync(join(dir, f), 'utf8');
    for (const [re, to] of PGVECTOR_SHIM) sql = sql.replace(re, to);
    await db.exec(sql);
  }
  return db;
}

export async function memoireUser(db, uid) {
  await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING', [uid, `${uid.slice(-4)}@memoire.example.test`]);
}

const response = () => {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.status = (n) => {
    res.statusCode = n;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
};

/**
 * Memoire's Commercial API v1, served by Memoire's own handler over this database, and Memoire's own SDK client
 * pointed at it. `tokens` maps an access token to the user it authenticates.
 */
export async function memoireCommercialApi(db, tokens) {
  const { createCommercialHandler } = await fromSibling(MEMOIRE, 'api/_commercial.js');
  const { createMemoireClient } = await fromSibling(MEMOIRE, 'packages/memoire-sdk/dist/index.js');
  const handler = createCommercialHandler({
    verify: async (token) => (tokens.has(token) ? { id: tokens.get(token) } : null),
    clientForToken: (token) => postgrestClient(runnerAs(db, 'authenticated', tokens.get(token))),
    rateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  });
  const fetch = async (url, init) => {
    const u = new URL(url);
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const req = { method: init.method, headers, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : undefined, socket: { remoteAddress: '127.0.0.1' } };
    const res = response();
    await handler(req, res);
    return new Response(JSON.stringify(res.body), { status: res.statusCode, headers: res.headers });
  };
  /** The SDK as an owner holding `token` would use it. */
  const clientFor = (token) => createMemoireClient({ origin: 'https://memoire.example.test/', getAccessToken: () => token, fetch });
  return { clientFor, handler };
}

/**
 * Memoire's webhook worker, as the cron would run it, delivering to `deliver(url, body, headers)` instead of the
 * network. Runs until Memoire has nothing left to deliver (it claims two per call).
 */
export async function runMemoireWebhookWorker(db, { ownerId, secret, since, deliver }) {
  const { createWebhookWorker } = await fromSibling(MEMOIRE, 'api/_webhooks.js');
  const env = {
    CRON_SECRET: 'cron-secret-for-the-integration-suite',
    COMMERCIAL_WEBHOOK_TARGETS: JSON.stringify([{ id: 'forge', ownerId, secretEnv: 'COMMERCIAL_WEBHOOK_SECRET_FORGE', since, url: 'https://forge.example.test/api/memoire' }]),
    COMMERCIAL_WEBHOOK_SECRET_FORGE: secret,
  };
  const worker = createWebhookWorker({ env, clientFactory: () => postgrestClient(runnerAs(db, 'service_role', null)), deliver });
  const totals = { attempted: 0, acknowledged: 0, runs: 0 };
  for (;;) {
    const res = response();
    await worker({ method: 'POST', headers: { authorization: `Bearer ${env.CRON_SECRET}` } }, res);
    if (res.statusCode !== 200) throw new Error(`Memoire's webhook worker answered ${res.statusCode}: ${JSON.stringify(res.body)}`);
    totals.runs += 1;
    totals.attempted += res.body.attempted;
    totals.acknowledged += res.body.acknowledged;
    if (res.body.attempted === 0 || totals.runs > 50) return totals;
  }
}
