// IPC channel names and the API surface exposed to the renderer via the
// preload script. The renderer only ever talks to the main process through
// these channels; it has no direct filesystem or process access.

import type {
  AddJobsResult,
  AppSettings,
  AvchdSet,
  ConcatCheck,
  ConversionSettings,
  Diagnostics,
  FfmpegStatus,
  HistoryEntry,
  ImportResult,
  Job,
  JobRequest,
  MediaItem,
  OutputFormat,
  PresetDescriptor,
  PresetId,
  PreviewResult,
} from './types';

export const IPC = {
  getDiagnostics: 'app:getDiagnostics',
  getFfmpegStatus: 'ffmpeg:getStatus',
  refreshFfmpeg: 'ffmpeg:refresh',
  getFormats: 'catalog:getFormats',
  getPresets: 'catalog:getPresets',
  resolvePreset: 'catalog:resolvePreset',
  openFiles: 'import:openFiles',
  openFolder: 'import:openFolder',
  importDropped: 'import:dropped',
  removeMedia: 'media:remove',
  clearMedia: 'media:clear',
  listMedia: 'media:list',
  checkConcat: 'avchd:checkConcat',
  chooseOutputDir: 'output:chooseDir',
  openOutputFolder: 'output:openFolder',
  preview: 'conversion:preview',
  addJobs: 'jobs:add',
  listJobs: 'jobs:list',
  cancelJob: 'jobs:cancel',
  retryJob: 'jobs:retry',
  retryJobSoftware: 'jobs:retrySoftware',
  removeJob: 'jobs:remove',
  clearFinished: 'jobs:clearFinished',
  getHistory: 'history:get',
  clearHistory: 'history:clear',
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  chooseExecutable: 'settings:chooseExecutable',
  // main -> renderer events
  evJobs: 'event:jobs',
  evMedia: 'event:media',
  evFfmpeg: 'event:ffmpeg',
} as const;

export interface VideoConverterApi {
  getDiagnostics(): Promise<Diagnostics>;
  getFfmpegStatus(): Promise<FfmpegStatus>;
  refreshFfmpeg(): Promise<FfmpegStatus>;
  getFormats(): Promise<OutputFormat[]>;
  getPresets(): Promise<PresetDescriptor[]>;
  resolvePreset(
    presetId: PresetId,
    formatId: string,
    mediaId: string | null,
  ): Promise<{ settings: ConversionSettings | null; error: string | null }>;
  openFiles(): Promise<ImportResult | null>;
  openFolder(): Promise<ImportResult | null>;
  importDropped(files: File[]): Promise<ImportResult>;
  removeMedia(id: string): Promise<void>;
  clearMedia(): Promise<void>;
  listMedia(): Promise<{ media: MediaItem[]; avchdSets: AvchdSet[] }>;
  checkConcat(mediaIds: string[]): Promise<ConcatCheck>;
  chooseOutputDir(): Promise<string | null>;
  openOutputFolder(jobId: string): Promise<void>;
  preview(mediaId: string, settings: ConversionSettings): Promise<PreviewResult>;
  addJobs(requests: JobRequest[]): Promise<AddJobsResult>;
  listJobs(): Promise<Job[]>;
  cancelJob(id: string): Promise<void>;
  retryJob(id: string): Promise<void>;
  retryJobSoftware(id: string): Promise<{ ok: boolean; message: string }>;
  removeJob(id: string): Promise<void>;
  clearFinished(): Promise<void>;
  getHistory(): Promise<HistoryEntry[]>;
  clearHistory(): Promise<void>;
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  chooseExecutable(kind: 'ffmpeg' | 'ffprobe'): Promise<string | null>;
  onJobs(cb: (jobs: Job[]) => void): () => void;
  onMedia(cb: (data: { media: MediaItem[]; avchdSets: AvchdSet[] }) => void): () => void;
  onFfmpeg(cb: (status: FfmpegStatus) => void): () => void;
}
