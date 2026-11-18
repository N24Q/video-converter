import { useEffect, useMemo, useState } from 'react';
import type { AvchdSet, ConcatCheck, MediaItem } from '../../shared/types';
import { api } from '../api';
import { MediaRow } from './MediaList';

interface Props {
  set: AvchdSet;
  media: Map<string, MediaItem>;
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
  onCombine: (orderedIds: string[]) => void;
  canStart: boolean;
}

const METHOD_LABEL: Record<AvchdSet['orderMethod'], string> = {
  playlist: 'Camera playlist',
  'playlist-partial': 'Camera playlist (partial)',
  filename: 'File number (no usable playlist)',
};

export function AvchdPanel({ set, media, selected, onSelect, onCombine, canStart }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>(() => set.clips.map((c) => c.mediaId));
  const [check, setCheck] = useState<ConcatCheck | null>(null);

  // Keep local order in sync if clips are removed.
  const clipIds = set.clips.map((c) => c.mediaId).join(',');
  useEffect(() => {
    const ids = new Set(clipIds.split(','));
    setOrder((o) => {
      const kept = o.filter((id) => ids.has(id));
      const added = [...ids].filter((id) => id && !kept.includes(id));
      return [...kept, ...added];
    });
  }, [clipIds]);

  const clipById = useMemo(() => new Map(set.clips.map((c) => [c.mediaId, c])), [set.clips]);
  const chosen = order.filter((id) => selected.has(id));
  const chosenKey = chosen.join(',');
  const allReady = chosen.every((id) => media.get(id)?.status === 'ready');

  useEffect(() => {
    if (chosen.length < 2 || !allReady) {
      setCheck(null);
      return;
    }
    let alive = true;
    api.checkConcat(chosen).then((c) => alive && setCheck(c));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey, allReady]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelect(next);
  };
  const setAll = (on: boolean) => {
    const next = new Set(selected);
    order.forEach((id) => (on ? next.add(id) : next.delete(id)));
    onSelect(next);
  };
  const selectGroup = (g: number) => {
    const next = new Set(selected);
    order.forEach((id) => (clipById.get(id)?.groupIndex === g ? next.add(id) : next.delete(id)));
    onSelect(next);
  };
  const move = (id: string, delta: number) => {
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const n = [...o];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };
  const reordered = order.join(',') !== set.clips.map((c) => c.mediaId).join(',');
  const groups = new Set(set.clips.map((c) => c.groupIndex));

  return (
    <section className="panel avchd" data-testid="avchd-panel">
      <div className="panel-head">
        <h2>AVCHD recordings — {set.rootPath.split('/').pop() || set.rootPath}</h2>
        <div className="row">
          <button onClick={() => setAll(chosen.length !== order.length)}>
            {chosen.length === order.length ? 'Select none' : 'Select all'}
          </button>
        </div>
      </div>
      <p className="muted small">
        Location: <span className="path">{set.bdmvPath}</span>
      </p>
      <p>
        <strong>Order:</strong> {METHOD_LABEL[set.orderMethod]}. {set.orderExplanation}
        {reordered && <em> You have changed the order manually.</em>}
      </p>
      {set.playlists.length > 0 && (
        <p className="muted small">
          Playlists:{' '}
          {set.playlists
            .map((p) => `${p.name}${p.valid ? ` (${p.clipNames.length} clips)` : ' (unreadable)'}`)
            .join(', ')}
        </p>
      )}
      {set.warnings.length > 0 && (
        <ul className="warnings">
          {set.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <table className="list">
        <thead>
          <tr>
            <th></th>
            <th>#</th>
            <th>Recording</th>
            <th>Clip</th>
            <th>Details</th>
            <th>Duration</th>
            <th>Size</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {order.map((id, i) => {
            const m = media.get(id);
            const clip = clipById.get(id);
            if (!m || !clip) return null;
            return (
              <MediaRow
                key={id}
                m={m}
                checked={selected.has(id)}
                onToggle={() => toggle(id)}
                expanded={expanded === id}
                onExpand={() => setExpanded(expanded === id ? null : id)}
                prefix={
                  <>
                    <td className="order">
                      {i + 1}
                      <button
                        className="tiny"
                        onClick={() => move(id, -1)}
                        disabled={i === 0}
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        className="tiny"
                        onClick={() => move(id, 1)}
                        disabled={i === order.length - 1}
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                    </td>
                    <td>
                      {groups.size > 1 ? (
                        <button
                          className="link"
                          onClick={() => selectGroup(clip.groupIndex)}
                          title="Select this whole recording"
                        >
                          Recording {clip.groupIndex + 1}
                        </button>
                      ) : (
                        `Recording ${clip.groupIndex + 1}`
                      )}
                      {!clip.hasClipInfo && <span className="muted small"> (no clip info)</span>}
                    </td>
                  </>
                }
              />
            );
          })}
        </tbody>
      </table>
      <div className="combine">
        <p className="muted small">
          To convert clips separately, select them and use <em>Convert selected</em> below. To join
          clips into one file, select two or more and use <em>Combine</em>; they are joined in the
          order shown.
        </p>
        {check && (
          <div className={check.compatible ? 'ok-box' : 'warn-box'}>
            {check.compatible ? (
              'The selected clips have identical stream parameters and can be joined directly (lossless with the Original Quality preset).'
            ) : (
              <>
                The selected clips differ, so they will be normalised (scaled, frame-rate matched
                and re-encoded) before joining. Stream copy is not possible:
                <ul>
                  {check.differences.slice(0, 6).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <button
          className="primary"
          disabled={!canStart || chosen.length < 2 || !allReady}
          onClick={() => onCombine(chosen)}
          data-testid="combine-button"
        >
          Combine {chosen.length >= 2 ? `${chosen.length} clips` : 'selected clips'} into one file
        </button>
      </div>
    </section>
  );
}
