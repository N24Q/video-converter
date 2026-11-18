import fs from 'node:fs/promises';
import path from 'node:path';
import type { AvchdPlaylistInfo, ClipOrderMethod } from '../../../shared/types';
import { isClipInfo, parseMpls, type Playlist } from './mpls';

export interface ScannedClip {
  name: string; // "00001"
  fileName: string;
  path: string;
  playlistOrder: number | null;
  groupIndex: number;
  hasClipInfo: boolean;
  inTimeSec: number | null;
  outTimeSec: number | null;
}

export interface AvchdScan {
  rootPath: string;
  bdmvPath: string;
  hasIndex: boolean;
  hasMovieObject: boolean;
  playlists: AvchdPlaylistInfo[];
  clips: ScannedClip[];
  orderMethod: ClipOrderMethod;
  orderExplanation: string;
  warnings: string[];
}

const CLIP_EXT = /\.(mts|m2ts)$/i;
const PLAYLIST_EXT = /\.(mpl|mpls)$/i;
const CLIPINF_EXT = /\.(cpi|clpi)$/i;

async function listDir(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Case-insensitive child lookup (FAT-formatted SD cards may use any case). */
async function findChild(dir: string, name: string, kind: 'dir' | 'file'): Promise<string | null> {
  const entries = await listDir(dir);
  const hit = entries.find(
    (e) =>
      e.name.toLowerCase() === name.toLowerCase() &&
      (kind === 'dir' ? e.isDirectory() : e.isFile()),
  );
  return hit ? path.join(dir, hit.name) : null;
}

export async function isBdmvDir(dir: string): Promise<boolean> {
  if (path.basename(dir).toLowerCase() !== 'bdmv') return false;
  return (await findChild(dir, 'STREAM', 'dir')) !== null;
}

/**
 * Find BDMV directories that contain a STREAM folder, at or below `start`
 * (bounded depth, no symlink following) or directly above it (in case the
 * user picked the STREAM or PLAYLIST folder itself).
 */
export async function findAvchdRoots(
  start: string,
  maxDepth = 6,
  maxDirs = 3000,
): Promise<string[]> {
  const found = new Set<string>();

  // Look upward: user may have selected BDMV/STREAM or BDMV itself.
  let cur = start;
  for (let i = 0; i < 3; i++) {
    if (await isBdmvDir(cur)) {
      found.add(cur);
      return [...found];
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  const queue: { dir: string; depth: number }[] = [{ dir: start, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < maxDirs) {
    const { dir, depth } = queue.shift()!;
    visited++;
    const entries = await listDir(dir);
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      if (e.name.startsWith('.') && e.name.toLowerCase() !== '.bdmv') continue;
      const child = path.join(dir, e.name);
      if (e.name.toLowerCase() === 'bdmv' && (await isBdmvDir(child))) {
        found.add(child);
        continue; // don't descend into BDMV
      }
      if (depth + 1 <= maxDepth) queue.push({ dir: child, depth: depth + 1 });
    }
  }
  return [...found].sort();
}

/** Natural sort ("2" before "10"). */
export function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Work out playback order and recording groups from the playlists.
 * Exported separately so it can be tested without a filesystem.
 */
export function orderClips(
  clipNames: string[],
  playlists: { name: string; playlist: Playlist | null }[],
): {
  order: {
    name: string;
    playlistOrder: number | null;
    groupIndex: number;
    inTime: number | null;
    outTime: number | null;
  }[];
  method: ClipOrderMethod;
  explanation: string;
} {
  const available = new Set(clipNames);
  const placed = new Map<
    string,
    { playlistOrder: number; groupIndex: number; inTime: number; outTime: number }
  >();
  let pos = 0;
  let group = -1;
  const sortedPl = [...playlists]
    .filter((p) => p.playlist)
    .sort((a, b) => naturalCompare(a.name, b.name));
  for (const pl of sortedPl) {
    let first = true;
    for (const item of pl.playlist!.items) {
      // A new recording starts at the first item of a playlist and at any
      // item that is not a seamless continuation (connection condition 5/6).
      const seamless = item.connectionCondition === 5 || item.connectionCondition === 6;
      if (first || !seamless) group++;
      first = false;
      if (!available.has(item.clipName) || placed.has(item.clipName)) continue;
      placed.set(item.clipName, {
        playlistOrder: pos++,
        groupIndex: group,
        inTime: item.inTime,
        outTime: item.outTime,
      });
    }
  }

  const unplaced = clipNames.filter((n) => !placed.has(n)).sort(naturalCompare);
  const order: ReturnType<typeof orderClips>['order'] = [];
  for (const [name, p] of [...placed.entries()].sort(
    (a, b) => a[1].playlistOrder - b[1].playlistOrder,
  )) {
    order.push({
      name,
      playlistOrder: p.playlistOrder,
      groupIndex: p.groupIndex,
      inTime: p.inTime,
      outTime: p.outTime,
    });
  }
  for (const name of unplaced) {
    order.push({ name, playlistOrder: null, groupIndex: ++group, inTime: null, outTime: null });
  }

  let method: ClipOrderMethod;
  let explanation: string;
  if (placed.size === 0) {
    method = 'filename';
    explanation = sortedPl.length
      ? 'The playlists could not be matched to the recordings, so clips are ordered by file number. Check the order before combining.'
      : 'No readable playlist was found, so clips are ordered by file number. Check the order before combining.';
  } else if (unplaced.length) {
    method = 'playlist-partial';
    explanation = `Order comes from the camera's playlist. ${unplaced.length} clip(s) not listed in any playlist are placed at the end in file-number order.`;
  } else {
    method = 'playlist';
    explanation =
      "Order and recording groups come from the camera's playlist. Clips the camera split automatically (e.g. at the 2 GB file limit) are grouped together.";
  }
  return { order, method, explanation };
}

export async function scanBdmv(bdmvPath: string): Promise<AvchdScan> {
  const warnings: string[] = [];
  const streamDir = await findChild(bdmvPath, 'STREAM', 'dir');
  const playlistDir = await findChild(bdmvPath, 'PLAYLIST', 'dir');
  const clipinfDir = await findChild(bdmvPath, 'CLIPINF', 'dir');
  const hasIndex =
    (await findChild(bdmvPath, 'INDEX.BDM', 'file')) !== null ||
    (await findChild(bdmvPath, 'index.bdmv', 'file')) !== null;
  const hasMovieObject =
    (await findChild(bdmvPath, 'MOVIEOBJ.BDM', 'file')) !== null ||
    (await findChild(bdmvPath, 'MovieObject.bdmv', 'file')) !== null;

  if (!playlistDir) warnings.push('No PLAYLIST folder was found.');
  if (!clipinfDir) warnings.push('No CLIPINF folder was found.');
  if (!hasIndex) warnings.push('INDEX.BDM is missing; the structure may be incomplete.');

  const clipFiles = streamDir
    ? (await listDir(streamDir)).filter((e) => e.isFile() && CLIP_EXT.test(e.name))
    : [];
  if (clipFiles.length === 0) warnings.push('The STREAM folder contains no .MTS/.M2TS recordings.');
  const byName = new Map<string, { fileName: string; path: string }>();
  for (const f of clipFiles) {
    const stem = f.name.replace(CLIP_EXT, '');
    byName.set(stem, { fileName: f.name, path: path.join(streamDir!, f.name) });
  }

  const clipInfos = new Set<string>();
  if (clipinfDir) {
    for (const e of await listDir(clipinfDir)) {
      if (!e.isFile() || !CLIPINF_EXT.test(e.name)) continue;
      try {
        const fh = await fs.open(path.join(clipinfDir, e.name), 'r');
        const b = Buffer.alloc(8);
        await fh.read(b, 0, 8, 0);
        await fh.close();
        if (isClipInfo(b)) clipInfos.add(e.name.replace(CLIPINF_EXT, ''));
      } catch {
        /* unreadable clip info is reported via hasClipInfo=false */
      }
    }
  }

  const playlists: { name: string; playlist: Playlist | null }[] = [];
  const playlistInfo: AvchdPlaylistInfo[] = [];
  if (playlistDir) {
    for (const e of (await listDir(playlistDir)).filter(
      (x) => x.isFile() && PLAYLIST_EXT.test(x.name),
    )) {
      try {
        const st = await fs.stat(path.join(playlistDir, e.name));
        if (st.size > 1024 * 1024) throw new Error('Playlist file is unexpectedly large');
        const buf = await fs.readFile(path.join(playlistDir, e.name));
        const pl = parseMpls(buf);
        playlists.push({ name: e.name, playlist: pl });
        playlistInfo.push({
          name: e.name,
          clipNames: pl.items.map((i) => i.clipName),
          valid: true,
          error: null,
        });
      } catch (err) {
        playlists.push({ name: e.name, playlist: null });
        playlistInfo.push({
          name: e.name,
          clipNames: [],
          valid: false,
          error: (err as Error).message,
        });
        warnings.push(`Playlist ${e.name} could not be read: ${(err as Error).message}`);
      }
    }
  }

  const { order, method, explanation } = orderClips([...byName.keys()], playlists);
  const clips: ScannedClip[] = order.map((o) => ({
    name: o.name,
    fileName: byName.get(o.name)!.fileName,
    path: byName.get(o.name)!.path,
    playlistOrder: o.playlistOrder,
    groupIndex: o.groupIndex,
    hasClipInfo: clipInfos.has(o.name),
    inTimeSec: o.inTime,
    outTimeSec: o.outTime,
  }));

  const referenced = new Set(
    playlists.flatMap((p) => p.playlist?.items.map((i) => i.clipName) ?? []),
  );
  const missing = [...referenced].filter((n) => !byName.has(n));
  if (missing.length) {
    warnings.push(
      `Playlists reference ${missing.length} clip(s) that are missing from STREAM: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`,
    );
  }

  // Root = parent of BDMV, or of AVCHD/PRIVATE if that's the conventional layout.
  let rootPath = path.dirname(bdmvPath);
  for (let i = 0; i < 2; i++) {
    const base = path.basename(rootPath).toLowerCase();
    if (base === 'avchd' || base === 'private') rootPath = path.dirname(rootPath);
  }

  return {
    rootPath,
    bdmvPath,
    hasIndex,
    hasMovieObject,
    playlists: playlistInfo,
    clips,
    orderMethod: method,
    orderExplanation: explanation,
    warnings,
  };
}

/** For non-AVCHD folders: media files up to a bounded depth and count. */
export async function findMediaFiles(
  start: string,
  extensions: Set<string>,
  maxDepth = 3,
  maxFiles = 500,
): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: start, depth: 0 }];
  let truncated = false;
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    const entries = (await listDir(dir)).sort((a, b) => naturalCompare(a.name, b.name));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) {
        if (depth < maxDepth) queue.push({ dir: p, depth: depth + 1 });
      } else if (e.isFile()) {
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (extensions.has(ext)) {
          if (files.length >= maxFiles) {
            truncated = true;
            return { files, truncated };
          }
          files.push(p);
        }
      }
    }
  }
  return { files, truncated };
}
