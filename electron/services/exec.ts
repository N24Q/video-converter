import { spawn } from 'node:child_process';

export interface CaptureResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
}

export interface CaptureOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Run an executable with an argument array (never through a shell) and
 * capture its output, bounded to `maxBytes` per stream.
 */
export function runCapture(
  file: string,
  args: string[],
  { timeoutMs = 15_000, maxBytes = 4 * 1024 * 1024 }: CaptureOptions = {},
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (r: Omit<CaptureResult, 'stdout' | 'stderr' | 'timedOut'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...r, stdout, stderr, timedOut });
    };

    let child;
    try {
      child = spawn(file, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        spawnError: (err as Error).message,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      if (stdout.length < maxBytes) stdout += d.slice(0, maxBytes - stdout.length);
    });
    child.stderr.on('data', (d: string) => {
      if (stderr.length < maxBytes) stderr += d.slice(0, maxBytes - stderr.length);
    });
    child.on('error', (err) => finish({ code: null, signal: null, spawnError: err.message }));
    child.on('close', (code, signal) => finish({ code, signal, spawnError: null }));
  });
}
