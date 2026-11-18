import { useEffect, useState } from 'react';
import type { Diagnostics } from '../../shared/types';
import { api } from '../api';
import type { AppData } from '../hooks/useAppData';

export function DiagnosticsPage({ data }: { data: AppData }) {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.getDiagnostics().then(setDiag);
  useEffect(() => {
    load();
  }, [data.ffmpeg]);

  if (!diag) return <p>Loading…</p>;
  const caps = diag.ffmpeg.capabilities;
  const archLabel =
    diag.arch === 'x64' ? 'x86_64 / AMD64' : diag.arch === 'arm64' ? 'ARM64 / AArch64' : diag.arch;

  return (
    <section className="panel diagnostics" data-testid="diagnostics">
      <div className="panel-head">
        <h2>Diagnostics</h2>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await api.refreshFfmpeg();
            await load();
            setBusy(false);
          }}
        >
          {busy ? 'Checking…' : 'Re-check FFmpeg'}
        </button>
      </div>
      <table className="kv">
        <tbody>
          <tr>
            <th>App version</th>
            <td>{diag.appVersion}</td>
          </tr>
          <tr>
            <th>System</th>
            <td>
              {diag.osRelease} ({diag.os})
            </td>
          </tr>
          <tr>
            <th>Architecture</th>
            <td data-testid="arch">{archLabel}</td>
          </tr>
          <tr>
            <th>ChromeOS Linux container</th>
            <td>{diag.isCrostini ? 'Yes' : 'No / not detected'}</td>
          </tr>
          <tr>
            <th>Electron / Chromium / Node</th>
            <td>
              {diag.electronVersion} / {diag.chromeVersion} / {diag.nodeVersion}
            </td>
          </tr>
          <tr>
            <th>Settings & logs</th>
            <td className="path">
              {diag.userDataPath}
              <br />
              {diag.logPath}
            </td>
          </tr>
          <tr>
            <th>FFmpeg</th>
            <td data-testid="ffmpeg-status">
              {diag.ffmpeg.ok
                ? `${caps?.ffmpeg.version} — ${diag.ffmpeg.ffmpegPath}`
                : `Not available: ${diag.ffmpeg.error}`}
            </td>
          </tr>
          <tr>
            <th>FFprobe</th>
            <td>
              {caps
                ? `${caps.ffprobe.version} — ${caps.ffprobe.path}`
                : (diag.ffmpeg.ffprobePath ?? 'not found')}
            </td>
          </tr>
          <tr>
            <th>Render devices</th>
            <td>
              {diag.vaapiDevices.length
                ? diag.vaapiDevices.join(', ')
                : 'none (/dev/dri not available)'}
            </td>
          </tr>
        </tbody>
      </table>

      {!diag.ffmpeg.ok && (
        <div className="info-box">
          <p>
            <strong>Installing FFmpeg</strong>
          </p>
          <p>
            ChromeOS Linux (Debian) or Ubuntu:{' '}
            <code className="cmd">sudo apt update && sudo apt install ffmpeg</code>
          </p>
          <p>
            Arch Linux: <code className="cmd">sudo pacman -S ffmpeg</code>
          </p>
          <p>
            Then press “Re-check FFmpeg”. If FFmpeg is installed somewhere unusual, set its location
            in Settings.
          </p>
        </div>
      )}

      {caps && (
        <>
          <h3>Hardware encoding</h3>
          <p className="small">
            FFmpeg hardware methods compiled in: {caps.hwaccels.join(', ') || 'none'}
          </p>
          {caps.hwEncoderTests.length === 0 ? (
            <p className="muted small">No supported hardware encoders in this FFmpeg build.</p>
          ) : (
            <table className="list compact">
              <thead>
                <tr>
                  <th>Encoder</th>
                  <th>Method</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {caps.hwEncoderTests.map((t) => (
                  <tr key={t.encoder}>
                    <td>{t.encoder}</td>
                    <td>{t.method}</td>
                    <td className={t.ok ? 'ok' : 'muted'}>
                      {t.ok ? 'Works' : `Not usable: ${t.message}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>Formats</h3>
          <p className="small">
            {data.formats.filter((f) => f.available).length} of {data.formats.length} output formats
            available · {caps.muxers.length} muxers · {caps.demuxers.length} demuxers ·{' '}
            {caps.encoders.length} encoders · {caps.decoders.length} decoders
          </p>
          <details>
            <summary>Output formats</summary>
            <ul className="small">
              {data.formats.map((f) => (
                <li key={f.id} className={f.available ? undefined : 'muted'}>
                  {f.label} (.{f.extension}, muxer {f.muxer}) —{' '}
                  {f.available ? 'available' : f.notes}
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary>Video and audio encoders ({data.encoders.length} usable)</summary>
            <ul className="small columns">
              {data.encoders.map((e) => (
                <li key={e.name}>
                  {e.name} <span className="muted">({e.codec})</span>
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary>All muxers</summary>
            <p className="small">{caps.muxers.map((m) => m.name).join(', ')}</p>
          </details>
          <details>
            <summary>All demuxers (readable formats)</summary>
            <p className="small">{caps.demuxers.map((m) => m.name).join(', ')}</p>
          </details>
          {caps.buildConfiguration && (
            <details>
              <summary>FFmpeg build configuration</summary>
              <pre className="log">{caps.buildConfiguration}</pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
