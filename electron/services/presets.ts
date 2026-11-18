import type {
  AppSettings,
  ConversionSettings,
  FfmpegCapabilities,
  PresetDescriptor,
  PresetId,
} from '../../shared/types';
import {
  ENCODERS,
  FORMAT_DEFS,
  containerAllows,
  encoderCodec,
  getFormatDef,
  isEncoderUsable,
} from './catalog';

export function baseSettings(formatId = 'mp4'): ConversionSettings {
  const def = getFormatDef(formatId) ?? FORMAT_DEFS[0];
  return {
    presetId: null,
    formatId: def.id,
    muxer: def.muxer,
    extension: def.extension,
    video: {
      mode: def.kind === 'audio' ? 'none' : 'encode',
      encoder: null,
      quality: null,
      speedPreset: null,
      bitrateKbps: null,
      maxBitrateKbps: null,
      resolution: { mode: 'original' },
      stretch: false,
      frameRate: { mode: 'original' },
      deinterlace: 'auto',
      rotation: 'auto',
      crop: null,
      pixFmt: null,
      hwaccel: 'none',
    },
    audio: { mode: 'encode', encoder: null, bitrateKbps: null, sampleRate: null, channels: null },
    subtitles: 'auto',
    streams: { audio: null, subtitle: null },
    preserveMetadata: true,
    preserveChapters: true,
    fastStart: true,
    customArgs: [],
  };
}

interface PresetDef {
  id: PresetId;
  label: string;
  description: string;
  defaultFormat: string;
  formats: string[];
  // per-format encoder preferences; '*' is the fallback
  video?: Record<string, string[]>;
  audio?: Record<string, string[]>;
  videoQuality?: Record<string, number>; // encoder -> quality value
  videoSpeed?: Record<string, string>;
  audioBitrate?: number;
  copy?: boolean;
  audioOnly?: boolean;
}

const VIDEO_FORMATS = FORMAT_DEFS.filter((f) => f.kind === 'video').map((f) => f.id);
const AUDIO_FORMATS = FORMAT_DEFS.filter((f) => f.kind === 'audio').map((f) => f.id);

export const PRESET_DEFS: PresetDef[] = [
  {
    id: 'best-compatibility',
    label: 'Best Compatibility',
    description:
      'H.264 video and AAC audio in MP4. Plays on practically every phone, TV, browser and editor. Resolution and frame rate are kept.',
    defaultFormat: 'mp4',
    formats: ['mp4', 'm4v', 'mov', 'mkv'],
    video: { '*': ['libx264'] },
    audio: { '*': ['aac', 'libfdk_aac'] },
    videoQuality: { libx264: 21, h264_vaapi: 23, h264_nvenc: 23 },
    videoSpeed: { libx264: 'medium' },
    audioBitrate: 192,
  },
  {
    id: 'high-quality',
    label: 'High Quality',
    description:
      'Visually near-lossless re-encode using slower encoder settings. Larger files and longer conversions.',
    defaultFormat: 'mp4',
    formats: ['mp4', 'mkv', 'mov', 'webm'],
    video: {
      mov: ['prores_ks', 'libx264'],
      webm: ['libvpx-vp9', 'libsvtav1'],
      '*': ['libx264', 'libx265'],
    },
    audio: { webm: ['libopus'], mov: ['aac', 'pcm_s24le'], '*': ['aac', 'libfdk_aac', 'libopus'] },
    videoQuality: {
      libx264: 18,
      libx265: 20,
      'libvpx-vp9': 24,
      libsvtav1: 26,
      prores_ks: 3,
      h264_vaapi: 19,
    },
    videoSpeed: { libx264: 'slow', libx265: 'slow', 'libvpx-vp9': '2', libsvtav1: '6' },
    audioBitrate: 256,
  },
  {
    id: 'smaller-file',
    label: 'Smaller File Size',
    description:
      'Prioritises file size: HEVC (or AV1 for WebM) at a higher compression level. Quality is noticeably reduced on detailed footage, and HEVC may not play on older devices.',
    defaultFormat: 'mp4',
    formats: ['mp4', 'mkv', 'webm'],
    video: { webm: ['libsvtav1', 'libvpx-vp9', 'libaom-av1'], '*': ['libx265', 'libx264'] },
    audio: { webm: ['libopus'], '*': ['aac', 'libfdk_aac'] },
    videoQuality: { libx265: 28, libx264: 26, libsvtav1: 38, 'libvpx-vp9': 38, 'libaom-av1': 38 },
    videoSpeed: { libx265: 'medium', libx264: 'medium', libsvtav1: '8' },
    audioBitrate: 128,
  },
  {
    id: 'stream-copy',
    label: 'Original Quality (Stream Copy)',
    description:
      'Copies the existing video and audio into a new container without re-encoding: fast and lossless. Only works when the target container supports the source codecs.',
    defaultFormat: 'mkv',
    formats: VIDEO_FORMATS.filter((f) => !['dv', 'y4m'].includes(f)),
    copy: true,
  },
  {
    id: 'web-optimised',
    label: 'Web Optimised',
    description:
      'Streams well in browsers: MP4 with H.264/AAC and fast-start, or WebM with VP9/Opus. Stereo audio.',
    defaultFormat: 'mp4',
    formats: ['mp4', 'webm'],
    video: { webm: ['libvpx-vp9', 'libsvtav1'], '*': ['libx264'] },
    audio: { webm: ['libopus', 'libvorbis'], '*': ['aac', 'libfdk_aac'] },
    videoQuality: { libx264: 23, 'libvpx-vp9': 33, libsvtav1: 35 },
    videoSpeed: { libx264: 'medium', 'libvpx-vp9': '3' },
    audioBitrate: 160,
  },
  {
    id: 'archive',
    label: 'Archive Quality',
    description:
      'Lossless FFV1 + FLAC in MKV, or ProRes HQ + PCM in MOV. Preserves full quality for long-term storage; files are very large.',
    defaultFormat: 'mkv',
    formats: ['mkv', 'mov'],
    video: { mov: ['prores_ks'], '*': ['ffv1'] },
    audio: { mov: ['pcm_s24le', 'pcm_s16le'], '*': ['flac'] },
    videoQuality: { prores_ks: 3 },
  },
  {
    id: 'audio-only',
    label: 'Audio Only',
    description: 'Extracts the audio track to an audio file. Video is discarded.',
    defaultFormat: 'mp3',
    formats: AUDIO_FORMATS,
    audioOnly: true,
    audioBitrate: 192,
  },
];

function prefsFor(map: Record<string, string[]> | undefined, formatId: string): string[] {
  if (!map) return [];
  return map[formatId] ?? map['*'] ?? [];
}

function pickEncoder(
  caps: FfmpegCapabilities | null,
  muxer: string,
  type: 'video' | 'audio',
  candidates: string[],
): string | null {
  for (const c of candidates) {
    if (!isEncoderUsable(caps, c)) continue;
    if (containerAllows(muxer, type, encoderCodec(caps, c)) === false) continue;
    return c;
  }
  return null;
}

const HW_EQUIVALENT: Record<string, string> = { libx264: 'h264_vaapi', libx265: 'hevc_vaapi' };

/** Software encoder to fall back to when a hardware encoder fails. */
export function softwareEquivalent(
  caps: FfmpegCapabilities | null,
  encoder: string,
): string | null {
  const codec = ENCODERS[encoder]?.codec;
  if (!codec) return null;
  const prefs: Record<string, string[]> = {
    h264: ['libx264'],
    hevc: ['libx265'],
    av1: ['libsvtav1', 'libaom-av1'],
    vp9: ['libvpx-vp9'],
  };
  return (prefs[codec] ?? []).find((e) => isEncoderUsable(caps, e)) ?? null;
}

export function resolvePreset(
  presetId: PresetId,
  formatId: string,
  caps: FfmpegCapabilities | null,
  defaults?: Pick<
    AppSettings,
    'defaultResolution' | 'defaultFrameRate' | 'preserveMetadata' | 'hwaccelPreference'
  >,
): { settings: ConversionSettings | null; error: string | null } {
  const preset = PRESET_DEFS.find((p) => p.id === presetId);
  if (!preset) return { settings: null, error: `Unknown preset "${presetId}".` };
  if (!preset.formats.includes(formatId)) {
    return {
      settings: null,
      error: `${preset.label} cannot produce ${getFormatDef(formatId)?.label ?? formatId}.`,
    };
  }
  const def = getFormatDef(formatId);
  if (!def) return { settings: null, error: `Unknown format "${formatId}".` };
  if (!caps) return { settings: null, error: 'FFmpeg is not available.' };

  const s = baseSettings(formatId);
  s.presetId = presetId;
  s.preserveMetadata = defaults?.preserveMetadata ?? true;
  if (defaults) {
    s.video.resolution = defaults.defaultResolution;
    s.video.frameRate = defaults.defaultFrameRate;
  }

  if (preset.copy) {
    s.video.mode = 'copy';
    s.audio.mode = 'copy';
    s.subtitles = 'copy';
    s.video.resolution = { mode: 'original' };
    s.video.frameRate = { mode: 'original' };
    return { settings: s, error: null };
  }

  if (preset.audioOnly || def.kind === 'audio') {
    s.video.mode = 'none';
    const enc = pickEncoder(caps, def.muxer, 'audio', def.audio);
    if (!enc) return { settings: null, error: `No audio encoder for ${def.label} is available.` };
    s.audio.encoder = enc;
    s.audio.bitrateKbps = ENCODERS[enc]?.lossless
      ? null
      : (preset.audioBitrate ?? ENCODERS[enc]?.defaultBitrateKbps ?? null);
    s.subtitles = 'remove';
    return { settings: s, error: null };
  }

  let venc = pickEncoder(caps, def.muxer, 'video', [
    ...prefsFor(preset.video, formatId),
    ...def.video,
  ]);
  if (!venc)
    return { settings: null, error: `No suitable video encoder for ${def.label} is available.` };
  if (
    defaults?.hwaccelPreference === 'vaapi' &&
    HW_EQUIVALENT[venc] &&
    isEncoderUsable(caps, HW_EQUIVALENT[venc])
  ) {
    venc = HW_EQUIVALENT[venc];
    s.video.hwaccel = 'vaapi';
  }
  const aenc = pickEncoder(caps, def.muxer, 'audio', [
    ...prefsFor(preset.audio, formatId),
    ...def.audio,
  ]);
  if (!aenc)
    return { settings: null, error: `No suitable audio encoder for ${def.label} is available.` };

  s.video.encoder = venc;
  const vinfo = ENCODERS[venc];
  s.video.quality = preset.videoQuality?.[venc] ?? vinfo?.quality?.default ?? null;
  s.video.speedPreset = preset.videoSpeed?.[venc] ?? vinfo?.speed?.default ?? null;
  s.audio.encoder = aenc;
  s.audio.bitrateKbps = ENCODERS[aenc]?.lossless
    ? null
    : (preset.audioBitrate ?? ENCODERS[aenc]?.defaultBitrateKbps ?? null);
  if (presetId === 'web-optimised') s.audio.channels = 2;
  s.fastStart = presetId !== 'archive';
  return { settings: s, error: null };
}

export function listPresets(caps: FfmpegCapabilities | null): PresetDescriptor[] {
  return PRESET_DEFS.map((p) => {
    const formats = p.formats.filter((f) => resolvePreset(p.id, f, caps).settings !== null);
    const available = formats.length > 0;
    return {
      id: p.id,
      label: p.label,
      description: p.description,
      available,
      unavailableReason: available
        ? undefined
        : caps
          ? 'The required encoders or muxers are not in this FFmpeg build.'
          : 'FFmpeg is not available.',
      defaultFormat: formats.includes(p.defaultFormat)
        ? p.defaultFormat
        : (formats[0] ?? p.defaultFormat),
      formats,
    };
  });
}
