// Development runner: starts the Vite dev server, builds the Electron
// main/preload bundles, then launches Electron pointed at the dev server.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5183/';

await new Promise((resolve, reject) => {
  const b = spawn(process.execPath, ['scripts/build-electron.mjs'], { stdio: 'inherit' });
  b.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('electron build failed'))));
});

const electronPath = require('electron');
const app = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
app.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
