/**
 * The staging contract suite (supabase/tests/staging-contracts.sql), proven locally before it ever runs on a real
 * Supabase project: the same script, on PGlite with Helm's migrations and Forge's, must pass every check — and
 * must FAIL when a guarantee is removed, so a staging pass means something.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ecosystemDatabase } from './support/database.mjs';
import { helmSkip } from './support/siblings.mjs';

const SCRIPT = readFileSync(new URL('../supabase/tests/staging-contracts.sql', import.meta.url), 'utf8');

describe('the staging contract suite, proven locally', { skip: helmSkip }, () => {
  test('every contract passes on the real migrations', async () => {
    const db = await ecosystemDatabase();
    const results = await db.exec(SCRIPT);
    const rows = results[results.length - 1].rows;
    assert.deepEqual(rows.map((r) => r.contract), [
      'inherited Helm visibility',
      'tenant isolation',
      'impersonation prevention',
      'idempotency',
      'append-only history',
      'sensitivity propagation (Forge)',
      'Forge outcome publication',
      'Helm governed intake',
      'authority in the database',
    ]);
    // A second run in the same database: fresh synthetic ids, the same result.
    const again = await db.exec(SCRIPT);
    assert.equal(again[again.length - 1].rows.length, 9);
  });

  test('and fails, by name, when a guarantee is removed', async () => {
    const db = await ecosystemDatabase();
    await db.exec(`DROP POLICY forge_sealed_values_read ON public.forge_sealed_values;
      CREATE POLICY forge_sealed_values_read ON public.forge_sealed_values FOR SELECT TO authenticated USING (public.is_org_member(org_id));`);
    await assert.rejects(() => db.exec(SCRIPT), /STAGING CONTRACT FAILED: sensitivity: a reader without Helm clearance read the sealed value/);
  });
});
