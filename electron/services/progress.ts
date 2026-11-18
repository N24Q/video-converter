import type { JobProgress } from '../../shared/types';

// Parser for FFmpeg's `-progress pipe:1` output: blocks of key=value lines,
// each block terminated by `progress=continue` or `progress=end`.

export interface ProgressSnapshot {
  outTimeSec: number | null;
  speed: number | null;
  fps: number | null;
  totalSize: number | null;
  frame: number | null;
  end: boolean;
}

function parseOutTime(v: string | undefined): number | null {
  if (!v || v === 'N/A') return null;
  const m = /^(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return null;
  const t = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  return m[1] ? -t : t;
}

function n(v: string | undefined): number | null {
  if (v === undefined || v === 'N/A' || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export class ProgressParser {
  private buffer = '';
  private current: Record<string, string> = {};

  /** Feed a chunk of stdout; returns any completed progress blocks. */
  feed(chunk: string): ProgressSnapshot[] {
    this.buffer += chunk;
    // Guard against a misbehaving process sending an endless line.
    if (this.buffer.length > 64 * 1024) this.buffer = this.buffer.slice(-4096);
    const out: ProgressSnapshot[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      this.current[key] = value;
      if (key === 'progress') {
        out.push(this.snapshot(value === 'end'));
        this.current = {};
      }
    }
    return out;
  }

  private snapshot(end: boolean): ProgressSnapshot {
    const c = this.current;
    let outTimeSec: number | null = null;
    const us = n(c.out_time_us) ?? n(c.out_time_ms); // out_time_ms is actually microseconds
    if (us !== null && us >= 0) outTimeSec = us / 1_000_000;
    else outTimeSec = parseOutTime(c.out_time);
    if (outTimeSec !== null && outTimeSec < 0) outTimeSec = 0;
    const speedRaw = c.speed?.replace(/x$/, '');
    return {
      outTimeSec,
      speed: n(speedRaw),
      fps: n(c.fps),
      totalSize: n(c.total_size),
      frame: n(c.frame),
      end,
    };
  }
}

/**
 * Turn a snapshot into user-facing progress. With an unknown duration the
 * percentage stays null (indeterminate) rather than being invented.
 */
export function computeProgress(
  snap: ProgressSnapshot,
  durationSec: number | null,
  elapsedSec: number,
): JobProgress {
  let percent: number | null = null;
  let etaSec: number | null = null;
  if (durationSec && durationSec > 0 && snap.outTimeSec !== null) {
    percent = Math.max(0, Math.min(100, (snap.outTimeSec / durationSec) * 100));
    if (snap.end) percent = 100;
    const remaining = Math.max(0, durationSec - snap.outTimeSec);
    if (snap.speed && snap.speed > 0.01) {
      etaSec = remaining / snap.speed;
    } else if (percent > 1 && elapsedSec > 2) {
      etaSec = (elapsedSec * (100 - percent)) / percent;
    }
  }
  return {
    percent,
    outTimeSec: snap.outTimeSec,
    durationSec: durationSec ?? null,
    speed: snap.speed,
    fps: snap.fps,
    elapsedSec,
    etaSec: etaSec !== null ? Math.round(etaSec) : null,
    sizeBytes: snap.totalSize,
  };
}
