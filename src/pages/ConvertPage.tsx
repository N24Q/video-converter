import { useEffect, useMemo, useState } from 'react';
import type {
  ConversionSettings,
  ImportResult,
  JobRequest,
  PresetId,
  PreviewResult,
} from '../../shared/types';
import { api, errorMessage } from '../api';
import { AdvancedSettings } from '../components/AdvancedSettings';
import { AvchdPanel } from '../components/AvchdPanel';
import { ImportArea } from '../components/ImportArea';
import { MediaList } from '../components/MediaList';
import { PlanPreview } from '../components/PlanPreview';
import { QueuePanel } from '../components/QueuePanel';
import type { AppData } from '../hooks/useAppData';

export function ConvertPage({ data }: { data: AppData }) {
  const { settings, formats, presets, encoders, media, avchdSets, jobs, ffmpeg } = data;
  const advanced = settings!.uiMode === 'advanced';
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [presetId, setPresetId] = useState<PresetId>(settings!.defaultPresetId);
  const [formatId, setFormatId] = useState<string>(settings!.defaultFormatId);
  const [conv, setConv] = useState<ConversionSettings | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const preset = presets.find((p) => p.id === presetId);

  // Drop selections for removed media.
  useEffect(() => {
    setSelected((sel) => {
      const next = new Set([...sel].filter((id) => mediaById.has(id)));
      return next.size === sel.size ? sel : next;
    });
  }, [mediaById]);

  // Keep the format valid for the chosen preset.
  useEffect(() => {
    if (preset && preset.formats.length && !preset.formats.includes(formatId))
      setFormatId(preset.defaultFormat);
  }, [preset, formatId]);

  // Simple mode: settings come from the preset. Advanced mode starts from the
  // same values and is then edited freely.
  const [resolveKey, setResolveKey] = useState(0);
  useEffect(() => {
    if (advanced && conv) return;
    let alive = true;
    api.resolvePreset(presetId, formatId, null).then((r) => {
      if (!alive) return;
      setPresetError(r.error);
      if (r.settings) setConv(r.settings);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, formatId, advanced, resolveKey, encoders]);

  const selectedReady = [...selected].filter((id) => mediaById.get(id)?.status === 'ready');
  const previewId = selectedReady[0] ?? media.find((m) => m.status === 'ready')?.id ?? null;
  const singleInfo =
    selectedReady.length === 1 ? (mediaById.get(selectedReady[0])?.info ?? null) : null;

  useEffect(() => {
    if (!conv || !previewId) {
      setPreview(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api
        .preview(previewId, conv)
        .then((p) => alive && setPreview(p))
        .catch(
          (err) =>
            alive &&
            setPreview({
              validation: { ok: false, errors: [errorMessage(err)], warnings: [], plan: [] },
              args: [],
              outputName: '',
            }),
        );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [conv, previewId]);

  const onImport = (r: ImportResult | null, error?: string) => {
    if (error) setErrors([error]);
    if (!r) return;
    setErrors([]);
    setMessages(r.messages);
    // Newly imported files are selected for convenience; nothing starts automatically.
    setSelected((sel) => new Set([...sel, ...r.media.map((m) => m.id)]));
  };

  const outputDir = settings!.defaultOutputDir;
  const canStart = !!conv && !!outputDir && !!ffmpeg?.ok && (!preview || preview.validation.ok);

  const submit = async (requests: JobRequest[]) => {
    setErrors([]);
    try {
      const r = await api.addJobs(requests);
      const errs = r.rejected.map((x) => {
        const names = x.mediaIds.map((id) => mediaById.get(id)?.name).filter(Boolean);
        return names.length ? `${names.join(', ')}: ${x.reason}` : x.reason;
      });
      setErrors(errs);
      if (r.added.length) setMessages([`${r.added.length} conversion(s) added to the queue.`]);
    } catch (err) {
      setErrors([errorMessage(err)]);
    }
  };

  const startSelected = () => {
    if (!conv || !outputDir) return;
    submit(
      selectedReady.map((id) => ({ mediaIds: [id], mode: 'single', settings: conv, outputDir })),
    );
  };

  const combine = (ids: string[]) => {
    if (!conv || !outputDir) return;
    submit([{ mediaIds: ids, mode: 'concat', settings: conv, outputDir }]);
  };

  const availableFormats = formats.filter(
    (f) => f.available && (preset?.formats.includes(f.id) ?? true),
  );

  return (
    <div className="convert">
      <ImportArea onResult={onImport} />
      {messages.length > 0 && (
        <div className="info-box" data-testid="messages">
          {messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
      {errors.length > 0 && (
        <div className="error-box" role="alert" data-testid="errors">
          {errors.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      {avchdSets.map((set) => (
        <AvchdPanel
          key={set.id}
          set={set}
          media={mediaById}
          selected={selected}
          onSelect={setSelected}
          onCombine={combine}
          canStart={canStart}
        />
      ))}
      <MediaList media={media} selected={selected} onSelect={setSelected} />

      <section className="panel output">
        <div className="panel-head">
          <h2>Output</h2>
        </div>
        <p className="muted small">
          A <em>container</em> (MP4, MKV, MOV…) is the file type; inside it are encoded streams such
          as H.264, HEVC or AV1 video and AAC or Opus audio. Not every container can hold every
          codec — the plan below shows exactly what will happen to each stream.
        </p>
        <div className="row">
          <label>
            Output folder
            <span className="path" data-testid="output-dir">
              {outputDir ?? 'not chosen'}
            </span>
          </label>
          <button
            onClick={async () => {
              if (await api.chooseOutputDir()) await data.updateSettings({});
            }}
          >
            Change…
          </button>
        </div>

        {!advanced && (
          <div className="simple" data-testid="simple-settings">
            <label>
              Preset
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value as PresetId)}
                data-testid="preset"
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.label}
                    {p.available ? '' : ` — ${p.unavailableReason}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Format
              <select
                value={formatId}
                onChange={(e) => setFormatId(e.target.value)}
                data-testid="format"
              >
                {availableFormats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} (.{f.extension})
                  </option>
                ))}
              </select>
            </label>
            {preset && <p className="muted">{preset.description}</p>}
            {conv && conv.video.mode === 'encode' && (
              <p className="small">
                Video:{' '}
                {encoders.find((e) => e.name === conv.video.encoder)?.label ?? conv.video.encoder}
                {conv.audio.mode === 'encode' && (
                  <>
                    {' '}
                    · Audio:{' '}
                    {encoders.find((e) => e.name === conv.audio.encoder)?.label ??
                      conv.audio.encoder}
                  </>
                )}
              </p>
            )}
          </div>
        )}
        {presetError && <p className="err">{presetError}</p>}

        {advanced && conv && (
          <>
            <div className="row">
              <label>
                Start from preset
                <select
                  value={presetId}
                  onChange={(e) => {
                    const next = presets.find((p) => p.id === e.target.value);
                    setConv(null);
                    setPresetId(e.target.value as PresetId);
                    if (next && !next.formats.includes(formatId)) setFormatId(next.defaultFormat);
                  }}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.available}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => {
                  setConv(null);
                  setFormatId(preset?.defaultFormat ?? formatId);
                  setResolveKey((k) => k + 1);
                }}
              >
                Reset to preset
              </button>
            </div>
            <AdvancedSettings
              value={conv}
              onChange={setConv}
              formats={formats}
              encoders={encoders}
              singleMedia={singleInfo}
              vaapiAvailable={encoders.some((e) => e.hw)}
            />
          </>
        )}

        {previewId && (
          <>
            <h3>Plan for {mediaById.get(previewId)?.name}</h3>
            <PlanPreview preview={preview} showCommand={advanced} />
          </>
        )}

        <div className="row start">
          <button
            className="primary"
            disabled={!canStart || selectedReady.length === 0}
            onClick={startSelected}
            data-testid="start"
          >
            Convert {selectedReady.length || ''} selected{' '}
            {selectedReady.length === 1 ? 'file' : 'files'}
          </button>
          {selectedReady.length === 0 && media.length > 0 && (
            <span className="muted">Tick the files to convert.</span>
          )}
          {!ffmpeg?.ok && <span className="err">FFmpeg is required to convert.</span>}
        </div>
      </section>

      <QueuePanel jobs={jobs} />
    </div>
  );
}
