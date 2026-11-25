import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

// Spotify no longer accepts "localhost" redirect URIs, only loopback IPs like 127.0.0.1.
// We pin the dev and preview servers to http://127.0.0.1:5173 so the redirect URI always matches.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  worker: { format: 'es' }, // the on-device AI runs in a module worker
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
});
