import path from 'node:path';

const MAX_STEM_BYTES = 180;

/** Make a filename stem safe for Linux/ChromeOS filesystems (incl. FAT/exFAT on SD cards). */
export function sanitizeStem(stem: string): string {
  let s = stem
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (!s) s = 'output';
  while (Buffer.byteLength(s, 'utf8') > MAX_STEM_BYTES) s = s.slice(0, -1);
  return s;
}

export function stemOf(filePath: string): string {
  const base = path.basename(filePath);
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

export interface NameContext {
  exists: (p: string) => boolean;
  reserved: Set<string>; // outputs of jobs still in the queue
  sources: Set<string>; // never write over a source
}

/**
 * Pick the output path. The first choice is "<stem>.<ext>"; if that is taken
 * (on disk, by a queued job, or is a source) we use "<stem>_converted.<ext>",
 * then "<stem>_converted_1.<ext>", "_2", ...
 */
export function uniqueOutputPath(dir: string, stem: string, ext: string, ctx: NameContext): string {
  const clean = sanitizeStem(stem);
  const taken = (p: string) => ctx.exists(p) || ctx.reserved.has(p) || ctx.sources.has(p);
  const first = path.join(dir, `${clean}.${ext}`);
  if (!taken(first)) return first;
  const second = path.join(dir, `${clean}_converted.${ext}`);
  if (!taken(second)) return second;
  for (let i = 1; i < 100_000; i++) {
    const p = path.join(dir, `${clean}_converted_${i}.${ext}`);
    if (!taken(p)) return p;
  }
  throw new Error('Could not find a free output filename.');
}

/** The path we'd use if overwriting is allowed (still never a source or a queued output). */
export function preferredOutputPath(dir: string, stem: string, ext: string): string {
  return path.join(dir, `${sanitizeStem(stem)}.${ext}`);
}

/** Temporary file next to the final output so the final rename is atomic. */
export function tempOutputPath(finalPath: string, jobId: string): string {
  const dir = path.dirname(finalPath);
  const ext = path.extname(finalPath);
  const stem = stemOf(finalPath);
  return path.join(dir, `.${stem}.partial-${jobId.slice(0, 8)}${ext}`);
}
