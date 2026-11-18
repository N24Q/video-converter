// Launches the built app (npm start). Clears ELECTRON_RUN_AS_NODE, which
// VS Code's integrated terminal sets and which would stop Electron starting.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const child = spawn(require('electron'), ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
child.on('exit', (code) => process.exit(code ?? 0));
