#!/usr/bin/env node
/**
 * send-observation — a reference sender for forge.observation.v1 (docs/contracts/forge-observation-v1.md).
 *
 * Reads a JSON file holding an array of observations, wraps it in the envelope, signs it with the surface's secret
 * from FORGE_SURFACE_SECRET, POSTs it, and prints Forge's answer. It is what an adapter does, in thirty lines — not a
 * connector, and it sends nothing on its own.
 *
 *   FORGE_SURFACE_SECRET=... node scripts/send-observation.mjs --url <endpoint> --surface erp observations.json
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = flag('url');
const surface = flag('surface');
const file = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')).pop();
const secret = process.env.FORGE_SURFACE_SECRET;
if (!url || !surface || !file || !secret) {
  console.error('usage: FORGE_SURFACE_SECRET=... node scripts/send-observation.mjs --url <endpoint> --surface <system> <observations.json>');
  process.exit(2);
}

const observations = JSON.parse(readFileSync(file, 'utf8'));
const body = JSON.stringify({ contract: 'forge.observation.v1', system: surface, observations });
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Forge-Surface': surface, 'Forge-Timestamp': timestamp, 'Forge-Signature': signature },
  body,
});
console.log(res.status, await res.text());
process.exit(res.ok ? 0 : 1);
