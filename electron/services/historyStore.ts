import type { HistoryEntry, Job } from '../../shared/types';
import { readJson, writeJsonAtomic, WriteChain } from './jsonFile';

export function historyEntryFromJob(j: Job): HistoryEntry {
  return {
    id: j.id,
    mode: j.mode,
    sources: j.sources,
    outputPath: j.outputPath,
    status: j.status,
    formatId: j.settings.formatId,
    startedAt: j.startedAt,
    endedAt: j.endedAt,
    error: j.error?.message ?? null,
  };
}

function isEntry(v: unknown): v is HistoryEntry {
  const e = v as HistoryEntry;
  return (
    !!e &&
    typeof e.id === 'string' &&
    Array.isArray(e.sources) &&
    typeof e.outputPath === 'string' &&
    typeof e.status === 'string'
  );
}

/** Conversion history, newest first, bounded by a limit. */
export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private writes = new WriteChain();

  constructor(
    private readonly file: string,
    private limit: () => number,
  ) {}

  async load() {
    const { value } = await readJson<unknown>(this.file, []);
    this.entries = Array.isArray(value) ? value.filter(isEntry).slice(0, this.limit()) : [];
  }

  list(): HistoryEntry[] {
    return [...this.entries];
  }

  async add(entry: HistoryEntry) {
    this.entries = [entry, ...this.entries.filter((e) => e.id !== entry.id)].slice(0, this.limit());
    await this.persist();
  }

  async clear() {
    this.entries = [];
    await this.persist();
  }

  private persist() {
    const snapshot = this.list();
    return this.writes.run(() => writeJsonAtomic(this.file, snapshot));
  }
}
