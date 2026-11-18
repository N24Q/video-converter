import type { CodecEntry, FormatEntry } from '../../shared/types';

// Parsers for `ffmpeg -encoders`, `-decoders`, `-muxers`, `-demuxers`,
// `-formats` and `-hwaccels`. The output formats are stable across FFmpeg
// releases: a legend block, a "------" separator, then one entry per line.

function afterSeparator(output: string): string[] {
  const lines = output.split(/\r?\n/);
  const sep = lines.findIndex((l) => /^\s*-{2,}\s*$/.test(l));
  return (sep >= 0 ? lines.slice(sep + 1) : lines).filter((l) => l.trim().length > 0);
}

const TYPE_FLAG: Record<string, CodecEntry['type']> = {
  V: 'video',
  A: 'audio',
  S: 'subtitle',
  D: 'data',
};

/**
 * Parse `ffmpeg -encoders` / `-decoders`. Lines look like:
 *  " V....D libx264  libx264 H.264 / AVC / MPEG-4 AVC (codec h264)"
 */
export function parseCodecList(output: string): CodecEntry[] {
  const out: CodecEntry[] = [];
  for (const line of afterSeparator(output)) {
    const m = /^\s*([VASDT.])([F.])([S.])([X.])([B.])([D.])\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, typeFlag, , , exp, , , name, rest] = m;
    const codecMatch = /\(codec (\S+)\)\s*$/.exec(rest);
    const description = rest.replace(/\s*\(codec \S+\)\s*$/, '').trim();
    out.push({
      name,
      description,
      type: TYPE_FLAG[typeFlag] ?? 'unknown',
      codec: codecMatch ? codecMatch[1] : name,
      experimental: exp === 'X',
    });
  }
  return out;
}

/**
 * Parse `ffmpeg -muxers` / `-demuxers` / `-formats`. Lines look like:
 *  "  E  mp4             MP4 (MPEG-4 Part 14)"
 *  " DE  matroska,webm   Matroska / WebM"   (for -formats)
 *  " D d dv  ..."  (newer builds add a 'd' device flag column)
 */
export function parseFormatList(
  output: string,
): { name: string; description: string; demux: boolean; mux: boolean }[] {
  const out: { name: string; description: string; demux: boolean; mux: boolean }[] = [];
  for (const line of afterSeparator(output)) {
    const m = /^ ?([D ])([E ])([d ]?)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, d, e, , name, description] = m;
    if (d !== 'D' && e !== 'E') continue;
    out.push({ name, description: description.trim(), demux: d === 'D', mux: e === 'E' });
  }
  return out;
}

export function parseMuxers(output: string): FormatEntry[] {
  return parseFormatList(output)
    .filter((f) => f.mux)
    .map(({ name, description }) => ({ name, description }));
}

export function parseDemuxers(output: string): FormatEntry[] {
  return parseFormatList(output)
    .filter((f) => f.demux)
    .map(({ name, description }) => ({ name, description }));
}

export function parseHwaccels(output: string): string[] {
  const lines = output.split(/\r?\n/).map((l) => l.trim());
  const start = lines.findIndex((l) => /^Hardware acceleration methods:/i.test(l));
  return (start >= 0 ? lines.slice(start + 1) : lines).filter((l) => /^[a-z0-9_]+$/i.test(l));
}

/** Parse "Common extensions: mp4." from `ffmpeg -h muxer=NAME`. */
export function parseMuxerHelp(output: string): { extensions: string[]; mimeType: string | null } {
  const ext = /Common extensions:\s*(.+?)\.?\s*$/m.exec(output);
  const mime = /Mime type:\s*(\S+?)\.?\s*$/m.exec(output);
  const extensions = ext
    ? ext[1]
        .split(',')
        .map((s) => s.trim().replace(/\.$/, ''))
        .filter(Boolean)
    : [];
  return { extensions, mimeType: mime ? mime[1] : null };
}

/** True when a muxer of that name exists (handles "matroska,webm" style names). */
export function hasFormat(list: FormatEntry[], name: string): boolean {
  return list.some((f) => f.name.split(',').includes(name));
}

export function findEncoder(list: CodecEntry[], name: string): CodecEntry | undefined {
  return list.find((e) => e.name === name);
}
