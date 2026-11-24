import { defineConfig } from 'vite';

// Spotify no longer accepts "localhost" redirect URIs, only loopback IPs like 127.0.0.1.
// We pin the dev and preview servers to http://127.0.0.1:5173 so the redirect URI always matches.
export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
});
