// Validation of data arriving from the renderer over IPC. Everything coming
// from the renderer is treated as untrusted input.

import type { ConversionSettings, JobMode, PresetId } from '../../shared/types';
import { getFormatDef } from '../services/catalog';
import { frameRateArg } from '../services/args';

export class IpcValidationError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const NAME = /^[a-z0-9_.-]{1,64}$/i;

export function assertId(v: unknown, what = 'id'): string {
  if (typeof v !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(v))
    throw new IpcValidationError(`Invalid ${what}`);
  return v;
}

export function assertIdList(v: unknown, max = 500): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > max)
    throw new IpcValidationError('Invalid id list');
  return v.map((x) => assertId(x));
}

function optNum(
  v: unknown,
  min: number,
  max: number,
  field: string,
  integer = true,
): number | null {
  if (v === null || v === undefined) return null;
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer && !Number.isInteger(v))
  ) {
    throw new IpcValidationError(`Invalid ${field}`);
  }
  return v;
}

function optName(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || !NAME.test(v)) throw new IpcValidationError(`Invalid ${field}`);
  return v;
}

function oneOf<T extends string | number>(v: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(v as T)) throw new IpcValidationError(`Invalid ${field}`);
  return v as T;
}

function streamList(v: unknown, field: string): number[] | null {
  if (v === null || v === undefined) return null;
  if (
    !Array.isArray(v) ||
    v.length > 256 ||
    !v.every((x) => Number.isInteger(x) && x >= 0 && x < 10000)
  ) {
    throw new IpcValidationError(`Invalid ${field}`);
  }
  return v as number[];
}

const PRESETS: PresetId[] = [
  'best-compatibility',
  'high-quality',
  'smaller-file',
  'stream-copy',
  'web-optimised',
  'archive',
  'audio-only',
];

/**
 * Rebuild ConversionSettings from untrusted input, field by field. Muxer and
 * extension always come from the format catalogue, never from the renderer.
 */
export function sanitizeSettings(raw: unknown): ConversionSettings {
  if (!isObj(raw)) throw new IpcValidationError('Settings must be an object');
  const formatId = typeof raw.formatId === 'string' ? raw.formatId : '';
  const def = getFormatDef(formatId);
  if (!def) throw new IpcValidationError('Unknown output format');

  const v = isObj(raw.video) ? raw.video : {};
  const a = isObj(raw.audio) ? raw.audio : {};
  const st = isObj(raw.streams) ? raw.streams : {};

  let resolution: ConversionSettings['video']['resolution'] = { mode: 'original' };
  if (isObj(v.resolution) && v.resolution.mode === 'fit') {
    resolution = {
      mode: 'fit',
      width: optNum(v.resolution.width, 16, 16384, 'width') ?? 1920,
      height: optNum(v.resolution.height, 16, 16384, 'height') ?? 1080,
    };
  }
  let frameRate: ConversionSettings['video']['frameRate'] = { mode: 'original' };
  if (isObj(v.frameRate) && v.frameRate.mode === 'fixed') {
    const fps = v.frameRate.fps;
    if (typeof fps !== 'string' || !frameRateArg(fps))
      throw new IpcValidationError('Invalid frame rate');
    frameRate = { mode: 'fixed', fps };
  }
  let crop: ConversionSettings['video']['crop'] = null;
  if (isObj(v.crop)) {
    crop = {
      width: optNum(v.crop.width, 16, 16384, 'crop width') ?? 16,
      height: optNum(v.crop.height, 16, 16384, 'crop height') ?? 16,
      x: optNum(v.crop.x, 0, 16384, 'crop x') ?? 0,
      y: optNum(v.crop.y, 0, 16384, 'crop y') ?? 0,
    };
  }

  const customArgs = raw.customArgs ?? [];
  if (
    !Array.isArray(customArgs) ||
    customArgs.length > 64 ||
    !customArgs.every((x) => typeof x === 'string' && x.length <= 256)
  ) {
    throw new IpcValidationError('Invalid custom arguments');
  }

  const rotation = v.rotation ?? 'auto';
  return {
    presetId:
      raw.presetId === null || raw.presetId === undefined
        ? null
        : oneOf(raw.presetId, PRESETS, 'preset'),
    formatId: def.id,
    muxer: def.muxer,
    extension: def.extension,
    video: {
      mode: oneOf(v.mode ?? 'encode', ['encode', 'copy', 'none'] as const, 'video mode'),
      encoder: optName(v.encoder, 'video encoder'),
      quality: optNum(v.quality, 0, 255, 'quality', false),
      speedPreset: optName(v.speedPreset, 'speed preset'),
      bitrateKbps: optNum(v.bitrateKbps, 1, 500_000, 'video bitrate'),
      maxBitrateKbps: optNum(v.maxBitrateKbps, 1, 500_000, 'max bitrate'),
      resolution,
      stretch: v.stretch === true,
      frameRate,
      deinterlace: oneOf(v.deinterlace ?? 'auto', ['auto', 'on', 'off'] as const, 'deinterlace'),
      rotation: oneOf(
        rotation as string | number,
        ['auto', 'none', 90, 180, 270] as const,
        'rotation',
      ) as ConversionSettings['video']['rotation'],
      crop,
      pixFmt: optName(v.pixFmt, 'pixel format'),
      hwaccel: oneOf(v.hwaccel ?? 'none', ['none', 'vaapi'] as const, 'hwaccel'),
    },
    audio: {
      mode: oneOf(a.mode ?? 'encode', ['encode', 'copy', 'none'] as const, 'audio mode'),
      encoder: optName(a.encoder, 'audio encoder'),
      bitrateKbps: optNum(a.bitrateKbps, 8, 3_000, 'audio bitrate'),
      sampleRate: optNum(a.sampleRate, 8000, 384_000, 'sample rate'),
      channels: optNum(a.channels, 1, 8, 'channels'),
    },
    subtitles: oneOf(
      raw.subtitles ?? 'auto',
      ['auto', 'copy', 'convert', 'remove'] as const,
      'subtitles',
    ),
    streams: {
      audio: streamList(st.audio, 'audio streams'),
      subtitle: streamList(st.subtitle, 'subtitle streams'),
    },
    preserveMetadata: raw.preserveMetadata !== false,
    preserveChapters: raw.preserveChapters !== false,
    fastStart: raw.fastStart !== false,
    customArgs: customArgs as string[],
  };
}

export interface SanitizedJobRequest {
  mediaIds: string[];
  mode: JobMode;
  settings: ConversionSettings;
  outputDir: string;
}

export function sanitizeJobRequest(raw: unknown): SanitizedJobRequest {
  if (!isObj(raw)) throw new IpcValidationError('Invalid job request');
  const mode = oneOf(raw.mode, ['single', 'concat'] as const, 'mode');
  const mediaIds = assertIdList(raw.mediaIds, mode === 'concat' ? 500 : 1);
  if (mode === 'concat' && mediaIds.length < 2)
    throw new IpcValidationError('Combining needs at least two recordings');
  if (new Set(mediaIds).size !== mediaIds.length)
    throw new IpcValidationError('Duplicate recordings in request');
  if (typeof raw.outputDir !== 'string' || raw.outputDir.length > 4096)
    throw new IpcValidationError('Invalid output folder');
  return { mediaIds, mode, settings: sanitizeSettings(raw.settings), outputDir: raw.outputDir };
}
