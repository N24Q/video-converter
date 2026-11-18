import { useState } from 'react';
import type {
  ConversionSettings,
  EncoderOption,
  MediaInfo,
  OutputFormat,
} from '../../shared/types';
import { tokenizeArgs } from '../../shared/tokenize';

const RESOLUTIONS: [number, number][] = [
  [3840, 2160],
  [2560, 1440],
  [1920, 1080],
  [1280, 720],
  [854, 480],
  [640, 360],
];
const FRAME_RATES = ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'];
const SAMPLE_RATES = [22050, 32000, 44100, 48000, 96000];
const PIX_FMTS = ['yuv420p', 'yuv422p', 'yuv444p', 'yuv420p10le', 'yuv422p10le'];

interface Props {
  value: ConversionSettings;
  onChange: (s: ConversionSettings) => void;
  formats: OutputFormat[];
  encoders: EncoderOption[];
  singleMedia: MediaInfo | null; // stream selection is offered when exactly one file is selected
  vaapiAvailable: boolean;
}

function compatible(enc: EncoderOption, codecs: string[] | null) {
  return codecs === null || codecs.includes(enc.codec);
}

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function AdvancedSettings({
  value: s,
  onChange,
  formats,
  encoders,
  singleMedia,
  vaapiAvailable,
}: Props) {
  const [customText, setCustomText] = useState(s.customArgs.join(' '));
  const format = formats.find((f) => f.id === s.formatId);
  const videoEncoders = encoders.filter(
    (e) => e.type === 'video' && compatible(e, format?.videoCodecs ?? null),
  );
  const audioEncoders = encoders.filter(
    (e) => e.type === 'audio' && compatible(e, format?.audioCodecs ?? null),
  );
  const venc = encoders.find((e) => e.name === s.video.encoder);
  const aenc = encoders.find((e) => e.name === s.audio.encoder);
  const set = (patch: Partial<ConversionSettings>) => onChange({ ...s, ...patch });
  const setV = (patch: Partial<ConversionSettings['video']>) =>
    onChange({ ...s, video: { ...s.video, ...patch } });
  const setA = (patch: Partial<ConversionSettings['audio']>) =>
    onChange({ ...s, audio: { ...s.audio, ...patch } });
  const isAudioFormat = format?.kind === 'audio';

  const changeFormat = (id: string) => {
    const f = formats.find((x) => x.id === id);
    if (!f) return;
    const next: ConversionSettings = structuredClone(s);
    next.formatId = f.id;
    next.muxer = f.muxer;
    next.extension = f.extension;
    next.presetId = null;
    if (f.kind === 'audio') next.video.mode = 'none';
    else if (next.video.mode === 'none') next.video.mode = 'encode';
    const vOk = encoders.find((e) => e.name === next.video.encoder && compatible(e, f.videoCodecs));
    if (!vOk) {
      const first = encoders.find(
        (e) => e.type === 'video' && !e.hw && compatible(e, f.videoCodecs),
      );
      next.video.encoder = first?.name ?? null;
      next.video.quality = first?.quality?.default ?? null;
      next.video.speedPreset = first?.speed?.default ?? null;
    }
    const aOk = encoders.find((e) => e.name === next.audio.encoder && compatible(e, f.audioCodecs));
    if (!aOk) {
      const first = encoders.find((e) => e.type === 'audio' && compatible(e, f.audioCodecs));
      next.audio.encoder = first?.name ?? null;
      next.audio.bitrateKbps = first?.lossless ? null : (first?.defaultBitrateKbps ?? null);
    }
    onChange(next);
  };

  const changeVideoEncoder = (name: string) => {
    const e = encoders.find((x) => x.name === name);
    setV({
      encoder: name,
      quality: e?.quality?.default ?? null,
      speedPreset: e?.speed?.default ?? null,
      hwaccel: e?.hw === 'vaapi' ? 'vaapi' : 'none',
    });
  };

  const resValue =
    s.video.resolution.mode === 'original'
      ? 'original'
      : `${s.video.resolution.width}x${s.video.resolution.height}`;
  const isPresetRes = RESOLUTIONS.some(([w, h]) => `${w}x${h}` === resValue);
  const fpsValue = s.video.frameRate.mode === 'original' ? 'original' : s.video.frameRate.fps;

  const audioStreams = singleMedia?.streams.filter((x) => x.type === 'audio') ?? [];
  const subStreams = singleMedia?.streams.filter((x) => x.type === 'subtitle') ?? [];
  const toggleStream = (kind: 'audio' | 'subtitle', idx: number, all: number[]) => {
    const cur = s.streams[kind] ?? all;
    const next = cur.includes(idx)
      ? cur.filter((i) => i !== idx)
      : [...cur, idx].sort((a, b) => a - b);
    set({ streams: { ...s.streams, [kind]: next.length === all.length ? null : next } });
  };

  return (
    <div className="advanced" data-testid="advanced-settings">
      <fieldset>
        <legend>Container</legend>
        <label>
          Output format
          <select
            value={s.formatId}
            onChange={(e) => changeFormat(e.target.value)}
            data-testid="adv-format"
          >
            <optgroup label="Video">
              {formats
                .filter((f) => f.kind === 'video')
                .map((f) => (
                  <option key={f.id} value={f.id} disabled={!f.available}>
                    {f.label} (.{f.extension}){f.available ? '' : ' — unavailable'}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Audio only">
              {formats
                .filter((f) => f.kind === 'audio')
                .map((f) => (
                  <option key={f.id} value={f.id} disabled={!f.available}>
                    {f.label} (.{f.extension}){f.available ? '' : ' — unavailable'}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>
        {format?.notes && <p className="muted small">{format.notes}</p>}
        <label className="check">
          <input
            type="checkbox"
            checked={s.preserveMetadata}
            onChange={(e) => set({ preserveMetadata: e.target.checked })}
          />{' '}
          Keep metadata (title, date, etc.)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.preserveChapters}
            onChange={(e) => set({ preserveChapters: e.target.checked })}
          />{' '}
          Keep chapters
        </label>
        {(s.muxer === 'mp4' || s.muxer === 'mov' || s.muxer === 'ipod') && (
          <label className="check">
            <input
              type="checkbox"
              checked={s.fastStart}
              onChange={(e) => set({ fastStart: e.target.checked })}
            />{' '}
            Fast start (web streaming)
          </label>
        )}
      </fieldset>

      {!isAudioFormat && (
        <fieldset>
          <legend>Video</legend>
          <label>
            Video
            <select
              value={s.video.mode}
              onChange={(e) =>
                setV({ mode: e.target.value as ConversionSettings['video']['mode'] })
              }
            >
              <option value="encode">Re-encode</option>
              <option value="copy">Copy without re-encoding</option>
              <option value="none">Remove video</option>
            </select>
          </label>
          {s.video.mode === 'encode' && (
            <>
              <label>
                Encoder
                <select
                  value={s.video.encoder ?? ''}
                  onChange={(e) => changeVideoEncoder(e.target.value)}
                  data-testid="adv-video-encoder"
                >
                  {!venc && <option value="">— choose —</option>}
                  {videoEncoders.map((e) => (
                    <option key={e.name} value={e.name}>
                      {e.label}
                      {e.hw ? ' [hardware]' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {venc?.hw && (
                <p className="muted small">
                  Hardware encoding passed a self-test on this machine. If it fails on a real file,
                  use “Retry with CPU encoder”.
                </p>
              )}
              {!vaapiAvailable && (
                <p className="muted small">
                  No working hardware encoder was detected; software encoding is used.
                </p>
              )}
              {venc?.quality && venc.quality.kind === 'range' && (
                <label>
                  {venc.quality.label}
                  <input
                    type="number"
                    min={venc.quality.min}
                    max={venc.quality.max}
                    value={s.video.quality ?? ''}
                    placeholder="encoder default"
                    onChange={(e) => setV({ quality: numOrNull(e.target.value) })}
                  />
                </label>
              )}
              {venc?.quality && venc.quality.kind === 'enum' && (
                <label>
                  {venc.quality.label}
                  <select
                    value={s.video.quality ?? venc.quality.default}
                    onChange={(e) => setV({ quality: Number(e.target.value) })}
                  >
                    {venc.quality.choices?.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {venc?.lossless && (
                <p className="muted small">Lossless encoder: no quality setting needed.</p>
              )}
              {venc?.speed && (
                <label>
                  {venc.speed.label}
                  <select
                    value={s.video.speedPreset ?? venc.speed.default}
                    onChange={(e) => setV({ speedPreset: e.target.value })}
                  >
                    {venc.speed.values.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!venc?.lossless && (
                <div className="row">
                  <label>
                    Bitrate (kbit/s)
                    <input
                      type="number"
                      min={1}
                      value={s.video.bitrateKbps ?? ''}
                      placeholder={
                        venc?.quality ? 'use quality' : String(venc?.defaultBitrateKbps ?? 'auto')
                      }
                      onChange={(e) => setV({ bitrateKbps: numOrNull(e.target.value) })}
                    />
                  </label>
                  <label>
                    Max bitrate (kbit/s)
                    <input
                      type="number"
                      min={1}
                      value={s.video.maxBitrateKbps ?? ''}
                      placeholder="none"
                      onChange={(e) => setV({ maxBitrateKbps: numOrNull(e.target.value) })}
                    />
                  </label>
                </div>
              )}
              <label>
                Resolution
                <select
                  value={isPresetRes || resValue === 'original' ? resValue : 'custom'}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'original') setV({ resolution: { mode: 'original' } });
                    else if (v === 'custom')
                      setV({ resolution: { mode: 'fit', width: 1920, height: 1080 } });
                    else {
                      const [w, h] = v.split('x').map(Number);
                      setV({ resolution: { mode: 'fit', width: w, height: h } });
                    }
                  }}
                  data-testid="adv-resolution"
                >
                  <option value="original">Original</option>
                  {RESOLUTIONS.map(([w, h]) => (
                    <option key={w} value={`${w}x${h}`}>
                      {w}×{h}
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>
              </label>
              {s.video.resolution.mode === 'fit' && !isPresetRes && (
                <div className="row">
                  <label>
                    Width
                    <input
                      type="number"
                      min={16}
                      max={16384}
                      value={s.video.resolution.width}
                      onChange={(e) =>
                        setV({
                          resolution: {
                            mode: 'fit',
                            width: Number(e.target.value) || 16,
                            height: (s.video.resolution as { height: number }).height,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Height
                    <input
                      type="number"
                      min={16}
                      max={16384}
                      value={s.video.resolution.height}
                      onChange={(e) =>
                        setV({
                          resolution: {
                            mode: 'fit',
                            width: (s.video.resolution as { width: number }).width,
                            height: Number(e.target.value) || 16,
                          },
                        })
                      }
                    />
                  </label>
                </div>
              )}
              {s.video.resolution.mode === 'fit' && (
                <>
                  <p className="muted small">
                    The video is fitted inside this size keeping its shape. Portrait videos use the
                    box turned on its side.
                  </p>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={s.video.stretch}
                      onChange={(e) => setV({ stretch: e.target.checked })}
                    />{' '}
                    Stretch to exactly this size (distorts the picture)
                  </label>
                </>
              )}
              <label>
                Frame rate
                <select
                  value={
                    FRAME_RATES.includes(fpsValue) || fpsValue === 'original' ? fpsValue : 'custom'
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'original') setV({ frameRate: { mode: 'original' } });
                    else if (v === 'custom') setV({ frameRate: { mode: 'fixed', fps: '30' } });
                    else setV({ frameRate: { mode: 'fixed', fps: v } });
                  }}
                >
                  <option value="original">Original</option>
                  {FRAME_RATES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>
              </label>
              {s.video.frameRate.mode === 'fixed' &&
                !FRAME_RATES.includes(s.video.frameRate.fps) && (
                  <label>
                    Custom frame rate (e.g. 12 or 30000/1001)
                    <input
                      value={s.video.frameRate.fps}
                      onChange={(e) => setV({ frameRate: { mode: 'fixed', fps: e.target.value } })}
                    />
                  </label>
                )}
              <label>
                Deinterlace
                <select
                  value={s.video.deinterlace}
                  onChange={(e) => setV({ deinterlace: e.target.value as 'auto' })}
                >
                  <option value="auto">
                    Automatic (when the source is interlaced, e.g. 1080i camcorder footage)
                  </option>
                  <option value="on">Always</option>
                  <option value="off">Never</option>
                </select>
              </label>
              <label>
                Rotation
                <select
                  value={String(s.video.rotation)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setV({
                      rotation: v === 'auto' || v === 'none' ? v : (Number(v) as 90 | 180 | 270),
                    });
                  }}
                >
                  <option value="auto">Automatic (apply the rotation stored in the file)</option>
                  <option value="none">Ignore stored rotation</option>
                  <option value="90">Rotate 90° clockwise</option>
                  <option value="180">Rotate 180°</option>
                  <option value="270">Rotate 90° anticlockwise</option>
                </select>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!s.video.crop}
                  onChange={(e) =>
                    setV({
                      crop: e.target.checked ? { width: 1280, height: 720, x: 0, y: 0 } : null,
                    })
                  }
                />{' '}
                Crop
              </label>
              {s.video.crop && (
                <div className="row">
                  {(['width', 'height', 'x', 'y'] as const).map((k) => (
                    <label key={k}>
                      {k}
                      <input
                        type="number"
                        min={0}
                        value={s.video.crop![k]}
                        onChange={(e) =>
                          setV({ crop: { ...s.video.crop!, [k]: Number(e.target.value) || 0 } })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
              {!venc?.hw && (
                <label>
                  Pixel format
                  <select
                    value={s.video.pixFmt ?? ''}
                    onChange={(e) => setV({ pixFmt: e.target.value || null })}
                  >
                    <option value="">Automatic (best for the encoder)</option>
                    {PIX_FMTS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
        </fieldset>
      )}

      <fieldset>
        <legend>Audio</legend>
        <label>
          Audio
          <select
            value={s.audio.mode}
            onChange={(e) => setA({ mode: e.target.value as ConversionSettings['audio']['mode'] })}
          >
            <option value="encode">Re-encode</option>
            <option value="copy">Copy without re-encoding</option>
            {!isAudioFormat && <option value="none">Remove audio</option>}
          </select>
        </label>
        {s.audio.mode === 'encode' && (
          <>
            <label>
              Encoder
              <select
                value={s.audio.encoder ?? ''}
                onChange={(e) => {
                  const enc = encoders.find((x) => x.name === e.target.value);
                  setA({
                    encoder: e.target.value,
                    bitrateKbps: enc?.lossless ? null : (enc?.defaultBitrateKbps ?? null),
                  });
                }}
                data-testid="adv-audio-encoder"
              >
                {!aenc && <option value="">— choose —</option>}
                {audioEncoders.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
            {!aenc?.lossless && (
              <label>
                Bitrate (kbit/s)
                <input
                  type="number"
                  min={8}
                  max={3000}
                  value={s.audio.bitrateKbps ?? ''}
                  placeholder="encoder default"
                  onChange={(e) => setA({ bitrateKbps: numOrNull(e.target.value) })}
                />
              </label>
            )}
            <div className="row">
              <label>
                Sample rate
                <select
                  value={s.audio.sampleRate ?? ''}
                  onChange={(e) => setA({ sampleRate: numOrNull(e.target.value) })}
                >
                  <option value="">Original</option>
                  {SAMPLE_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r} Hz
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Channels
                <select
                  value={s.audio.channels ?? ''}
                  onChange={(e) => setA({ channels: numOrNull(e.target.value) })}
                >
                  <option value="">Original</option>
                  <option value="1">Mono</option>
                  <option value="2">Stereo</option>
                  <option value="6">5.1</option>
                </select>
              </label>
            </div>
          </>
        )}
        {audioStreams.length > 1 && (
          <div>
            <p className="small">Audio tracks to keep:</p>
            {audioStreams.map((a) => (
              <label key={a.index} className="check">
                <input
                  type="checkbox"
                  checked={(s.streams.audio ?? audioStreams.map((x) => x.index)).includes(a.index)}
                  onChange={() =>
                    toggleStream(
                      'audio',
                      a.index,
                      audioStreams.map((x) => x.index),
                    )
                  }
                />{' '}
                #{a.index} {a.codec} {a.channelLayout ?? ''} {a.language ?? ''} {a.title ?? ''}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {!isAudioFormat && (
        <fieldset>
          <legend>Subtitles</legend>
          <label>
            Subtitles
            <select
              value={s.subtitles}
              onChange={(e) =>
                set({ subtitles: e.target.value as ConversionSettings['subtitles'] })
              }
            >
              <option value="auto">Keep (copy, or convert text subtitles when needed)</option>
              <option value="copy">Copy only when compatible</option>
              <option value="convert">Convert text subtitles to the container's format</option>
              <option value="remove">Remove</option>
            </select>
          </label>
          {subStreams.length > 1 && s.subtitles !== 'remove' && (
            <div>
              {subStreams.map((t) => (
                <label key={t.index} className="check">
                  <input
                    type="checkbox"
                    checked={(s.streams.subtitle ?? subStreams.map((x) => x.index)).includes(
                      t.index,
                    )}
                    onChange={() =>
                      toggleStream(
                        'subtitle',
                        t.index,
                        subStreams.map((x) => x.index),
                      )
                    }
                  />{' '}
                  #{t.index} {t.codec} {t.language ?? ''} {t.title ?? ''}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <fieldset>
        <legend>Extra FFmpeg options</legend>
        <p className="muted small">
          Optional. Only a fixed set of encoder options is accepted (for example{' '}
          <code>-tune film</code>, <code>-g 48</code>, <code>-profile:v high</code>). Inputs,
          outputs, filters and anything that reads or writes files are blocked.
        </p>
        <input
          className="wide"
          value={customText}
          placeholder="-tune film -g 48"
          onChange={(e) => {
            setCustomText(e.target.value);
            set({ customArgs: tokenizeArgs(e.target.value) });
          }}
          data-testid="adv-custom-args"
        />
      </fieldset>
    </div>
  );
}
