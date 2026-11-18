import fs from 'node:fs/promises';
import path from 'node:path';

/** Read JSON; returns `fallback` if missing or corrupted (and reports which). */
export async function readJson<T>(
  file: string,
  fallback: T,
): Promise<{ value: T; status: 'ok' | 'missing' | 'corrupt' }> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return { value: fallback, status: 'missing' };
  }
  try {
    return { value: JSON.parse(text) as T, status: 'ok' };
  } catch {
    // keep the broken file for troubleshooting rather than silently losing it
    await fs.rename(file, `${file}.corrupt`).catch(() => {});
    return { value: fallback, status: 'corrupt' };
  }
}

/** Write JSON atomically (temp file + rename) so a crash never leaves half a file. */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, file);
}

/** Serialises async writes so they never interleave. */
export class WriteChain {
  private chain: Promise<void> = Promise.resolve();
  run(fn: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(fn, fn);
    return this.chain;
  }
}
