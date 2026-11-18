import { useEffect, useState } from 'react';
import type { HistoryEntry } from '../../shared/types';
import { api } from '../api';
import { formatTime } from '../utils/format';

export function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const load = () => api.getHistory().then(setEntries);
  useEffect(() => {
    load();
  }, []);
  if (!entries) return <p>Loading…</p>;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Conversion history</h2>
        <div className="row">
          <button onClick={load}>Refresh</button>
          <button onClick={() => api.clearHistory().then(load)} disabled={entries.length === 0}>
            Clear history
          </button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="muted">No conversions yet.</p>
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th>Finished</th>
              <th>Status</th>
              <th>Source</th>
              <th>Output</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{formatTime(e.endedAt)}</td>
                <td>
                  <span className={`badge ${e.status}`}>{e.status}</span>
                </td>
                <td className="name" title={e.sources.join('\n')}>
                  {e.mode === 'concat'
                    ? `${e.sources.length} clips combined`
                    : e.sources[0]?.split('/').pop()}
                </td>
                <td className="path">{e.outputPath}</td>
                <td className="small">{e.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
