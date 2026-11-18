import path from 'node:path';
import type {
  AppSettings,
  FrameRateSetting,
  PresetId,
  ResolutionSetting,
} from '../../shared/types';
import { FORMAT_DEFS } from './catalog';
import { readJson, writeJsonAtomic, WriteChain } from './jsonFile';
import { frameRateArg } from './args';

export const DEFAULT_SETTINGS: AppSettings = {
  uiMode: 'simple',
  defaultOutputDir: null,
  defaultFormatId: 'mp4',
  defaultPresetId: 'best-compatibility',
  defaultVideoEncoder: null,
  defaultAudioEncoder: null,
  defaultQuality: null,
  defaultResolution: { mode: 'original' },
  defaultFrameRate: { mode: 'original' },
  maxConcurrentJobs: 1,
  hwaccelPreference: 'none',
  ffmpegPath: null,
  ffprobePath: null,
  conflictBehaviour: 'unique',
  preserveMetadata: true,
  historyLimit: 200,
};

const PRESET_IDS: PresetId[] = [
  'best-compatibility',
  'high-quality',
  'smaller-file',
  'stream-copy',
  'web-optimised',
  'archive',
  'audio-only',
];

const isStr = (v: unknown): v is string => typeof v === 'string';
const isAbs = (v: unknown): v is string =>
  isStr(v) && path.isAbsolute(v) && v.length < 4096 && !v.includes('\0');
const isName = (v: unknown): v is string => isStr(v) && /^[a-z0-9_-]{1,64}$/i.test(v);

function validResolution(v: unknown): ResolutionSetting | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.mode === 'original') return { mode: 'original' };
  if (r.mode === 'fit' && Number.isInteger(r.width) && Number.isInteger(r.height)) {
    const w = r.width as number;
    const h = r.height as number;
    if (w >= 16 && h >= 16 && w <= 16384 && h <= 16384) return { mode: 'fit', width: w, height: h };
  }
  return null;
}

function validFrameRate(v: unknown): FrameRateSetting | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.mode === 'original') return { mode: 'original' };
  if (r.mode === 'fixed' && isStr(r.fps) && frameRateArg(r.fps))
    return { mode: 'fixed', fps: r.fps };
  return null;
}

/**
 * Validate a (partial) settings object field by field. Invalid fields are
 * dropped (so the base value is kept) and reported.
 */
export function validateSettingsPatch(raw: unknown): {
  patch: Partial<AppSettings>;
  invalid: string[];
} {
  const patch: Partial<AppSettings> = {};
  const invalid: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { patch, invalid: ['(root)'] };
  const r = raw as Record<string, unknown>;
  const check = <K extends keyof AppSettings>(key: K, ok: boolean, value: AppSettings[K]) => {
    if (!(key in r)) return;
    if (ok) patch[key] = value;
    else invalid.push(key);
  };
  check(
    'uiMode',
    r.uiMode === 'simple' || r.uiMode === 'advanced',
    r.uiMode as AppSettings['uiMode'],
  );
  check(
    'defaultOutputDir',
    r.defaultOutputDir === null || isAbs(r.defaultOutputDir),
    r.defaultOutputDir as string | null,
  );
  check(
    'defaultFormatId',
    isStr(r.defaultFormatId) && FORMAT_DEFS.some((f) => f.id === r.defaultFormatId),
    r.defaultFormatId as string,
  );
  check(
    'defaultPresetId',
    PRESET_IDS.includes(r.defaultPresetId as PresetId),
    r.defaultPresetId as PresetId,
  );
  check(
    'defaultVideoEncoder',
    r.defaultVideoEncoder === null || isName(r.defaultVideoEncoder),
    r.defaultVideoEncoder as string | null,
  );
  check(
    'defaultAudioEncoder',
    r.defaultAudioEncoder === null || isName(r.defaultAudioEncoder),
    r.defaultAudioEncoder as string | null,
  );
  check(
    'defaultQuality',
    r.defaultQuality === null ||
      (typeof r.defaultQuality === 'number' && r.defaultQuality >= 0 && r.defaultQuality <= 100),
    r.defaultQuality as number | null,
  );
  const res = validResolution(r.defaultResolution);
  check('defaultResolution', !!res, res!);
  const fr = validFrameRate(r.defaultFrameRate);
  check('defaultFrameRate', !!fr, fr!);
  check(
    'maxConcurrentJobs',
    Number.isInteger(r.maxConcurrentJobs) &&
      (r.maxConcurrentJobs as number) >= 1 &&
      (r.maxConcurrentJobs as number) <= 8,
    r.maxConcurrentJobs as number,
  );
  check(
    'hwaccelPreference',
    r.hwaccelPreference === 'none' || r.hwaccelPreference === 'vaapi',
    r.hwaccelPreference as 'none' | 'vaapi',
  );
  check('ffmpegPath', r.ffmpegPath === null || isAbs(r.ffmpegPath), r.ffmpegPath as string | null);
  check(
    'ffprobePath',
    r.ffprobePath === null || isAbs(r.ffprobePath),
    r.ffprobePath as string | null,
  );
  check(
    'conflictBehaviour',
    r.conflictBehaviour === 'unique' ||
      r.conflictBehaviour === 'overwrite' ||
      r.conflictBehaviour === 'ask',
    r.conflictBehaviour as AppSettings['conflictBehaviour'],
  );
  check('preserveMetadata', typeof r.preserveMetadata === 'boolean', r.preserveMetadata as boolean);
  check(
    'historyLimit',
    Number.isInteger(r.historyLimit) &&
      (r.historyLimit as number) >= 0 &&
      (r.historyLimit as number) <= 5000,
    r.historyLimit as number,
  );
  for (const k of Object.keys(r)) if (!(k in DEFAULT_SETTINGS)) invalid.push(k);
  return { patch, invalid };
}

export class SettingsStore {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private writes = new WriteChain();
  public loadStatus: 'ok' | 'missing' | 'corrupt' = 'missing';
  public invalidFields: string[] = [];

  constructor(private readonly file: string) {}

  async load(): Promise<AppSettings> {
    const { value, status } = await readJson<unknown>(this.file, {});
    this.loadStatus = status;
    const { patch, invalid } = validateSettingsPatch(value);
    this.invalidFields = status === 'ok' ? invalid : [];
    this.settings = { ...DEFAULT_SETTINGS, ...patch };
    return this.get();
  }

  get(): AppSettings {
    return structuredClone(this.settings);
  }

  async update(raw: unknown): Promise<{ settings: AppSettings; invalid: string[] }> {
    const { patch, invalid } = validateSettingsPatch(raw);
    this.settings = { ...this.settings, ...patch };
    const snapshot = this.get();
    await this.writes.run(() => writeJsonAtomic(this.file, snapshot));
    return { settings: snapshot, invalid };
  }
}
