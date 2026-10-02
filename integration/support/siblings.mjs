/**
 * Where Forge's siblings live. The integration suite runs Helm's and Memoire's
 * own code, read-only, from their repositories next to this one. When a sibling
 * is absent the suites that need it are SKIPPED — and say so — never passed.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

export const FORGE = fileURLToPath(new URL('../../', import.meta.url));
export const HELM = process.env.FORGE_HELM_REPO ?? join(FORGE, '..', 'Helm');
export const MEMOIRE = process.env.FORGE_MEMOIRE_REPO ?? join(FORGE, '..', 'Memoire');

const present = (root, marker) => existsSync(join(root, marker));

export const helmAvailable = present(HELM, 'packages/decision-runtime/src/postgres.ts') && present(HELM, 'node_modules/@helm/shared');
export const memoireAvailable = present(MEMOIRE, 'packages/memoire-sdk/dist/index.js') && present(MEMOIRE, 'api/_webhooks.js');

export const helmSkip = helmAvailable ? false : `Helm not found at ${HELM} (set FORGE_HELM_REPO); skipped, not passed`;
export const memoireSkip = memoireAvailable ? false : `Memoire not found at ${MEMOIRE} (set FORGE_MEMOIRE_REPO); skipped, not passed`;

/** Import a module from a sibling repository by path. */
export const fromSibling = (root, path) => import(pathToFileURL(join(root, path)).href);
