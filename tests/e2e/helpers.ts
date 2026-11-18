import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(__dirname, '../..');

export function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function tmpDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Generate a short test clip with FFmpeg's built-in test sources. */
export function makeClip(
  file: string,
  opts: { seconds?: number; size?: string; rate?: number; extra?: string[]; format?: string } = {},
) {
  const args = [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${opts.size ?? '320x240'}:rate=${opts.rate ?? 25}`,
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    String(opts.seconds ?? 2),
    ...(opts.extra ?? ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac']),
    ...(opts.format ? ['-f', opts.format] : []),
    file,
  ];
  execFileSync('ffmpeg', args);
}

export function probeDuration(file: string): number {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    file,
  ]).toString();
  return Number(out.trim());
}

export function probeCodecs(file: string): string[] {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_name',
    '-of',
    'csv=p=0',
    file,
  ]).toString();
  return out
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Environment for launching Electron. VS Code's integrated terminal sets
 * ELECTRON_RUN_AS_NODE, which would make Electron behave like plain Node.
 */
export function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (
      v !== undefined &&
      !['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'VITE_DEV_SERVER_URL'].includes(k)
    )
      env[k] = v;
  }
  return { ...env, ...extra };
}

export async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [ROOT],
    cwd: ROOT,
    env: cleanEnv({ VIDEO_CONVERTER_USER_DATA: userData }),
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.topbar');
  return { app, page };
}

/** Make the next native open dialog return the given paths. */
export async function stubOpenDialog(app: ElectronApplication, paths: string[]) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: p,
    })) as typeof dialog.showOpenDialog;
  }, paths);
}
