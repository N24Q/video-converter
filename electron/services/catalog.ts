import type {
  CodecEntry,
  EncoderOption,
  FfmpegCapabilities,
  OutputFormat,
  OutputKind,
} from '../../shared/types';
import { hasFormat } from './capabilities';

// ---------------------------------------------------------------------------
// Encoder knowledge. FFmpeg tells us which encoders exist, but not which
// rate-control options they accept, so this table records that. Encoders not
// listed here can still be used in advanced mode, just without quality/speed
// controls.
// ---------------------------------------------------------------------------

export interface QualityControl {
  kind: 'range' | 'enum';
  flag: string; // e.g. -crf, -q:v, -qp, -cq, -profile:v
  min?: number;
  max?: number;
  default: number;
  higherIsBetter?: boolean;
  label: string;
  choices?: { value: number; label: string; arg: string }[];
  extraArgs?: string[]; // args needed for the quality mode to apply (e.g. -b:v 0)
}

export interface EncoderInfo {
  codec: string;
  kind: 'video' | 'audio' | 'subtitle';
  label: string;
  quality?: QualityControl;
  speed?: { flag: string; values: string[]; default: string; label: string };
  pixFmt?: string; // preferred pixel format for broad compatibility
  pixFmt10?: string; // used when the source is >8-bit and the encoder handles it
  hw?: 'vaapi' | 'nvenc';
  lossless?: boolean;
  extraArgs?: string[];
  defaultBitrateKbps?: number;
  sampleRates?: number[];
  maxChannels?: number;
}

const X26X_PRESETS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
];

export const ENCODERS: Record<string, EncoderInfo> = {
  libx264: {
    codec: 'h264',
    kind: 'video',
    label: 'H.264 / AVC (x264)',
    quality: {
      kind: 'range',
      flag: '-crf',
      min: 0,
      max: 51,
      default: 21,
      label: 'CRF (lower = better)',
    },
    speed: { flag: '-preset', values: X26X_PRESETS, default: 'medium', label: 'Speed preset' },
    pixFmt: 'yuv420p',
  },
  libx265: {
    codec: 'hevc',
    kind: 'video',
    label: 'H.265 / HEVC (x265)',
    quality: {
      kind: 'range',
      flag: '-crf',
      min: 0,
      max: 51,
      default: 24,
      label: 'CRF (lower = better)',
    },
    speed: { flag: '-preset', values: X26X_PRESETS, default: 'medium', label: 'Speed preset' },
    pixFmt: 'yuv420p',
    pixFmt10: 'yuv420p10le',
    extraArgs: ['-tag:v', 'hvc1'],
  },
  libsvtav1: {
    codec: 'av1',
    kind: 'video',
    label: 'AV1 (SVT-AV1)',
    quality: {
      kind: 'range',
      flag: '-crf',
      min: 0,
      max: 63,
      default: 32,
      label: 'CRF (lower = better)',
    },
    speed: {
      flag: '-preset',
      values: ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      default: '8',
      label: 'Preset (lower = slower, better)',
    },
    pixFmt: 'yuv420p',
    pixFmt10: 'yuv420p10le',
  },
  'libaom-av1': {
    codec: 'av1',
    kind: 'video',
    label: 'AV1 (libaom, slow)',
    quality: {
      kind: 'range',
      flag: '-crf',
      min: 0,
      max: 63,
      default: 32,
      label: 'CRF (lower = better)',
      extraArgs: ['-b:v', '0'],
    },
    speed: {
      flag: '-cpu-used',
      values: ['2', '3', '4', '5', '6', '7', '8'],
      default: '6',
      label: 'CPU used (higher = faster)',
    },
    pixFmt: 'yuv420p',
    extraArgs: ['-row-mt', '1'],
  },
  'libvpx-vp9': {
    codec: 'vp9',
    kind: 'video',
    label: 'VP9 (libvpx)',
    quality: {
      kind: 'range',
      flag: '-crf',
      min: 0,
      max: 63,
      default: 32,
      label: 'CRF (lower = better)',
      extraArgs: ['-b:v', '0'],
    },
    speed: {
      flag: '-cpu-used',
      values: ['0', '1', '2', '3', '4', '5'],
      default: '3',
      label: 'CPU used (higher = faster)',
    },
    pixFmt: 'yuv420p',
    extraArgs: ['-row-mt', '1', '-deadline', 'good'],
  },
  libvpx: {
    codec: 'vp8',
    kind: 'video',
    label: 'VP8 (libvpx)',
    quality: {
      kind: 'range',
      flag: '-crf',
      min: 4,
      max: 63,
      default: 10,
      label: 'CRF (lower = better)',
    },
    pixFmt: 'yuv420p',
    defaultBitrateKbps: 4000, // VP8 CRF needs a bitrate ceiling
  },
  mpeg2video: {
    codec: 'mpeg2video',
    kind: 'video',
    label: 'MPEG-2 video',
    quality: {
      kind: 'range',
      flag: '-q:v',
      min: 1,
      max: 31,
      default: 3,
      label: 'Quantiser (lower = better)',
    },
    pixFmt: 'yuv420p',
  },
  mpeg1video: {
    codec: 'mpeg1video',
    kind: 'video',
    label: 'MPEG-1 video',
    quality: {
      kind: 'range',
      flag: '-q:v',
      min: 1,
      max: 31,
      default: 3,
      label: 'Quantiser (lower = better)',
    },
    pixFmt: 'yuv420p',
  },
  mpeg4: {
    codec: 'mpeg4',
    kind: 'video',
    label: 'MPEG-4 Part 2',
    quality: {
      kind: 'range',
      flag: '-q:v',
      min: 1,
      max: 31,
      default: 4,
      label: 'Quantiser (lower = better)',
    },
    pixFmt: 'yuv420p',
  },
  libxvid: {
    codec: 'mpeg4',
    kind: 'video',
    label: 'MPEG-4 Part 2 (Xvid)',
    quality: {
      kind: 'range',
      flag: '-q:v',
      min: 1,
      max: 31,
      default: 4,
      label: 'Quantiser (lower = better)',
    },
    pixFmt: 'yuv420p',
  },
  mjpeg: {
    codec: 'mjpeg',
    kind: 'video',
    label: 'Motion JPEG',
    quality: {
      kind: 'range',
      flag: '-q:v',
      min: 2,
      max: 31,
      default: 3,
      label: 'Quantiser (lower = better)',
    },
    pixFmt: 'yuvj420p',
  },
  libtheora: {
    codec: 'theora',
    kind: 'video',
    label: 'Theora',
    quality: {
      kind: 'range',
      flag: '-q:v',
      min: 0,
      max: 10,
      default: 7,
      higherIsBetter: true,
      label: 'Quality (higher = better)',
    },
    pixFmt: 'yuv420p',
  },
  prores_ks: {
    codec: 'prores',
    kind: 'video',
    label: 'Apple ProRes',
    quality: {
      kind: 'enum',
      flag: '-profile:v',
      default: 3,
      label: 'ProRes profile',
      choices: [
        { value: 0, label: 'Proxy', arg: '0' },
        { value: 1, label: 'LT', arg: '1' },
        { value: 2, label: 'Standard', arg: '2' },
        { value: 3, label: 'HQ', arg: '3' },
      ],
    },
    pixFmt: 'yuv422p10le',
  },
  dnxhd: {
    codec: 'dnxhd',
    kind: 'video',
    label: 'Avid DNxHR',
    quality: {
      kind: 'enum',
      flag: '-profile:v',
      default: 2,
      label: 'DNxHR profile',
      choices: [
        { value: 0, label: 'LB (low bandwidth)', arg: 'dnxhr_lb' },
        { value: 1, label: 'SQ (standard)', arg: 'dnxhr_sq' },
        { value: 2, label: 'HQ (high quality)', arg: 'dnxhr_hq' },
      ],
    },
    pixFmt: 'yuv422p',
  },
  ffv1: {
    codec: 'ffv1',
    kind: 'video',
    label: 'FFV1 (lossless)',
    lossless: true,
    extraArgs: ['-level', '3', '-g', '1', '-slicecrc', '1'],
  },
  huffyuv: {
    codec: 'huffyuv',
    kind: 'video',
    label: 'HuffYUV (lossless)',
    lossless: true,
    pixFmt: 'yuv422p',
  },
  dvvideo: { codec: 'dvvideo', kind: 'video', label: 'DV video' },
  wmv2: {
    codec: 'wmv2',
    kind: 'video',
    label: 'Windows Media Video 8',
    defaultBitrateKbps: 4000,
    pixFmt: 'yuv420p',
  },
  msmpeg4: {
    codec: 'msmpeg4v3',
    kind: 'video',
    label: 'MS MPEG-4 v3',
    defaultBitrateKbps: 4000,
    pixFmt: 'yuv420p',
  },
  flv: {
    codec: 'flv1',
    kind: 'video',
    label: 'Sorenson Spark (FLV1)',
    defaultBitrateKbps: 2000,
    pixFmt: 'yuv420p',
  },
  wrapped_avframe: { codec: 'wrapped_avframe', kind: 'video', label: 'Uncompressed (Y4M)' },
  rawvideo: { codec: 'rawvideo', kind: 'video', label: 'Uncompressed' },
  h264_vaapi: {
    codec: 'h264',
    kind: 'video',
    label: 'H.264 (VAAPI hardware)',
    hw: 'vaapi',
    quality: {
      kind: 'range',
      flag: '-qp',
      min: 1,
      max: 51,
      default: 24,
      label: 'QP (lower = better)',
    },
  },
  hevc_vaapi: {
    codec: 'hevc',
    kind: 'video',
    label: 'HEVC (VAAPI hardware)',
    hw: 'vaapi',
    quality: {
      kind: 'range',
      flag: '-qp',
      min: 1,
      max: 51,
      default: 26,
      label: 'QP (lower = better)',
    },
    extraArgs: ['-tag:v', 'hvc1'],
  },
  av1_vaapi: {
    codec: 'av1',
    kind: 'video',
    label: 'AV1 (VAAPI hardware)',
    hw: 'vaapi',
    defaultBitrateKbps: 6000,
  },
  vp9_vaapi: {
    codec: 'vp9',
    kind: 'video',
    label: 'VP9 (VAAPI hardware)',
    hw: 'vaapi',
    defaultBitrateKbps: 6000,
  },
  h264_nvenc: {
    codec: 'h264',
    kind: 'video',
    label: 'H.264 (NVIDIA NVENC)',
    hw: 'nvenc',
    quality: {
      kind: 'range',
      flag: '-cq',
      min: 1,
      max: 51,
      default: 23,
      label: 'CQ (lower = better)',
      extraArgs: ['-b:v', '0'],
    },
    pixFmt: 'yuv420p',
  },
  hevc_nvenc: {
    codec: 'hevc',
    kind: 'video',
    label: 'HEVC (NVIDIA NVENC)',
    hw: 'nvenc',
    quality: {
      kind: 'range',
      flag: '-cq',
      min: 1,
      max: 51,
      default: 25,
      label: 'CQ (lower = better)',
      extraArgs: ['-b:v', '0'],
    },
    pixFmt: 'yuv420p',
    extraArgs: ['-tag:v', 'hvc1'],
  },
  av1_nvenc: {
    codec: 'av1',
    kind: 'video',
    label: 'AV1 (NVIDIA NVENC)',
    hw: 'nvenc',
    quality: {
      kind: 'range',
      flag: '-cq',
      min: 1,
      max: 63,
      default: 32,
      label: 'CQ (lower = better)',
      extraArgs: ['-b:v', '0'],
    },
    pixFmt: 'yuv420p',
  },

  // audio
  aac: { codec: 'aac', kind: 'audio', label: 'AAC', defaultBitrateKbps: 192, maxChannels: 8 },
  libfdk_aac: {
    codec: 'aac',
    kind: 'audio',
    label: 'AAC (Fraunhofer FDK)',
    defaultBitrateKbps: 192,
    maxChannels: 8,
  },
  libmp3lame: {
    codec: 'mp3',
    kind: 'audio',
    label: 'MP3 (LAME)',
    defaultBitrateKbps: 192,
    maxChannels: 2,
    sampleRates: [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000],
  },
  libopus: {
    codec: 'opus',
    kind: 'audio',
    label: 'Opus',
    defaultBitrateKbps: 160,
    sampleRates: [48000, 24000, 16000, 12000, 8000],
    maxChannels: 8,
  },
  libvorbis: {
    codec: 'vorbis',
    kind: 'audio',
    label: 'Vorbis',
    defaultBitrateKbps: 192,
    maxChannels: 8,
  },
  flac: { codec: 'flac', kind: 'audio', label: 'FLAC (lossless)', lossless: true, maxChannels: 8 },
  alac: {
    codec: 'alac',
    kind: 'audio',
    label: 'ALAC (Apple lossless)',
    lossless: true,
    maxChannels: 8,
  },
  ac3: {
    codec: 'ac3',
    kind: 'audio',
    label: 'Dolby Digital (AC-3)',
    defaultBitrateKbps: 384,
    sampleRates: [48000, 44100, 32000],
    maxChannels: 6,
  },
  eac3: {
    codec: 'eac3',
    kind: 'audio',
    label: 'Dolby Digital Plus (E-AC-3)',
    defaultBitrateKbps: 384,
    sampleRates: [48000, 44100, 32000],
    maxChannels: 6,
  },
  mp2: {
    codec: 'mp2',
    kind: 'audio',
    label: 'MPEG audio layer 2',
    defaultBitrateKbps: 224,
    sampleRates: [48000, 44100, 32000, 24000, 22050, 16000],
    maxChannels: 2,
  },
  wmav2: {
    codec: 'wmav2',
    kind: 'audio',
    label: 'Windows Media Audio 2',
    defaultBitrateKbps: 192,
    maxChannels: 2,
  },
  pcm_s16le: { codec: 'pcm_s16le', kind: 'audio', label: 'PCM 16-bit', lossless: true },
  pcm_s24le: { codec: 'pcm_s24le', kind: 'audio', label: 'PCM 24-bit', lossless: true },
  pcm_s16be: {
    codec: 'pcm_s16be',
    kind: 'audio',
    label: 'PCM 16-bit (big-endian)',
    lossless: true,
  },
  pcm_s24be: {
    codec: 'pcm_s24be',
    kind: 'audio',
    label: 'PCM 24-bit (big-endian)',
    lossless: true,
  },
};

// ---------------------------------------------------------------------------
// Containers: which codecs each muxer can hold. '*' = anything except the
// deny list. Used to validate copies and encoder choices up front so users
// get an explanation rather than a cryptic FFmpeg failure.
// ---------------------------------------------------------------------------

export interface ContainerRule {
  video: string[] | '*';
  audio: string[] | '*';
  subtitle: string[];
  textSubtitleEncoder: string | null; // encoder used to convert text subs
  deny?: string[];
  supportsChapters: boolean;
  fastStart?: boolean;
  extraArgs?: string[];
  maxAudioStreams?: number;
  maxVideoStreams?: number;
}

const MP4_VIDEO = ['h264', 'hevc', 'av1', 'mpeg4', 'mpeg2video', 'mpeg1video', 'vp9', 'mjpeg'];
const MP4_AUDIO = ['aac', 'mp3', 'ac3', 'eac3', 'opus', 'flac', 'alac', 'mp2'];

export const CONTAINERS: Record<string, ContainerRule> = {
  mp4: {
    video: MP4_VIDEO,
    audio: MP4_AUDIO,
    subtitle: ['mov_text'],
    textSubtitleEncoder: 'mov_text',
    supportsChapters: true,
    fastStart: true,
  },
  mov: {
    video: [
      'h264',
      'hevc',
      'mpeg4',
      'mpeg2video',
      'mpeg1video',
      'prores',
      'dnxhd',
      'mjpeg',
      'av1',
      'rawvideo',
      'png',
      'qtrle',
    ],
    audio: [
      'aac',
      'mp3',
      'ac3',
      'eac3',
      'alac',
      'pcm_s16le',
      'pcm_s24le',
      'pcm_s16be',
      'pcm_s24be',
    ],
    subtitle: ['mov_text'],
    textSubtitleEncoder: 'mov_text',
    supportsChapters: true,
    fastStart: true,
  },
  ipod: {
    video: ['h264'],
    audio: ['aac', 'alac'],
    subtitle: ['mov_text'],
    textSubtitleEncoder: 'mov_text',
    supportsChapters: true,
    fastStart: true,
  },
  '3gp': {
    video: ['h264', 'mpeg4', 'h263'],
    audio: ['aac', 'amr_nb'],
    subtitle: ['mov_text'],
    textSubtitleEncoder: 'mov_text',
    supportsChapters: false,
    fastStart: true,
  },
  '3g2': {
    video: ['h264', 'mpeg4', 'h263'],
    audio: ['aac', 'amr_nb'],
    subtitle: ['mov_text'],
    textSubtitleEncoder: 'mov_text',
    supportsChapters: false,
    fastStart: true,
  },
  matroska: {
    video: '*',
    audio: '*',
    subtitle: [
      'subrip',
      'ass',
      'ssa',
      'webvtt',
      'hdmv_pgs_subtitle',
      'dvd_subtitle',
      'dvb_subtitle',
      'text',
    ],
    textSubtitleEncoder: 'srt',
    deny: ['pcm_bluray', 'pcm_dvd', 'wrapped_avframe', 'mov_text'],
    supportsChapters: true,
  },
  webm: {
    video: ['vp8', 'vp9', 'av1'],
    audio: ['vorbis', 'opus'],
    subtitle: ['webvtt'],
    textSubtitleEncoder: 'webvtt',
    supportsChapters: true,
  },
  avi: {
    video: [
      'h264',
      'mpeg4',
      'mjpeg',
      'mpeg2video',
      'mpeg1video',
      'huffyuv',
      'ffv1',
      'msmpeg4v3',
      'msmpeg4v2',
      'rawvideo',
      'dvvideo',
    ],
    audio: ['mp3', 'ac3', 'pcm_s16le', 'pcm_s24le', 'mp2', 'aac'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
  },
  mpegts: {
    video: ['h264', 'hevc', 'mpeg2video', 'mpeg1video'],
    audio: ['aac', 'mp3', 'ac3', 'eac3', 'mp2', 'opus'],
    subtitle: ['dvb_subtitle'],
    textSubtitleEncoder: null,
    supportsChapters: false,
  },
  mpeg: {
    video: ['mpeg1video', 'mpeg2video'],
    audio: ['mp2', 'mp3', 'ac3'],
    subtitle: ['dvd_subtitle'],
    textSubtitleEncoder: null,
    supportsChapters: false,
  },
  vob: {
    video: ['mpeg2video'],
    audio: ['ac3', 'mp2'],
    subtitle: ['dvd_subtitle'],
    textSubtitleEncoder: null,
    supportsChapters: false,
  },
  mxf: {
    video: ['dnxhd', 'mpeg2video'],
    audio: ['pcm_s16le', 'pcm_s24le'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
    maxVideoStreams: 1,
  },
  asf: {
    video: ['wmv2', 'wmv1', 'msmpeg4v3'],
    audio: ['wmav2', 'wmav1', 'mp3'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
  },
  flv: {
    video: ['h264', 'flv1'],
    audio: ['aac', 'mp3'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
    maxAudioStreams: 1,
    maxVideoStreams: 1,
  },
  ogg: {
    video: ['theora', 'vp8'],
    audio: ['vorbis', 'opus', 'flac'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: true,
  },
  dv: {
    video: ['dvvideo'],
    audio: ['pcm_s16le'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
    maxAudioStreams: 1,
    maxVideoStreams: 1,
  },
  yuv4mpegpipe: {
    video: ['wrapped_avframe', 'rawvideo'],
    audio: [],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
    maxVideoStreams: 1,
  },
  // audio-only containers
  mp3: {
    video: [],
    audio: ['mp3'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: true,
    maxAudioStreams: 1,
  },
  adts: {
    video: [],
    audio: ['aac'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
    maxAudioStreams: 1,
  },
  wav: {
    video: [],
    audio: ['pcm_s16le', 'pcm_s24le', 'pcm_u8', 'pcm_f32le', 'pcm_s32le'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
    maxAudioStreams: 1,
  },
  flac: {
    video: [],
    audio: ['flac'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
    maxAudioStreams: 1,
  },
  opus: {
    video: [],
    audio: ['opus'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
  },
  aiff: {
    video: [],
    audio: ['pcm_s16be', 'pcm_s24be'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
    maxAudioStreams: 1,
  },
  ac3: {
    video: [],
    audio: ['ac3'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
    maxAudioStreams: 1,
  },
  eac3: {
    video: [],
    audio: ['eac3'],
    subtitle: [],
    textSubtitleEncoder: null,
    supportsChapters: false,
    maxAudioStreams: 1,
  },
};

// ---------------------------------------------------------------------------
// User-facing output formats. Each maps to a muxer and a file extension and
// lists encoders to prefer, in order.
// ---------------------------------------------------------------------------

export interface FormatDef {
  id: string;
  label: string;
  muxer: string;
  extension: string;
  kind: OutputKind;
  video: string[];
  audio: string[];
  notes?: string;
  muxerArgs?: string[];
}

export const FORMAT_DEFS: FormatDef[] = [
  {
    id: 'mp4',
    label: 'MP4',
    muxer: 'mp4',
    extension: 'mp4',
    kind: 'video',
    video: ['libx264', 'libx265', 'libsvtav1', 'libaom-av1', 'mpeg4'],
    audio: ['aac', 'libfdk_aac', 'libmp3lame', 'ac3'],
  },
  {
    id: 'mkv',
    label: 'Matroska (MKV)',
    muxer: 'matroska',
    extension: 'mkv',
    kind: 'video',
    video: ['libx264', 'libx265', 'libsvtav1', 'libvpx-vp9', 'ffv1'],
    audio: ['aac', 'libopus', 'flac', 'ac3'],
    notes: 'Most flexible container; holds almost any codec and multiple audio/subtitle tracks.',
  },
  {
    id: 'mov',
    label: 'QuickTime (MOV)',
    muxer: 'mov',
    extension: 'mov',
    kind: 'video',
    video: ['libx264', 'prores_ks', 'libx265', 'dnxhd'],
    audio: ['aac', 'pcm_s16le', 'pcm_s24le', 'alac'],
  },
  {
    id: 'webm',
    label: 'WebM',
    muxer: 'webm',
    extension: 'webm',
    kind: 'video',
    video: ['libvpx-vp9', 'libsvtav1', 'libaom-av1', 'libvpx'],
    audio: ['libopus', 'libvorbis'],
  },
  {
    id: 'm4v',
    label: 'M4V',
    muxer: 'mp4',
    extension: 'm4v',
    kind: 'video',
    video: ['libx264', 'libx265'],
    audio: ['aac', 'libfdk_aac'],
  },
  {
    id: 'avi',
    label: 'AVI',
    muxer: 'avi',
    extension: 'avi',
    kind: 'video',
    video: ['mpeg4', 'libxvid', 'libx264', 'mjpeg'],
    audio: ['libmp3lame', 'ac3', 'pcm_s16le'],
  },
  {
    id: 'ts',
    label: 'MPEG-TS (.ts)',
    muxer: 'mpegts',
    extension: 'ts',
    kind: 'video',
    video: ['libx264', 'libx265', 'mpeg2video'],
    audio: ['aac', 'ac3', 'mp2'],
  },
  {
    id: 'm2ts',
    label: 'M2TS (BDAV transport stream)',
    muxer: 'mpegts',
    extension: 'm2ts',
    kind: 'video',
    video: ['libx264', 'mpeg2video'],
    audio: ['ac3', 'aac'],
    muxerArgs: ['-mpegts_m2ts_mode', '1'],
  },
  {
    id: 'mts',
    label: 'MTS (AVCHD-style transport stream)',
    muxer: 'mpegts',
    extension: 'mts',
    kind: 'video',
    video: ['libx264', 'mpeg2video'],
    audio: ['ac3', 'aac'],
    muxerArgs: ['-mpegts_m2ts_mode', '1'],
    notes: 'Produces a standalone .mts file, not an AVCHD disc structure.',
  },
  {
    id: 'mpg',
    label: 'MPEG-PS (.mpg)',
    muxer: 'mpeg',
    extension: 'mpg',
    kind: 'video',
    video: ['mpeg2video', 'mpeg1video'],
    audio: ['mp2', 'ac3'],
  },
  {
    id: 'mpeg',
    label: 'MPEG-PS (.mpeg)',
    muxer: 'mpeg',
    extension: 'mpeg',
    kind: 'video',
    video: ['mpeg2video', 'mpeg1video'],
    audio: ['mp2', 'ac3'],
  },
  {
    id: 'vob',
    label: 'DVD VOB',
    muxer: 'vob',
    extension: 'vob',
    kind: 'video',
    video: ['mpeg2video'],
    audio: ['ac3', 'mp2'],
    notes: 'Creates a single VOB file, not an authored DVD.',
  },
  {
    id: 'mxf',
    label: 'MXF',
    muxer: 'mxf',
    extension: 'mxf',
    kind: 'video',
    video: ['dnxhd', 'mpeg2video'],
    audio: ['pcm_s16le', 'pcm_s24le'],
    notes:
      'MXF is strict about codec parameters; DNxHR with PCM audio is the most reliable combination.',
  },
  {
    id: 'wmv',
    label: 'Windows Media (WMV)',
    muxer: 'asf',
    extension: 'wmv',
    kind: 'video',
    video: ['wmv2', 'msmpeg4'],
    audio: ['wmav2'],
  },
  {
    id: 'asf',
    label: 'ASF',
    muxer: 'asf',
    extension: 'asf',
    kind: 'video',
    video: ['wmv2', 'msmpeg4'],
    audio: ['wmav2'],
  },
  {
    id: 'flv',
    label: 'Flash Video (FLV)',
    muxer: 'flv',
    extension: 'flv',
    kind: 'video',
    video: ['libx264', 'flv'],
    audio: ['aac', 'libmp3lame'],
  },
  {
    id: 'ogv',
    label: 'Ogg Video (OGV)',
    muxer: 'ogg',
    extension: 'ogv',
    kind: 'video',
    video: ['libtheora', 'libvpx'],
    audio: ['libvorbis', 'libopus'],
  },
  {
    id: '3gp',
    label: '3GP',
    muxer: '3gp',
    extension: '3gp',
    kind: 'video',
    video: ['libx264', 'mpeg4'],
    audio: ['aac'],
  },
  {
    id: '3g2',
    label: '3G2',
    muxer: '3g2',
    extension: '3g2',
    kind: 'video',
    video: ['libx264', 'mpeg4'],
    audio: ['aac'],
  },
  {
    id: 'dv',
    label: 'DV',
    muxer: 'dv',
    extension: 'dv',
    kind: 'video',
    video: ['dvvideo'],
    audio: ['pcm_s16le'],
    notes:
      'DV is standard-definition only: output is scaled to 720x576 (PAL, 25 fps) or 720x480 (NTSC, 29.97 fps).',
  },
  {
    id: 'y4m',
    label: 'YUV4MPEG (Y4M, uncompressed)',
    muxer: 'yuv4mpegpipe',
    extension: 'y4m',
    kind: 'video',
    video: ['wrapped_avframe', 'rawvideo'],
    audio: [],
    notes: 'Uncompressed video only, no audio. Files are extremely large.',
  },
  // audio
  {
    id: 'mp3',
    label: 'MP3',
    muxer: 'mp3',
    extension: 'mp3',
    kind: 'audio',
    video: [],
    audio: ['libmp3lame'],
  },
  {
    id: 'm4a',
    label: 'M4A (AAC)',
    muxer: 'ipod',
    extension: 'm4a',
    kind: 'audio',
    video: [],
    audio: ['aac', 'libfdk_aac', 'alac'],
  },
  {
    id: 'aac',
    label: 'AAC (raw ADTS)',
    muxer: 'adts',
    extension: 'aac',
    kind: 'audio',
    video: [],
    audio: ['aac', 'libfdk_aac'],
  },
  {
    id: 'wav',
    label: 'WAV',
    muxer: 'wav',
    extension: 'wav',
    kind: 'audio',
    video: [],
    audio: ['pcm_s16le', 'pcm_s24le'],
  },
  {
    id: 'flac',
    label: 'FLAC',
    muxer: 'flac',
    extension: 'flac',
    kind: 'audio',
    video: [],
    audio: ['flac'],
  },
  {
    id: 'ogg',
    label: 'Ogg Vorbis',
    muxer: 'ogg',
    extension: 'ogg',
    kind: 'audio',
    video: [],
    audio: ['libvorbis', 'libopus', 'flac'],
  },
  {
    id: 'opus',
    label: 'Opus',
    muxer: 'opus',
    extension: 'opus',
    kind: 'audio',
    video: [],
    audio: ['libopus'],
  },
  {
    id: 'wma',
    label: 'Windows Media Audio (WMA)',
    muxer: 'asf',
    extension: 'wma',
    kind: 'audio',
    video: [],
    audio: ['wmav2'],
  },
  {
    id: 'aiff',
    label: 'AIFF',
    muxer: 'aiff',
    extension: 'aiff',
    kind: 'audio',
    video: [],
    audio: ['pcm_s16be', 'pcm_s24be'],
  },
  {
    id: 'ac3',
    label: 'AC-3',
    muxer: 'ac3',
    extension: 'ac3',
    kind: 'audio',
    video: [],
    audio: ['ac3'],
  },
  {
    id: 'eac3',
    label: 'E-AC-3',
    muxer: 'eac3',
    extension: 'eac3',
    kind: 'audio',
    video: [],
    audio: ['eac3'],
  },
];

export function getFormatDef(id: string): FormatDef | undefined {
  return FORMAT_DEFS.find((f) => f.id === id);
}

/** Input file extensions offered in the open dialog (probing decides validity). */
export const INPUT_EXTENSIONS = [
  'mpg',
  'mpeg',
  'mpe',
  'mts',
  'm2ts',
  'm2t',
  'ts',
  'vob',
  'mxf',
  'mp4',
  'm4v',
  'mp4v',
  'mov',
  'qt',
  'mkv',
  'avi',
  'wmv',
  'asf',
  'webm',
  'flv',
  'ogv',
  'ogg',
  '3gp',
  '3g2',
  'dv',
  'y4m',
  'mp3',
  'wav',
  'aac',
  'flac',
  'opus',
  'm4a',
  'wma',
  'aiff',
  'aif',
  'ac3',
  'eac3',
  'mka',
  'oga',
  'divx',
  'f4v',
  'rm',
  'rmvb',
  'mod',
  'tod',
  'h264',
  'h265',
  'hevc',
  'amr',
  'ape',
  'wv',
  'caf',
];

export function hasEncoder(caps: FfmpegCapabilities | null, name: string): boolean {
  return !!caps?.encoders.some((e) => e.name === name);
}

/** Hardware encoders need a passing self-test before we offer them. */
export function isEncoderUsable(caps: FfmpegCapabilities | null, name: string): boolean {
  if (!hasEncoder(caps, name)) return false;
  const info = ENCODERS[name];
  if (info?.hw) return !!caps?.hwEncoderTests.some((t) => t.encoder === name && t.ok);
  return true;
}

export function firstUsable(caps: FfmpegCapabilities | null, names: string[]): string | null {
  return names.find((n) => isEncoderUsable(caps, n)) ?? null;
}

export function encoderCodec(caps: FfmpegCapabilities | null, name: string): string | null {
  const known = ENCODERS[name]?.codec;
  if (known) return known;
  return caps?.encoders.find((e) => e.name === name)?.codec ?? null;
}

export function containerAllows(
  muxer: string,
  type: 'video' | 'audio' | 'subtitle',
  codec: string | null,
): boolean | null {
  const rule = CONTAINERS[muxer];
  if (!rule) return null; // unknown: let FFmpeg decide
  if (!codec) return false;
  if (rule.deny?.includes(codec)) return false;
  const list = rule[type];
  if (list === '*') return true;
  return list.includes(codec);
}

export function getFormats(caps: FfmpegCapabilities | null): OutputFormat[] {
  return FORMAT_DEFS.map((f) => {
    const muxerOk = !!caps && hasFormat(caps.muxers, f.muxer);
    const vOk = f.kind === 'audio' || f.video.some((e) => isEncoderUsable(caps, e));
    const aOk = f.audio.length === 0 || f.audio.some((e) => isEncoderUsable(caps, e));
    const available = muxerOk && vOk && aOk;
    let notes = f.notes;
    if (!available && caps) {
      notes = !muxerOk
        ? `This FFmpeg build has no "${f.muxer}" muxer.`
        : !vOk
          ? 'No suitable video encoder in this FFmpeg build.'
          : 'No suitable audio encoder in this FFmpeg build.';
    }
    const rule = CONTAINERS[f.muxer];
    const list = (l: string[] | '*' | undefined) => (!l || l === '*' ? null : l);
    return {
      id: f.id,
      label: f.label,
      muxer: f.muxer,
      extension: f.extension,
      kind: f.kind,
      available,
      notes,
      videoCodecs: list(rule?.video),
      audioCodecs: list(rule?.audio),
    };
  });
}

/** Encoders FFmpeg reports for a type, restricted to usable ones. */
export function usableEncoders(
  caps: FfmpegCapabilities | null,
  type: CodecEntry['type'],
): CodecEntry[] {
  if (!caps) return [];
  return caps.encoders.filter((e) => e.type === type && isEncoderUsable(caps, e.name));
}

export const TEXT_SUBTITLE_CODECS = [
  'subrip',
  'ass',
  'ssa',
  'webvtt',
  'mov_text',
  'text',
  'microdvd',
  'subviewer',
  'sami',
  'jacosub',
  'realtext',
  'stl',
  'mpl2',
  'vplayer',
  'pjs',
];
export const BITMAP_SUBTITLE_CODECS = [
  'hdmv_pgs_subtitle',
  'dvd_subtitle',
  'dvb_subtitle',
  'xsub',
  'dvb_teletext',
];

/** Usable video/audio encoders with the controls the UI should offer. */
export function getEncoderOptions(caps: FfmpegCapabilities | null): EncoderOption[] {
  if (!caps) return [];
  return caps.encoders
    .filter((e) => (e.type === 'video' || e.type === 'audio') && isEncoderUsable(caps, e.name))
    .map((e) => {
      const info = ENCODERS[e.name];
      return {
        name: e.name,
        label: info?.label ?? `${e.name} — ${e.description}`,
        type: e.type as 'video' | 'audio',
        codec: info?.codec ?? e.codec,
        hw: info?.hw ?? null,
        lossless: !!info?.lossless,
        quality: info?.quality
          ? {
              kind: info.quality.kind,
              min: info.quality.min,
              max: info.quality.max,
              default: info.quality.default,
              label: info.quality.label,
              choices: info.quality.choices?.map((c) => ({ value: c.value, label: c.label })),
            }
          : null,
        speed: info?.speed
          ? { values: info.speed.values, default: info.speed.default, label: info.speed.label }
          : null,
        defaultBitrateKbps: info?.defaultBitrateKbps ?? null,
      };
    })
    .sort(
      (a, b) =>
        Number(!ENCODERS[a.name]) - Number(!ENCODERS[b.name]) || a.label.localeCompare(b.label),
    );
}
