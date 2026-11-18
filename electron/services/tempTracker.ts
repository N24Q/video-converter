import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJsonAtomic, WriteChain } from './jsonFile';

const PARTIAL_NAME = /^\..+\.partial-[0-9a-f]{8}(\.[^.]+)?$/i;

/**
 * Remembers which temporary output files are being written, so that after a
 * crash or power loss the app can remove them on next start. Only files we
 * created (matching our naming pattern) are ever deleted.
 */
export class TempTracker {
  private files = new Set<string>();
  private writes = new WriteChain();

  constructor(private readonly file: string) {}

  static isOurs(p: string) {
    return PARTIAL_NAME.test(path.basename(p));
  }

  async add(p: string) {
    this.files.add(p);
    await this.persist();
  }

  async remove(p: string) {
    this.files.delete(p);
    await this.persist();
  }

  /** Delete leftovers from a previous run. Returns how many were removed. */
  async cleanupStale(): Promise<number> {
    const { value } = await readJson<unknown>(this.file, []);
    const list = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : [];
    let removed = 0;
    for (const p of list) {
      if (!path.isAbsolute(p) || !TempTracker.isOurs(p)) continue;
      try {
        await fs.unlink(p);
        removed++;
      } catch {
        /* already gone */
      }
    }
    this.files.clear();
    await this.persist();
    return removed;
  }

  private persist() {
    const snapshot = [...this.files];
    return this.writes.run(() => writeJsonAtomic(this.file, snapshot));
  }
}
