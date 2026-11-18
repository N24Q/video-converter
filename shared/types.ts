// Types shared between the Electron main process and the React renderer.
// Nothing in here may import Node or Electron modules.

export type StreamType = 'video' | 'audio' | 'subtitle' | 'data' | 'attachment' | 'unknown';

export interface MediaStream {
  index: number;
  type: StreamType;
  codec: string | null;
  codecLongName: string | null;
  profile: string | null;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isAttachedPic: boolean;
  // video
  width?: number;
  height?: number;
  pixFmt?: string | null;
  frameRate?: number | null;
  frameRateRaw?: string | null;
  fieldOrder?: string | null;
  interlaced?: boolean;
  rotation?: number;
  bitDepth?: number | null;
  // audio
  sampleRate?: number | null;
  channels?: number | null;
  channelLayout?: string | null;
  bitRate?: number | null;
}

export interface MediaInfo {
  path: string;
  formatName: string | null;
  formatLongName: string | null;
  duration: number | null;
  size: number | null;
  bitRate: number | null;
  startTime: number | null;
  creationTime: string | null;
  streams: MediaStream[];
  chapters: number;
}

export type MediaStatus = 'probing' | 'ready' | 'error';

export interface MediaItem {
  id: string;
  path: string;
  name: string;
  size: number | null;
  status: MediaStatus;
  info: MediaInfo | null;
  error: string | null;
  avchdSetId: string | null;
}

// ---------- capabilities ----------

export interface CodecEntry {
  name: string;
  description: string;
  type: 'video' | 'audio' | 'subtitle' | 'data' | 'unknown';
  codec: string; // the codec the encoder/decoder implements (e.g. libx264 -> h264)
  experimental: boolean;
}

export interface FormatEntry {
  name: string; // may be "matroska,webm" for demuxers
  description: string;
}

export interface ExecutableInfo {
  path: string;
  version: string | null;
}

export interface HwEncoderTest {
  encoder: string;
  method: string;
  ok: boolean;
  message: string;
}

export interface FfmpegCapabilities {
  ffmpeg: ExecutableInfo;
  ffprobe: ExecutableInfo;
  buildConfiguration: string | null;
  encoders: CodecEntry[];
  decoders: CodecEntry[];
  muxers: FormatEntry[];
  demuxers: FormatEntry[];
  hwaccels: string[];
  hwEncoderTests: HwEncoderTest[];
  discoveredAt: string;
}

export interface FfmpegStatus {
  ok: boolean;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  error: string | null;
  capabilities: FfmpegCapabilities | null;
}

// ---------- output formats & settings ----------

export type OutputKind = 'video' | 'audio';

export interface OutputFormat {
  id: string;
  label: string;
  muxer: string;
  extension: string;
  kind: OutputKind;
  available: boolean;
  notes?: string;
}

export type PresetId =
  | 'best-compatibility'
  | 'high-quality'
  | 'smaller-file'
  | 'stream-copy'
  | 'web-optimised'
  | 'archive'
  | 'audio-only';

export interface PresetDescriptor {
  id: PresetId;
  label: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
  defaultFormat: string;
  formats: string[]; // ids of formats this preset can target
}

export type ResolutionSetting =
  { mode: 'original' } | { mode: 'fit'; width: number; height: number };

export type FrameRateSetting = { mode: 'original' } | { mode: 'fixed'; fps: string };

export interface CropSetting {
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface VideoSettings {
  mode: 'encode' | 'copy' | 'none';
  encoder: string | null;
  quality: number | null; // CRF / qscale / qp depending on the encoder
  speedPreset: string | null;
  bitrateKbps: number | null;
  maxBitrateKbps: number | null;
  resolution: ResolutionSetting;
  stretch: boolean;
  frameRate: FrameRateSetting;
  deinterlace: 'auto' | 'on' | 'off';
  rotation: 'auto' | 'none' | 90 | 180 | 270;
  crop: CropSetting | null;
  pixFmt: string | null; // null = encoder-appropriate default
  hwaccel: 'none' | 'vaapi';
}

export interface AudioSettings {
  mode: 'encode' | 'copy' | 'none';
  encoder: string | null;
  bitrateKbps: number | null;
  sampleRate: number | null;
  channels: number | null;
}

export interface StreamSelection {
  // null = all streams of that kind. Otherwise a list of source stream indexes.
  audio: number[] | null;
  subtitle: number[] | null;
}

export interface ConversionSettings {
  presetId: PresetId | null;
  formatId: string;
  muxer: string;
  extension: string;
  video: VideoSettings;
  audio: AudioSettings;
  subtitles: 'auto' | 'copy' | 'convert' | 'remove';
  streams: StreamSelection;
  preserveMetadata: boolean;
  preserveChapters: boolean;
  fastStart: boolean;
  customArgs: string[];
}

export type StreamAction = 'encode' | 'copy' | 'convert' | 'drop';

export interface StreamPlanEntry {
  sourceIndex: number;
  type: StreamType;
  sourceCodec: string | null;
  action: StreamAction;
  targetCodec: string | null; // encoder name or 'copy'
  reason: string | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  plan: StreamPlanEntry[];
}

// ---------- jobs ----------

export type JobStatus =
  'waiting' | 'preparing' | 'converting' | 'completed' | 'failed' | 'cancelled';

export interface JobProgress {
  percent: number | null; // null = indeterminate
  outTimeSec: number | null;
  durationSec: number | null;
  speed: number | null;
  fps: number | null;
  elapsedSec: number;
  etaSec: number | null;
  sizeBytes: number | null;
}

export type ErrorKind =
  | 'ffmpeg-missing'
  | 'ffprobe-missing'
  | 'unsupported-input'
  | 'unsupported-combination'
  | 'unreadable-source'
  | 'permission-denied'
  | 'disk-full'
  | 'cancelled'
  | 'hw-encoder-failed'
  | 'output-validation-failed'
  | 'unexpected-termination'
  | 'unknown';

export interface JobError {
  kind: ErrorKind;
  message: string;
  details: string | null; // technical detail (stderr tail etc.)
}

export type JobMode = 'single' | 'concat';

export interface Job {
  id: string;
  mode: JobMode;
  sources: string[];
  sourceNames: string[];
  outputPath: string;
  settings: ConversionSettings;
  concatStrategy: 'demuxer' | 'normalise' | null;
  status: JobStatus;
  progress: JobProgress | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  error: JobError | null;
  warnings: string[];
  attempts: number;
  hwEncoderUsed: boolean;
}

export interface JobRequest {
  mediaIds: string[];
  mode: JobMode;
  settings: ConversionSettings;
  outputDir: string;
}

export interface AddJobsResult {
  added: Job[];
  rejected: { mediaIds: string[]; reason: string }[];
}

export interface HistoryEntry {
  id: string;
  mode: JobMode;
  sources: string[];
  outputPath: string;
  status: JobStatus;
  formatId: string;
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
}

// ---------- AVCHD ----------

export type ClipOrderMethod = 'playlist' | 'playlist-partial' | 'filename';

export interface AvchdClip {
  mediaId: string;
  name: string;
  path: string;
  playlistOrder: number | null;
  groupIndex: number;
  hasClipInfo: boolean;
  inTimeSec: number | null;
  outTimeSec: number | null;
}

export interface AvchdPlaylistInfo {
  name: string;
  clipNames: string[];
  valid: boolean;
  error: string | null;
}

export interface AvchdSet {
  id: string;
  rootPath: string;
  bdmvPath: string;
  hasIndex: boolean;
  hasMovieObject: boolean;
  playlists: AvchdPlaylistInfo[];
  clips: AvchdClip[];
  orderMethod: ClipOrderMethod;
  orderExplanation: string;
  warnings: string[];
}

export interface ImportResult {
  media: MediaItem[];
  avchdSets: AvchdSet[];
  messages: string[];
}

export interface ConcatCheck {
  compatible: boolean;
  differences: string[];
}

// ---------- settings ----------

export type ConflictBehaviour = 'unique' | 'overwrite' | 'ask';

export interface AppSettings {
  uiMode: 'simple' | 'advanced';
  defaultOutputDir: string | null;
  defaultFormatId: string;
  defaultPresetId: PresetId;
  defaultVideoEncoder: string | null;
  defaultAudioEncoder: string | null;
  defaultQuality: number | null;
  defaultResolution: ResolutionSetting;
  defaultFrameRate: FrameRateSetting;
  maxConcurrentJobs: number;
  hwaccelPreference: 'none' | 'vaapi';
  ffmpegPath: string | null;
  ffprobePath: string | null;
  conflictBehaviour: ConflictBehaviour;
  preserveMetadata: boolean;
  historyLimit: number;
}

export interface Diagnostics {
  appVersion: string;
  os: string;
  osRelease: string;
  arch: string;
  isCrostini: boolean;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  userDataPath: string;
  logPath: string;
  ffmpeg: FfmpegStatus;
  vaapiDevices: string[];
}

export interface PreviewResult {
  validation: ValidationResult;
  args: string[];
  outputName: string;
}
