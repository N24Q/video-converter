import type {
  ConversionSettings,
  FrameRateSetting,
  MediaInfo,
  MediaStream,
  StreamPlanEntry,
} from '../../shared/types';
import { CONTAINERS, ENCODERS, getFormatDef } from './catalog';
import { primaryVideo } from './probe';

// Builds the FFmpeg argument array. Never produces a shell string.

export interface BuildInput {
  settings: ConversionSettings;
  plan: StreamPlanEntry[];
  info: MediaInfo; // primary source (first clip for concat)
  outputPath: string;
  vaapiDevice?: string | null;
  input:
    | { kind: 'file'; path: string }
    | { kind: 'concat-list'; listPath: string }
    | { kind: 'normalise'; clips: MediaInfo[] };
}

export const PROGRESS_ARGS = ['-progress', 'pipe:1', '-nostats', '-stats_period', '0.5'];

const NAMED_RATES: Record<string, string> = {
  '23.976': '24000/1001',
  '23.98': '24000/1001',
  '29.97': '30000/1001',
  '59.94': '60000/1001',
  '47.952': '48000/1001',
  '119.88': '120000/1001',
};

/** Convert a user frame rate ("29.97", "25", "30000/1001") to an FFmpeg rational. */
export function frameRateArg(fps: string): string | null {
  const t = fps.trim();
  if (NAMED_RATES[t]) return NAMED_RATES[t];
  if (/^\d{1,6}\/\d{1,6}$/.test(t)) {
    const [n, d] = t.split('/').map(Number);
    if (d > 0 && n / d > 0 && n / d <= 1000) return t;
    return null;
  }
  if (/^\d{1,4}(\.\d{1,4})?$/.test(t)) {
    const v = Number(t);
    return v > 0 && v <= 1000 ? t : null;
  }
  return null;
}

/** Display dimensions after applying rotation metadata (if autorotate applies). */
export function displayDims(
  v: MediaStream | undefined,
  rotation: ConversionSettings['video']['rotation'],
) {
  if (!v?.width || !v?.height) return null;
  let rot = 0;
  if (rotation === 'auto') rot = v.rotation ?? 0;
  else if (typeof rotation === 'number') rot = rotation;
  const swap = rot === 90 || rot === 270;
  return swap ? { w: v.height, h: v.width } : { w: v.width, h: v.height };
}

/** Fit box adjusted for portrait sources: a 1920x1080 box becomes 1080x1920. */
export function orientBox(
  box: { width: number; height: number },
  src: { w: number; h: number } | null,
) {
  if (!src) return box;
  const srcPortrait = src.h > src.w;
  const boxPortrait = box.height > box.width;
  if (srcPortrait !== boxPortrait) return { width: box.height, height: box.width };
  return box;
}

function rotationFilters(rotation: ConversionSettings['video']['rotation']): string[] {
  if (rotation === 90) return ['transpose=clock'];
  if (rotation === 180) return ['hflip', 'vflip'];
  if (rotation === 270) return ['transpose=cclock'];
  return [];
}

function shouldDeinterlace(s: ConversionSettings, v: MediaStream | undefined) {
  return s.video.deinterlace === 'on' || (s.video.deinterlace === 'auto' && !!v?.interlaced);
}

function isDvFormat(s: ConversionSettings) {
  return s.muxer === 'dv';
}

/** Video filter chain for a single (non-concat) encode. */
export function buildVideoFilters(s: ConversionSettings, v: MediaStream | undefined): string[] {
  const f: string[] = [];
  const enc = s.video.encoder ? ENCODERS[s.video.encoder] : undefined;
  if (shouldDeinterlace(s, v)) f.push('bwdif=mode=send_frame:parity=auto:deint=all');
  if (s.video.crop) {
    const { width, height, x, y } = s.video.crop;
    f.push(`crop=${Math.floor(width)}:${Math.floor(height)}:${Math.floor(x)}:${Math.floor(y)}`);
  }
  f.push(...rotationFilters(s.video.rotation));

  const dims = displayDims(v, s.video.rotation);
  if (isDvFormat(s)) {
    const pal = isPalRate(s.video.frameRate, v?.frameRate ?? null);
    const wide = dims ? dims.w / dims.h > 1.5 : true;
    f.push(
      `scale=720:${pal ? 576 : 480}`,
      `setdar=${wide ? '16/9' : '4/3'}`,
      `fps=${pal ? '25' : '30000/1001'}`,
    );
  } else {
    if (s.video.resolution.mode === 'fit') {
      const box = orientBox(s.video.resolution, dims);
      if (s.video.stretch) {
        f.push(`scale=${box.width}:${box.height}`, 'setsar=1');
      } else {
        f.push(
          `scale=w=${box.width}:h=${box.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        );
      }
    } else if (needsEvenDims(s, dims)) {
      f.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
    }
    const fr = fpsFilter(s.video.frameRate);
    if (fr) f.push(fr);
  }

  if (enc?.hw === 'vaapi') f.push('format=nv12', 'hwupload');
  return f;
}

function rationalValue(r: string): number {
  const [n, d] = r.split('/').map(Number);
  return d ? n / d : n;
}

/** DV must be PAL (25 fps, 576 lines) or NTSC (29.97 fps, 480 lines). */
export function isPalRate(fr: FrameRateSetting, sourceFps: number | null): boolean {
  const rate =
    fr.mode === 'fixed' ? rationalValue(frameRateArg(fr.fps) ?? '25') : (sourceFps ?? 25);
  return Math.abs(rate - 25) < 1 || Math.abs(rate - 50) < 1;
}

function needsEvenDims(s: ConversionSettings, dims: { w: number; h: number } | null) {
  if (s.video.crop) return true;
  if (!dims) return false;
  return dims.w % 2 === 1 || dims.h % 2 === 1;
}

function fpsFilter(fr: FrameRateSetting): string | null {
  if (fr.mode !== 'fixed') return null;
  const r = frameRateArg(fr.fps);
  return r ? `fps=${r}` : null;
}

function specFlag(flag: string, type: 'v' | 'a', idx: number) {
  return flag.includes(':') ? `${flag}:${idx}` : `${flag}:${type}:${idx}`;
}

export function chooseSampleRate(
  enc: string,
  requested: number | null,
  source: number | null,
): number | null {
  const info = ENCODERS[enc];
  const want = requested ?? source;
  if (info?.sampleRates && want && !info.sampleRates.includes(want)) return 48000;
  if (info?.sampleRates && !want) return 48000;
  return requested;
}

function videoEncodeArgs(
  s: ConversionSettings,
  enc: string,
  idx: number,
  src: MediaStream | undefined,
): string[] {
  const a: string[] = [];
  const info = ENCODERS[enc];
  const v = s.video;
  const hasBitrate = !!v.bitrateKbps;
  if (info?.quality && v.quality !== null && v.quality !== undefined) {
    const q = info.quality;
    if (q.kind === 'enum') {
      const choice =
        q.choices?.find((c) => c.value === v.quality) ??
        q.choices?.find((c) => c.value === q.default);
      if (choice) a.push(specFlag(q.flag, 'v', idx), choice.arg);
    } else {
      const val = Math.min(q.max ?? 1000, Math.max(q.min ?? 0, Math.round(v.quality)));
      a.push(specFlag(q.flag, 'v', idx), String(val));
      if (q.extraArgs && !hasBitrate)
        a.push(...q.extraArgs.map((x, i) => (i % 2 === 0 ? specFlag(x, 'v', idx) : x)));
    }
  }
  if (hasBitrate) {
    a.push(specFlag('-b', 'v', idx), `${Math.round(v.bitrateKbps!)}k`);
  } else if (
    info?.defaultBitrateKbps &&
    (!info.quality || v.quality === null || enc === 'libvpx')
  ) {
    // Encoders without a quality mode (or VP8, whose CRF needs a ceiling).
    a.push(specFlag('-b', 'v', idx), `${info.defaultBitrateKbps}k`);
  }
  if (v.maxBitrateKbps) {
    a.push(specFlag('-maxrate', 'v', idx), `${Math.round(v.maxBitrateKbps)}k`);
    a.push(specFlag('-bufsize', 'v', idx), `${Math.round(v.maxBitrateKbps * 2)}k`);
  }
  if (info?.speed) {
    const sp =
      v.speedPreset && info.speed.values.includes(v.speedPreset)
        ? v.speedPreset
        : info.speed.default;
    a.push(specFlag(info.speed.flag, 'v', idx), sp);
  }
  if (info?.hw !== 'vaapi') {
    const pix =
      v.pixFmt ?? (info?.pixFmt10 && (src?.bitDepth ?? 8) > 8 ? info.pixFmt10 : info?.pixFmt);
    if (pix && !isDvFormat(s)) a.push(`-pix_fmt:v:${idx}`, pix);
    if (isDvFormat(s)) a.push(`-pix_fmt:v:${idx}`, 'yuv420p');
  }
  if (info?.extraArgs) a.push(...info.extraArgs);
  return a;
}

function audioEncodeArgs(
  s: ConversionSettings,
  enc: string,
  idx: number,
  src: MediaStream | undefined,
): string[] {
  const a: string[] = [];
  const info = ENCODERS[enc];
  if (!info?.lossless) {
    const br = s.audio.bitrateKbps ?? info?.defaultBitrateKbps ?? null;
    if (br) a.push(`-b:a:${idx}`, `${Math.round(br)}k`);
  }
  const sr = isDvFormat(s)
    ? 48000
    : chooseSampleRate(enc, s.audio.sampleRate, src?.sampleRate ?? null);
  if (sr) a.push(`-ar:a:${idx}`, String(sr));
  let ch = s.audio.channels;
  const srcCh = src?.channels ?? null;
  if (info?.maxChannels && (ch ?? srcCh ?? 0) > info.maxChannels)
    ch = info.maxChannels === 6 ? 6 : 2;
  if (isDvFormat(s)) ch = 2;
  if (ch) a.push(`-ac:a:${idx}`, String(ch));
  if (enc === 'libopus' && (ch ?? srcCh ?? 2) > 2) a.push(`-mapping_family:a:${idx}`, '1');
  return a;
}

function streamById(info: MediaInfo, index: number) {
  return info.streams.find((x) => x.index === index);
}

function commonHeader(): string[] {
  return ['-hide_banner', '-nostdin', '-n', '-loglevel', 'warning', ...PROGRESS_ARGS];
}

function tailArgs(s: ConversionSettings, outputPath: string): string[] {
  const a: string[] = [];
  const rule = CONTAINERS[s.muxer];
  if (s.fastStart && rule?.fastStart) a.push('-movflags', '+faststart');
  const def = getFormatDef(s.formatId);
  if (def?.muxerArgs) a.push(...def.muxerArgs);
  a.push('-max_muxing_queue_size', '4096');
  a.push(...s.customArgs);
  a.push('-f', s.muxer, outputPath);
  return a;
}

export function buildArgs(b: BuildInput): string[] {
  const { settings: s, plan, info } = b;
  if (b.input.kind === 'normalise') return buildNormaliseArgs(b, b.input.clips);

  const a = commonHeader();
  const encVideo = plan.find((p) => p.type === 'video' && p.action === 'encode');
  const hw = encVideo?.targetCodec ? ENCODERS[encVideo.targetCodec]?.hw : undefined;
  if (hw === 'vaapi' && b.vaapiDevice) a.push('-vaapi_device', b.vaapiDevice);

  if (b.input.kind === 'concat-list') {
    a.push('-f', 'concat', '-safe', '0', '-i', b.input.listPath);
  } else {
    if (s.video.rotation !== 'auto') a.push('-noautorotate');
    a.push('-i', b.input.path);
  }

  const counters = { video: 0, audio: 0, subtitle: 0, attachment: 0 };
  for (const p of plan) {
    if (p.action === 'drop') continue;
    a.push('-map', `0:${p.sourceIndex}`);
  }
  for (const p of plan) {
    if (p.action === 'drop') continue;
    const src = streamById(info, p.sourceIndex);
    if (p.type === 'video') {
      const i = counters.video++;
      if (p.action === 'copy') {
        a.push(`-c:v:${i}`, 'copy');
      } else {
        a.push(`-c:v:${i}`, p.targetCodec!);
        const filters = buildVideoFilters(s, src);
        if (filters.length) a.push(`-filter:v:${i}`, filters.join(','));
        a.push(...videoEncodeArgs(s, p.targetCodec!, i, src));
      }
    } else if (p.type === 'audio') {
      const i = counters.audio++;
      if (p.action === 'copy') a.push(`-c:a:${i}`, 'copy');
      else a.push(`-c:a:${i}`, p.targetCodec!, ...audioEncodeArgs(s, p.targetCodec!, i, src));
    } else if (p.type === 'subtitle') {
      const i = counters.subtitle++;
      a.push(`-c:s:${i}`, p.action === 'copy' ? 'copy' : p.targetCodec!);
    } else if (p.type === 'attachment') {
      const i = counters.attachment++;
      a.push(`-c:t:${i}`, 'copy');
    }
  }

  a.push('-map_metadata', s.preserveMetadata ? '0' : '-1');
  a.push('-map_chapters', s.preserveChapters ? '0' : '-1');
  a.push(...tailArgs(s, b.outputPath));
  return a;
}

/**
 * Re-encoding concatenation for clips whose parameters differ: every clip is
 * scaled/padded to one size, frame rate and audio layout, then joined with
 * the concat filter. Only the first video and audio stream of each clip are
 * used. Clips without audio get generated silence so A/V stay aligned.
 */
function buildNormaliseArgs(b: BuildInput, clips: MediaInfo[]): string[] {
  const s = b.settings;
  const a = commonHeader();
  const encV = s.video.mode === 'encode' ? s.video.encoder : null;
  const encA = s.audio.mode === 'encode' ? s.audio.encoder : null;
  const hw = encV ? ENCODERS[encV]?.hw : undefined;
  if (hw === 'vaapi' && b.vaapiDevice) a.push('-vaapi_device', b.vaapiDevice);

  const target = normaliseTarget(s, clips);
  clips.forEach((c) => a.push('-i', c.path));
  const silentIndex = new Map<number, number>();
  let next = clips.length;
  if (encA) {
    clips.forEach((c, i) => {
      if (!c.streams.some((x) => x.type === 'audio')) {
        a.push(
          '-f',
          'lavfi',
          '-t',
          String(c.duration ?? 0),
          '-i',
          `anullsrc=r=${target.sampleRate}:cl=stereo`,
        );
        silentIndex.set(i, next++);
      }
    });
  }

  const parts: string[] = [];
  const concatInputs: string[] = [];
  clips.forEach((c, i) => {
    const v = primaryVideo(c);
    if (encV) {
      const chain: string[] = [];
      if (shouldDeinterlace(s, v)) chain.push('bwdif=mode=send_frame:parity=auto:deint=all');
      chain.push(
        `scale=w=${target.width}:h=${target.height}:force_original_aspect_ratio=decrease`,
        `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2`,
        'setsar=1',
        `fps=${target.fps}`,
        'format=yuv420p',
      );
      parts.push(`[${i}:v:0]${chain.join(',')}[v${i}]`);
      concatInputs.push(`[v${i}]`);
    }
    if (encA) {
      const src = silentIndex.has(i) ? `${silentIndex.get(i)}:a:0` : `${i}:a:0`;
      parts.push(
        `[${src}]aresample=${target.sampleRate},aformat=sample_fmts=fltp:channel_layouts=${target.layout}[a${i}]`,
      );
      concatInputs.push(`[a${i}]`);
    }
  });
  const vOut = encV ? 1 : 0;
  const aOut = encA ? 1 : 0;
  let concat = `${concatInputs.join('')}concat=n=${clips.length}:v=${vOut}:a=${aOut}`;
  concat += vOut ? '[vcat]' : '';
  concat += aOut ? '[aout]' : '';
  parts.push(concat);
  if (vOut) parts.push(hw === 'vaapi' ? '[vcat]format=nv12,hwupload[vout]' : '[vcat]null[vout]');

  a.push('-filter_complex', parts.join(';'));
  if (vOut) {
    a.push('-map', '[vout]', '-c:v:0', encV!);
    const v0 = primaryVideo(clips[0]);
    a.push(
      ...videoEncodeArgs({ ...s, video: { ...s.video, pixFmt: s.video.pixFmt } }, encV!, 0, v0),
    );
  }
  if (aOut) {
    a.push('-map', '[aout]', '-c:a:0', encA!);
    a.push(
      ...audioEncodeArgs(
        { ...s, audio: { ...s.audio, sampleRate: target.sampleRate, channels: target.channels } },
        encA!,
        0,
        undefined,
      ),
    );
  }
  a.push('-map_metadata', s.preserveMetadata ? '0' : '-1', '-map_chapters', '-1');
  a.push(...tailArgs(s, b.outputPath));
  return a;
}

export function normaliseTarget(s: ConversionSettings, clips: MediaInfo[]) {
  const v0 = clips.map(primaryVideo).find(Boolean);
  const dims = displayDims(v0, s.video.rotation) ?? { w: 1920, h: 1080 };
  let width = dims.w;
  let height = dims.h;
  if (s.video.resolution.mode === 'fit') {
    const box = orientBox(s.video.resolution, dims);
    width = box.width;
    height = box.height;
  }
  width -= width % 2;
  height -= height % 2;
  let fps = '30';
  if (s.video.frameRate.mode === 'fixed') fps = frameRateArg(s.video.frameRate.fps) ?? '30';
  else if (v0?.frameRateRaw && /^\d+\/\d+$/.test(v0.frameRateRaw)) {
    fps = v0.frameRateRaw;
    // A deinterlaced 50i/60i clip reports the frame rate; keep it.
  } else if (v0?.frameRate) fps = String(Math.round(v0.frameRate * 1000) / 1000);
  const enc = s.audio.encoder ?? '';
  const sampleRate = chooseSampleRate(enc, s.audio.sampleRate ?? 48000, 48000) ?? 48000;
  const channels = s.audio.channels && s.audio.channels <= 2 ? s.audio.channels : 2;
  const layout = channels === 1 ? 'mono' : 'stereo';
  return { width, height, fps, sampleRate, channels, layout };
}
