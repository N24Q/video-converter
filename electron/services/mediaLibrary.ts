import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AvchdSet, ImportResult, MediaItem } from '../../shared/types';
import { findAvchdRoots, findMediaFiles, scanBdmv } from './avchd/scan';
import { INPUT_EXTENSIONS } from './catalog';
import { probeFile } from './probe';

const MAX_ITEMS = 2000;
const PROBE_CONCURRENCY = 2;

/** Accept only plausible absolute paths before touching the filesystem. */
export function isSanePath(p: unknown): p is string {
  return (
    typeof p === 'string' &&
    p.length > 1 &&
    p.length < 4096 &&
    path.isAbsolute(p) &&
    !p.includes('\0')
  );
}

/**
 * The set of media the user has imported. Paths only enter the library via
 * native dialogs or drag-and-drop and are validated here; jobs refer to
 * media by id, so the renderer never supplies a path for conversion.
 */
export class MediaLibrary extends EventEmitter {
  private media = new Map<string, MediaItem>();
  private sets = new Map<string, AvchdSet>();
  private probeQueue: string[] = [];
  private probing = 0;

  constructor(private readonly ffprobe: () => string | null) {
    super();
  }

  list(): { media: MediaItem[]; avchdSets: AvchdSet[] } {
    return { media: [...this.media.values()], avchdSets: [...this.sets.values()] };
  }

  get(id: string): MediaItem | undefined {
    return this.media.get(id);
  }

  getSet(id: string): AvchdSet | undefined {
    return this.sets.get(id);
  }

  /** True if this exact path was imported (used to authorise output dirs etc.). */
  hasPath(p: string): boolean {
    return [...this.media.values()].some((m) => m.path === p);
  }

  remove(id: string) {
    const m = this.media.get(id);
    if (!m) return;
    this.media.delete(id);
    if (m.avchdSetId) {
      const set = this.sets.get(m.avchdSetId);
      if (set) {
        set.clips = set.clips.filter((c) => c.mediaId !== id);
        if (set.clips.length === 0) this.sets.delete(set.id);
      }
    }
    this.changed();
  }

  clear() {
    this.media.clear();
    this.sets.clear();
    this.probeQueue = [];
    this.changed();
  }

  /** Re-probe items that failed (e.g. after FFprobe was installed). */
  reprobeFailed() {
    for (const m of this.media.values()) {
      if (m.status === 'error') {
        m.status = 'probing';
        m.error = null;
        this.enqueueProbe(m.id);
      }
    }
    this.changed();
  }

  async importPaths(paths: unknown[]): Promise<ImportResult> {
    const result: ImportResult = { media: [], avchdSets: [], messages: [] };
    for (const p of paths.slice(0, 1000)) {
      if (!isSanePath(p)) {
        result.messages.push('Ignored an invalid path.');
        continue;
      }
      let st;
      try {
        st = await fs.stat(p);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        result.messages.push(
          code === 'EACCES'
            ? `Permission denied: ${path.basename(p)}`
            : `Not found: ${path.basename(p)}`,
        );
        continue;
      }
      if (st.isDirectory()) {
        const r = await this.importFolder(p);
        result.media.push(...r.media);
        result.avchdSets.push(...r.avchdSets);
        result.messages.push(...r.messages);
      } else if (st.isFile()) {
        const item = await this.addFile(p, st.size, null, result);
        if (item) result.media.push(item);
      } else {
        result.messages.push(`Not a regular file: ${path.basename(p)}`);
      }
    }
    this.changed();
    return result;
  }

  private async importFolder(dir: string): Promise<ImportResult> {
    const result: ImportResult = { media: [], avchdSets: [], messages: [] };
    const roots = await findAvchdRoots(dir);
    if (roots.length) {
      for (const bdmv of roots) {
        const scan = await scanBdmv(bdmv);
        if (scan.clips.length === 0) {
          result.messages.push(
            `AVCHD structure at ${path.basename(scan.rootPath)} contains no recordings.`,
          );
          continue;
        }
        const set: AvchdSet = {
          id: randomUUID(),
          rootPath: scan.rootPath,
          bdmvPath: scan.bdmvPath,
          hasIndex: scan.hasIndex,
          hasMovieObject: scan.hasMovieObject,
          playlists: scan.playlists,
          clips: [],
          orderMethod: scan.orderMethod,
          orderExplanation: scan.orderExplanation,
          warnings: scan.warnings,
        };
        for (const c of scan.clips) {
          let size: number | null = null;
          try {
            size = (await fs.stat(c.path)).size;
          } catch {
            /* reported by probe */
          }
          const item = await this.addFile(c.path, size, set.id, result);
          if (!item) continue;
          set.clips.push({
            mediaId: item.id,
            name: c.fileName,
            path: c.path,
            playlistOrder: c.playlistOrder,
            groupIndex: c.groupIndex,
            hasClipInfo: c.hasClipInfo,
            inTimeSec: c.inTimeSec,
            outTimeSec: c.outTimeSec,
          });
        }
        if (set.clips.length) {
          this.sets.set(set.id, set);
          result.avchdSets.push(set);
          result.messages.push(
            `Found AVCHD recordings in ${path.basename(scan.rootPath) || scan.rootPath}: ${set.clips.length} clip(s).`,
          );
        }
      }
      return result;
    }

    const { files, truncated } = await findMediaFiles(dir, new Set(INPUT_EXTENSIONS));
    if (files.length === 0) result.messages.push(`No media files found in ${path.basename(dir)}.`);
    if (truncated)
      result.messages.push('Only the first 500 media files in the folder were imported.');
    for (const f of files) {
      let size: number | null = null;
      try {
        size = (await fs.stat(f)).size;
      } catch {
        continue;
      }
      const item = await this.addFile(f, size, null, result);
      if (item) result.media.push(item);
    }
    return result;
  }

  private async addFile(
    p: string,
    size: number | null,
    setId: string | null,
    result: ImportResult,
  ) {
    let real = p;
    try {
      real = await fs.realpath(p);
    } catch {
      /* use as given */
    }
    if ([...this.media.values()].some((m) => m.path === real)) {
      result.messages.push(`Already imported: ${path.basename(real)}`);
      return null;
    }
    if (this.media.size >= MAX_ITEMS) {
      result.messages.push(
        `The import list is full (${MAX_ITEMS} items). Remove some items first.`,
      );
      return null;
    }
    const item: MediaItem = {
      id: randomUUID(),
      path: real,
      name: path.basename(real),
      size,
      status: 'probing',
      info: null,
      error: null,
      avchdSetId: setId,
    };
    this.media.set(item.id, item);
    this.enqueueProbe(item.id);
    return item;
  }

  private enqueueProbe(id: string) {
    this.probeQueue.push(id);
    this.pumpProbe();
  }

  private pumpProbe() {
    while (this.probing < PROBE_CONCURRENCY && this.probeQueue.length) {
      const id = this.probeQueue.shift()!;
      const item = this.media.get(id);
      if (!item) continue;
      this.probing++;
      this.probeOne(item).finally(() => {
        this.probing--;
        this.changed();
        this.pumpProbe();
      });
    }
  }

  private async probeOne(item: MediaItem) {
    const ffprobe = this.ffprobe();
    if (!ffprobe) {
      item.status = 'error';
      item.error = 'FFprobe is not installed, so this file cannot be inspected.';
      return;
    }
    try {
      item.info = await probeFile(ffprobe, item.path);
      item.status = 'ready';
      item.error = null;
    } catch (err) {
      item.status = 'error';
      item.error = (err as Error).message;
    }
  }

  private changeTimer: NodeJS.Timeout | null = null;
  private changed() {
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.emit('change');
    }, 100);
  }
}
