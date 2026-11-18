import { spawn, type ChildProcess } from 'node:child_process';
import { ProgressParser, type ProgressSnapshot } from './progress';

/** Keeps only the last N lines (each truncated) of a stream. */
export class LineRing {
  private lines: string[] = [];
  private partial = '';
  constructor(
    private readonly maxLines = 200,
    private readonly maxLineLength = 1000,
  ) {}

  push(chunk: string) {
    const text = this.partial + chunk;
    const parts = text.split(/\r?\n|\r/);
    this.partial = (parts.pop() ?? '').slice(-this.maxLineLength);
    for (const p of parts) {
      if (!p.trim()) continue;
      this.lines.push(p.length > this.maxLineLength ? p.slice(0, this.maxLineLength) + '…' : p);
      if (this.lines.length > this.maxLines) this.lines.shift();
    }
  }

  text(): string {
    const all = this.partial.trim() ? [...this.lines, this.partial] : this.lines;
    return all.join('\n');
  }
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
  stderr: string;
  spawnError: string | null;
}

export interface RunHandle {
  promise: Promise<RunResult>;
  cancel(): void;
  readonly pid: number | undefined;
}

const live = new Set<ChildProcess>();

/** Kill every FFmpeg process we started (used on app quit). */
export function killAllProcesses() {
  for (const p of live) {
    try {
      p.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
  live.clear();
}

export function liveProcessCount() {
  return live.size;
}

/**
 * Spawn FFmpeg with an argument array (no shell). Progress comes from
 * `-progress pipe:1` on stdout; stderr is kept in a bounded ring buffer.
 */
export function runFfmpeg(
  ffmpeg: string,
  args: string[],
  onProgress: (s: ProgressSnapshot) => void,
  opts: { killGraceMs?: number } = {},
): RunHandle {
  const killGraceMs = opts.killGraceMs ?? 4000;
  const parser = new ProgressParser();
  const ring = new LineRing();
  let cancelled = false;
  let killTimer: NodeJS.Timeout | null = null;

  let child: ChildProcess;
  try {
    child = spawn(ffmpeg, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err) {
    return {
      promise: Promise.resolve({
        code: null,
        signal: null,
        cancelled: false,
        stderr: '',
        spawnError: (err as Error).message,
      }),
      cancel() {},
      pid: undefined,
    };
  }
  live.add(child);

  const promise = new Promise<RunResult>((resolve) => {
    let spawnError: string | null = null;
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => {
      for (const snap of parser.feed(d)) onProgress(snap);
    });
    child.stderr!.on('data', (d: string) => ring.push(d));
    child.on('error', (err) => {
      spawnError = err.message;
    });
    child.on('close', (code, signal) => {
      live.delete(child);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code, signal, cancelled, stderr: ring.text(), spawnError });
    });
  });

  return {
    promise,
    pid: child.pid,
    cancel() {
      if (cancelled || child.exitCode !== null || child.signalCode !== null) return;
      cancelled = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, killGraceMs);
    },
  };
}
