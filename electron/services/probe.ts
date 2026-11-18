import type { MediaInfo, MediaStream, StreamType } from '../../shared/types';
import { runCapture } from './exec';

// ffprobe's JSON output, loosely typed: every field may be missing.
interface RawStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  field_order?: string;
  bits_per_raw_sample?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  bit_rate?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
  side_data_list?: { side_data_type?: string; rotation?: number }[];
}

interface RawProbe {
  format?: {
    format_name?: string;
    format_long_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
    start_time?: string;
    tags?: Record<string, string>;
  };
  streams?: RawStream[];
  chapters?: unknown[];
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '' || v === 'N/A') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Parse "30000/1001" style rationals. Returns null for 0/0 and junk. */
export function parseRational(v: string | undefined | null): number | null {
  if (!v) return null;
  const m = /^(-?\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const d = m[2] === undefined ? 1 : Number(m[2]);
  if (!d || !Number.isFinite(n / d) || n / d <= 0) return null;
  return n / d;
}

function lowerTags(tags: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags ?? {})) out[k.toLowerCase()] = String(v);
  return out;
}

const TYPES: Record<string, StreamType> = {
  video: 'video',
  audio: 'audio',
  subtitle: 'subtitle',
  data: 'data',
  attachment: 'attachment',
};

function normaliseRotation(deg: number): number {
  const r = ((Math.round(deg) % 360) + 360) % 360;
  return r;
}

export function parseStream(s: RawStream, fallbackIndex: number): MediaStream {
  const tags = lowerTags(s.tags);
  const type = TYPES[s.codec_type ?? ''] ?? 'unknown';
  const stream: MediaStream = {
    index: typeof s.index === 'number' ? s.index : fallbackIndex,
    type,
    codec: s.codec_name ?? null,
    codecLongName: s.codec_long_name ?? null,
    profile: s.profile ?? null,
    language: tags.language && tags.language !== 'und' ? tags.language : null,
    title: tags.title ?? null,
    isDefault: s.disposition?.default === 1,
    isAttachedPic: s.disposition?.attached_pic === 1,
  };
  if (type === 'video') {
    stream.width = num(s.width) ?? undefined;
    stream.height = num(s.height) ?? undefined;
    stream.pixFmt = s.pix_fmt ?? null;
    // avg_frame_rate is the real rate for most files; r_frame_rate can be
    // the field rate for interlaced material, so prefer avg when present.
    const avg = parseRational(s.avg_frame_rate);
    const r = parseRational(s.r_frame_rate);
    stream.frameRate = avg ?? r;
    stream.frameRateRaw = (avg ? s.avg_frame_rate : s.r_frame_rate) ?? null;
    stream.fieldOrder = s.field_order ?? null;
    stream.interlaced = !!s.field_order && ['tt', 'bb', 'tb', 'bt'].includes(s.field_order);
    stream.bitDepth = num(s.bits_per_raw_sample);
    let rotation = 0;
    const sd = s.side_data_list?.find((d) => typeof d.rotation === 'number');
    if (sd && typeof sd.rotation === 'number') rotation = sd.rotation;
    else if (tags.rotate) rotation = Number(tags.rotate) || 0;
    // ffprobe reports display-matrix rotation counter-clockwise (e.g. -90 for
    // a phone held upright); normalise to clockwise degrees 0..359.
    stream.rotation = sd ? normaliseRotation(-rotation) : normaliseRotation(rotation);
  } else if (type === 'audio') {
    stream.sampleRate = num(s.sample_rate);
    stream.channels = num(s.channels);
    stream.channelLayout = s.channel_layout ?? null;
  }
  stream.bitRate = num(s.bit_rate);
  return stream;
}

export function parseProbeJson(json: string, filePath: string): MediaInfo {
  let raw: RawProbe;
  try {
    raw = JSON.parse(json) as RawProbe;
  } catch {
    throw new Error('ffprobe returned output that is not valid JSON');
  }
  if (!raw || typeof raw !== 'object') throw new Error('ffprobe returned an empty result');
  const fmt = raw.format ?? {};
  const fmtTags = lowerTags(fmt.tags);
  const streams = (Array.isArray(raw.streams) ? raw.streams : []).map((s, i) => parseStream(s, i));
  const duration = num(fmt.duration);
  return {
    path: filePath,
    formatName: fmt.format_name ?? null,
    formatLongName: fmt.format_long_name ?? null,
    duration: duration !== null && duration > 0 ? duration : null,
    size: num(fmt.size),
    bitRate: num(fmt.bit_rate),
    startTime: num(fmt.start_time),
    creationTime: fmtTags.creation_time ?? null,
    streams,
    chapters: Array.isArray(raw.chapters) ? raw.chapters.length : 0,
  };
}

/** Turn ffprobe's stderr into a short, user-readable reason. */
export function explainProbeFailure(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes('no such file')) return 'The file no longer exists.';
  if (s.includes('permission denied')) return 'Permission denied while reading the file.';
  if (s.includes('invalid data found'))
    return 'Not a recognised media file, or the file is damaged.';
  if (s.includes('end of file')) return 'The file appears to be truncated.';
  const last = stderr.trim().split('\n').pop();
  return last
    ? `FFprobe could not read the file: ${last.slice(0, 200)}`
    : 'FFprobe could not read the file.';
}

export async function probeFile(
  ffprobe: string,
  filePath: string,
  timeoutMs = 30_000,
): Promise<MediaInfo> {
  const r = await runCapture(
    ffprobe,
    [
      '-v',
      'error',
      '-hide_banner',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      '-show_chapters',
      filePath,
    ],
    { timeoutMs, maxBytes: 8 * 1024 * 1024 },
  );
  if (r.spawnError) throw new Error(`Could not run ffprobe: ${r.spawnError}`);
  if (r.timedOut) throw new Error('FFprobe timed out while inspecting the file.');
  if (r.code !== 0) throw new Error(explainProbeFailure(r.stderr));
  const info = parseProbeJson(r.stdout, filePath);
  if (info.streams.length === 0)
    throw new Error('No audio or video streams were found in this file.');
  return info;
}

export function primaryVideo(info: MediaInfo): MediaStream | undefined {
  return info.streams.find((s) => s.type === 'video' && !s.isAttachedPic);
}

export function primaryAudio(info: MediaInfo): MediaStream | undefined {
  return info.streams.find((s) => s.type === 'audio');
}
