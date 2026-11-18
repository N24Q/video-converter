import fs from 'node:fs/promises';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { runCapture } from './exec';

async function isExecutableFile(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    if (!st.isFile()) return false;
    await fs.access(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Search the PATH (plus a few common extra locations) for an executable name. */
export async function findOnPath(
  name: string,
  envPath = process.env.PATH ?? '',
  extraDirs: string[] = ['/usr/bin', '/usr/local/bin', '/bin', '/snap/bin', '/opt/homebrew/bin'],
): Promise<string | null> {
  const dirs = [...envPath.split(path.delimiter).filter(Boolean), ...extraDirs];
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const candidate = path.join(dir, name);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve an executable: an explicitly configured path wins (and must be
 * valid), otherwise search the PATH.
 */
export async function resolveExecutable(
  name: 'ffmpeg' | 'ffprobe',
  configured: string | null,
): Promise<{ path: string | null; error: string | null }> {
  if (configured) {
    if (!path.isAbsolute(configured)) {
      return { path: null, error: `Configured ${name} path must be absolute: ${configured}` };
    }
    if (await isExecutableFile(configured)) return { path: configured, error: null };
    return {
      path: null,
      error: `Configured ${name} path is not an executable file: ${configured}`,
    };
  }
  const found = await findOnPath(name);
  if (found) return { path: found, error: null };
  return { path: null, error: `${name} was not found on the PATH.` };
}

/** Parse the first line of `ffmpeg -version` / `ffprobe -version`. */
export function parseVersion(output: string): {
  version: string | null;
  configuration: string | null;
} {
  const first = output.split(/\r?\n/)[0] ?? '';
  const m = /^ff(?:mpeg|probe) version (\S+)/.exec(first);
  const conf = /^configuration:\s*(.*)$/m.exec(output);
  return { version: m ? m[1] : null, configuration: conf ? conf[1].trim() : null };
}

export async function getVersion(exe: string) {
  const r = await runCapture(exe, ['-hide_banner', '-version'], { timeoutMs: 10_000 });
  if (r.spawnError) throw new Error(`Could not run ${exe}: ${r.spawnError}`);
  if (r.code !== 0) throw new Error(`${exe} -version exited with code ${r.code}`);
  return parseVersion(r.stdout);
}
