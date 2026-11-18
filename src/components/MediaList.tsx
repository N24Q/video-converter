import { useState } from 'react';
import type { MediaItem } from '../../shared/types';
import { api } from '../api';
import { formatBytes, formatDuration, mediaSummary, streamSummary } from '../utils/format';

interface Props {
  media: MediaItem[];
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
}

export function MediaList({ media, selected, onSelect }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const loose = media.filter((m) => !m.avchdSetId);
  if (loose.length === 0) return null;
  const allSelected = loose.every((m) => selected.has(m.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelect(next);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Files ({loose.length})</h2>
        <div className="row">
          <button
            onClick={() => {
              const next = new Set(selected);
              loose.forEach((m) => (allSelected ? next.delete(m.id) : next.add(m.id)));
              onSelect(next);
            }}
          >
            {allSelected ? 'Select none' : 'Select all'}
          </button>
          <button onClick={() => api.clearMedia()}>Clear list</button>
        </div>
      </div>
      <table className="list" data-testid="media-list">
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th>Details</th>
            <th>Duration</th>
            <th>Size</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loose.map((m) => (
            <MediaRow
              key={m.id}
              m={m}
              checked={selected.has(m.id)}
              onToggle={() => toggle(m.id)}
              expanded={expanded === m.id}
              onExpand={() => setExpanded(expanded === m.id ? null : m.id)}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function MediaRow({
  m,
  checked,
  onToggle,
  expanded,
  onExpand,
  prefix,
}: {
  m: MediaItem;
  checked: boolean;
  onToggle: () => void;
  expanded: boolean;
  onExpand: () => void;
  prefix?: React.ReactNode;
}) {
  return (
    <>
      <tr className={m.status === 'error' ? 'error-row' : undefined}>
        <td>
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            disabled={m.status !== 'ready'}
            aria-label={`Select ${m.name}`}
          />
        </td>
        {prefix}
        <td className="name" title={m.path}>
          {m.name}
        </td>
        <td>
          {m.status === 'probing' && <span className="muted">Inspecting…</span>}
          {m.status === 'error' && <span className="err">{m.error}</span>}
          {m.status === 'ready' && (
            <button className="link" onClick={onExpand}>
              {mediaSummary(m.info)}
            </button>
          )}
        </td>
        <td>{formatDuration(m.info?.duration)}</td>
        <td>{formatBytes(m.size)}</td>
        <td>
          <button
            className="small"
            onClick={() => api.removeMedia(m.id)}
            aria-label={`Remove ${m.name}`}
          >
            Remove
          </button>
        </td>
      </tr>
      {expanded && m.info && (
        <tr className="details">
          <td></td>
          <td colSpan={prefix ? 6 : 5}>
            <div>
              Container: {m.info.formatLongName ?? m.info.formatName} · {m.info.chapters} chapter(s)
              {m.info.creationTime
                ? ` · recorded ${new Date(m.info.creationTime).toLocaleString()}`
                : ''}
            </div>
            <ul className="streams">
              {m.info.streams.map((s) => (
                <li key={s.index}>
                  #{s.index} {s.type}: {streamSummary(s)}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
