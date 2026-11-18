import { useCallback, useEffect, useState } from 'react';
import type {
  AppSettings,
  AvchdSet,
  EncoderOption,
  FfmpegStatus,
  Job,
  MediaItem,
  OutputFormat,
  PresetDescriptor,
} from '../../shared/types';
import { api } from '../api';

export interface AppData {
  settings: AppSettings | null;
  ffmpeg: FfmpegStatus | null;
  formats: OutputFormat[];
  encoders: EncoderOption[];
  presets: PresetDescriptor[];
  media: MediaItem[];
  avchdSets: AvchdSet[];
  jobs: Job[];
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  reloadCatalog: () => Promise<void>;
}

/** Loads app state from the main process and keeps it in sync via events. */
export function useAppData(): AppData {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [formats, setFormats] = useState<OutputFormat[]>([]);
  const [encoders, setEncoders] = useState<EncoderOption[]>([]);
  const [presets, setPresets] = useState<PresetDescriptor[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [avchdSets, setAvchdSets] = useState<AvchdSet[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);

  const reloadCatalog = useCallback(async () => {
    const [f, e, p] = await Promise.all([api.getFormats(), api.getEncoders(), api.getPresets()]);
    setFormats(f);
    setEncoders(e);
    setPresets(p);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, st, m, j] = await Promise.all([
        api.getSettings(),
        api.getFfmpegStatus(),
        api.listMedia(),
        api.listJobs(),
      ]);
      if (!alive) return;
      setSettings(s);
      setFfmpeg(st);
      setMedia(m.media);
      setAvchdSets(m.avchdSets);
      setJobs(j);
      await reloadCatalog();
    })();
    const offs = [
      api.onJobs((j) => setJobs(j)),
      api.onMedia((d) => {
        setMedia(d.media);
        setAvchdSets(d.avchdSets);
      }),
      api.onFfmpeg((st) => {
        setFfmpeg(st);
        reloadCatalog();
      }),
    ];
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, [reloadCatalog]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    // Apply immediately so controls respond without waiting for the save;
    // the main process's validated result then replaces it.
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setSettings(await api.setSettings(patch));
  }, []);

  return {
    settings,
    ffmpeg,
    formats,
    encoders,
    presets,
    media,
    avchdSets,
    jobs,
    updateSettings,
    reloadCatalog,
  };
}
