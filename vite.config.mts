import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The production CSP forbids inline scripts. The dev server's React refresh
// preamble is inline, so relax script-src only when serving in development.
const devCsp = (): Plugin => ({
  name: 'dev-csp',
  apply: 'serve',
  transformIndexHtml(html) {
    return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
  },
});

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react(), devCsp()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5183,
    strictPort: true,
  },
});
