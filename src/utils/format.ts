import type { MediaInfo, MediaStream } from '../../shared/types';

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

export function formatFps(fps: number | null | undefined): string {
  if (!fps) return '';
  return `${Math.round(fps * 1000) / 1000} fps`;
}

export function streamSummary(s: MediaStream): string {
  const parts: string[] = [s.codec ?? 'unknown'];
  if (s.type === 'video') {
    if (s.width && s.height) parts.push(`${s.width}×${s.height}`);
    if (s.frameRate) parts.push(formatFps(s.frameRate));
    if (s.interlaced) parts.push(`interlaced (${s.fieldOrder})`);
    if (s.pixFmt) parts.push(s.pixFmt);
    if (s.rotation) parts.push(`rotated ${s.rotation}°`);
    if (s.isAttachedPic) parts.push('cover art');
  } else if (s.type === 'audio') {
    if (s.channels) parts.push(s.channelLayout ?? `${s.channels} ch`);
    if (s.sampleRate) parts.push(`${s.sampleRate} Hz`);
  }
  if (s.language) parts.push(s.language);
  if (s.title) parts.push(`“${s.title}”`);
  return parts.join(', ');
}

export function mediaSummary(info: MediaInfo | null): string {
  if (!info) return '';
  const v = info.streams.find((s) => s.type === 'video' && !s.isAttachedPic);
  const a = info.streams.filter((s) => s.type === 'audio');
  const subs = info.streams.filter((s) => s.type === 'subtitle').length;
  const parts: string[] = [];
  if (v)
    parts.push(
      `${v.codec ?? '?'} ${v.width ?? '?'}×${v.height ?? '?'}${v.frameRate ? ` ${Math.round(v.frameRate * 100) / 100}fps` : ''}${v.interlaced ? 'i' : ''}`,
    );
  else parts.push('no video');
  if (a.length) parts.push(`${a.length > 1 ? `${a.length}× ` : ''}${a[0].codec ?? '?'}`);
  else parts.push('no audio');
  if (subs) parts.push(`${subs} subtitle${subs > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString();
}
