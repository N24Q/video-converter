import type { AppSettings, PresetId } from '../../shared/types';
import { api } from '../api';
import type { AppData } from '../hooks/useAppData';

export function SettingsPage({ data }: { data: AppData }) {
  const s = data.settings!;
  const set = (patch: Partial<AppSettings>) => data.updateSettings(patch);
  const vaapiWorks = data.ffmpeg?.capabilities?.hwEncoderTests.some(
    (t) => t.method === 'vaapi' && t.ok,
  );

  return (
    <section className="panel settings" data-testid="settings-page">
      <h2>Settings</h2>
      <fieldset>
        <legend>Defaults</legend>
        <label>
          Default output folder
          <span className="row">
            <span className="path">{s.defaultOutputDir ?? 'not set'}</span>
            <button onClick={() => api.chooseOutputDir().then(() => set({}))}>Change…</button>
          </span>
        </label>
        <label>
          Default preset
          <select
            value={s.defaultPresetId}
            onChange={(e) => set({ defaultPresetId: e.target.value as PresetId })}
          >
            {data.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Default format
          <select
            value={s.defaultFormatId}
            onChange={(e) => set({ defaultFormatId: e.target.value })}
            data-testid="default-format"
          >
            {data.formats
              .filter((f) => f.available)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
          </select>
        </label>
        <label>
          Default resolution (simple mode)
          <select
            value={
              s.defaultResolution.mode === 'original'
                ? 'original'
                : `${s.defaultResolution.width}x${s.defaultResolution.height}`
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'original') set({ defaultResolution: { mode: 'original' } });
              else {
                const [w, h] = v.split('x').map(Number);
                set({ defaultResolution: { mode: 'fit', width: w, height: h } });
              }
            }}
          >
            <option value="original">Original</option>
            {['3840x2160', '2560x1440', '1920x1080', '1280x720', '854x480', '640x360'].map((r) => (
              <option key={r} value={r}>
                {r.replace('x', '×')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Default frame rate (simple mode)
          <select
            value={s.defaultFrameRate.mode === 'original' ? 'original' : s.defaultFrameRate.fps}
            onChange={(e) =>
              set({
                defaultFrameRate:
                  e.target.value === 'original'
                    ? { mode: 'original' }
                    : { mode: 'fixed', fps: e.target.value },
              })
            }
          >
            <option value="original">Original</option>
            {['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.preserveMetadata}
            onChange={(e) => set({ preserveMetadata: e.target.checked })}
          />{' '}
          Keep metadata by default
        </label>
      </fieldset>

      <fieldset>
        <legend>Queue</legend>
        <label>
          Conversions at the same time
          <select
            value={s.maxConcurrentJobs}
            onChange={(e) => set({ maxConcurrentJobs: Number(e.target.value) })}
            data-testid="concurrency"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
                {n === 1 ? ' (recommended on Chromebooks)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          When an output file already exists
          <select
            value={s.conflictBehaviour}
            onChange={(e) =>
              set({ conflictBehaviour: e.target.value as AppSettings['conflictBehaviour'] })
            }
          >
            <option value="unique">Keep both: give the new file a different name</option>
            <option value="ask">Ask me</option>
            <option value="overwrite">Overwrite the existing file</option>
          </select>
        </label>
        <p className="muted small">Source files are never overwritten, whatever this is set to.</p>
        <label>
          History entries to keep
          <input
            type="number"
            min={0}
            max={5000}
            value={s.historyLimit}
            onChange={(e) =>
              set({ historyLimit: Math.max(0, Math.min(5000, Number(e.target.value) || 0)) })
            }
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Hardware acceleration</legend>
        <label>
          Preferred encoder for presets
          <select
            value={s.hwaccelPreference}
            onChange={(e) => set({ hwaccelPreference: e.target.value as 'none' | 'vaapi' })}
          >
            <option value="none">Software (CPU) — always works</option>
            <option value="vaapi" disabled={!vaapiWorks}>
              VAAPI hardware{vaapiWorks ? '' : ' — not available on this system'}
            </option>
          </select>
        </label>
        <p className="muted small">
          Hardware encoding is often unavailable inside the ChromeOS Linux container. It is only
          offered after a test encode succeeds, and failed hardware jobs can be retried on the CPU.
        </p>
      </fieldset>

      <fieldset>
        <legend>FFmpeg</legend>
        {(['ffmpeg', 'ffprobe'] as const).map((kind) => {
          const configured = kind === 'ffmpeg' ? s.ffmpegPath : s.ffprobePath;
          return (
            <label key={kind}>
              {kind} executable
              <span className="row">
                <span className="path">{configured ?? 'automatic (search PATH)'}</span>
                <button onClick={() => api.chooseExecutable(kind)}>Choose…</button>
                {configured && (
                  <button
                    onClick={() =>
                      set(kind === 'ffmpeg' ? { ffmpegPath: null } : { ffprobePath: null })
                    }
                  >
                    Use automatic
                  </button>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}
