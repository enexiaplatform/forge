// Registered with `node --import`: lets the integration suite load Helm's packages from Helm's own source.
import { register } from 'node:module';

register('./helm-loader.mjs', import.meta.url);
