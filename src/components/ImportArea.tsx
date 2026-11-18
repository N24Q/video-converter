import { useState, type DragEvent } from 'react';
import type { ImportResult } from '../../shared/types';
import { api, errorMessage } from '../api';

export function ImportArea({
  onResult,
}: {
  onResult: (r: ImportResult | null, error?: string) => void;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<ImportResult | null>) => {
    setBusy(true);
    try {
      onResult(await fn());
    } catch (err) {
      onResult(null, errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) run(() => api.importDropped(files));
  };

  return (
    <section
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      aria-label="Drop files or folders here"
      data-testid="dropzone"
    >
      <p>
        <strong>Drop video/audio files or a camcorder folder here</strong>
        <br />
        <span className="muted">AVCHD cards (PRIVATE/AVCHD/BDMV) are detected automatically.</span>
      </p>
      <div className="row">
        <button onClick={() => run(api.openFiles)} disabled={busy}>
          Browse files…
        </button>
        <button onClick={() => run(api.openFolder)} disabled={busy}>
          Browse folder…
        </button>
        {busy && <span className="muted">Scanning…</span>}
      </div>
    </section>
  );
}
