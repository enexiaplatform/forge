/**
 * Resolve `@helm/<package>[/<subpath>]` to Helm's own source, through each
 * package's own `exports` map — without installing anything into, or changing,
 * the Helm repository. (Helm's node_modules may link fewer workspace packages
 * than it has; the integration suite should not depend on that.)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HELM = process.env.FORGE_HELM_REPO ?? fileURLToPath(new URL('../../../Helm/', import.meta.url));

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@helm/')) {
    const [, name, ...rest] = specifier.split('/');
    const dir = join(HELM, 'packages', name);
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      const sub = rest.length ? `./${rest.join('/')}` : '.';
      const target = typeof pkg.exports === 'string' && sub === '.' ? pkg.exports : pkg.exports?.[sub];
      if (typeof target === 'string') return { url: pathToFileURL(join(dir, target)).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
