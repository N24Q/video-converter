// Bundles the Electron main process and preload script with esbuild.
// The preload must be a single self-contained CommonJS file because it runs
// in a sandboxed renderer where only a few built-in modules can be required.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
};

const entries = [
  { entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.js' },
  { entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.js' },
];

if (watch) {
  for (const e of entries) {
    const ctx = await context({ ...common, ...e });
    await ctx.watch();
  }
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })));
}
