import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const pkg = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Dev only: `/api/extract`, served by server/extraction — the Claude extractor when the server has
 * ANTHROPIC_API_KEY, a 503 saying so when it does not. Loaded on request, so the key and the SDK never
 * enter the browser bundle.
 */
function forgeExtractApi(): Plugin {
  return {
    name: 'forge-extract-api',
    configureServer(server) {
      server.middlewares.use('/api/extract', (req, res, next) => {
        server
          .ssrLoadModule('/server/extraction/http.ts')
          .then((m) => m.handleExtract(req, res))
          .catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), forgeExtractApi()],
  resolve: {
    // Packages are consumed straight from source, as in Helm: no compile step
    // between a package and the app, and one typecheck covers both.
    alias: {
      '@forge/kernel/postgres': pkg('./packages/kernel/src/postgres.ts'),
      '@forge/kernel': pkg('./packages/kernel/src/index.ts'),
      '@forge/fabric': pkg('./packages/fabric/src/index.ts'),
      '@forge/demo': pkg('./packages/demo/src/index.ts'),
    },
  },
  server: {
    port: 5193,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-router')) return 'router';
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});
