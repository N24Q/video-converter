import { EventEmitter } from 'node:events';
import type { Job, JobProgress, JobStatus } from '../../shared/types';
import { JobFailure } from './errors';

export interface ExecutorContext {
  signal: AbortSignal;
  setStatus(status: Extract<JobStatus, 'preparing' | 'converting'>): void;
  onProgress(p: JobProgress): void;
  addWarning(w: string): void;
}

export interface ExecutorResult {
  outputPath: string;
}

export type Executor = (job: Job, ctx: ExecutorContext) => Promise<ExecutorResult>;

const FINISHED: JobStatus[] = ['completed', 'failed', 'cancelled'];
export const isFinished = (s: JobStatus) => FINISHED.includes(s);

/**
 * In-memory conversion queue. Runs up to `concurrency` jobs at a time, each
 * through the executor, and tracks state transitions:
 *   waiting -> preparing -> converting -> completed | failed | cancelled
 *
 * Emits 'change' (throttled by the caller) and 'finished' (job).
 */
export class JobQueue extends EventEmitter {
  private jobs = new Map<string, Job>();
  private order: string[] = [];
  private running = new Map<string, AbortController>();

  constructor(
    private executor: Executor,
    private concurrency = 1,
  ) {
    super();
  }

  setConcurrency(n: number) {
    this.concurrency = Math.max(1, Math.min(8, Math.floor(n) || 1));
    this.pump();
  }

  list(): Job[] {
    return this.order.map((id) => this.jobs.get(id)!).filter(Boolean);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Output paths that queued/active jobs will write. */
  reservedOutputs(): Set<string> {
    return new Set(
      this.list()
        .filter((j) => !isFinished(j.status))
        .map((j) => j.outputPath),
    );
  }

  add(job: Job) {
    if (this.jobs.has(job.id)) throw new Error(`Duplicate job id ${job.id}`);
    if (this.reservedOutputs().has(job.outputPath)) {
      throw new Error(`Another queued job already writes to ${job.outputPath}`);
    }
    this.jobs.set(job.id, job);
    this.order.push(job.id);
    this.changed();
    this.pump();
  }

  cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.status === 'waiting') {
      this.finish(job, 'cancelled', {
        kind: 'cancelled',
        message: 'Cancelled before it started.',
        details: null,
      });
      return;
    }
    const ctl = this.running.get(id);
    if (ctl) ctl.abort();
  }

  cancelAll() {
    for (const j of this.list()) this.cancel(j.id);
  }

  retry(id: string, patch?: Partial<Pick<Job, 'settings' | 'outputPath' | 'hwEncoderUsed'>>) {
    const job = this.jobs.get(id);
    if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return false;
    if (patch?.outputPath && this.reservedOutputs().has(patch.outputPath)) return false;
    Object.assign(job, patch ?? {});
    job.status = 'waiting';
    job.error = null;
    job.progress = null;
    job.startedAt = null;
    job.endedAt = null;
    job.warnings = [];
    this.changed();
    this.pump();
    return true;
  }

  /** Remove a job that is waiting or finished. Active jobs must be cancelled first. */
  remove(id: string) {
    const job = this.jobs.get(id);
    if (!job || this.running.has(id)) return false;
    this.jobs.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.changed();
    return true;
  }

  clearFinished() {
    for (const j of this.list()) if (isFinished(j.status)) this.remove(j.id);
  }

  activeCount() {
    return this.running.size;
  }

  private changed() {
    this.emit('change');
  }

  private finish(job: Job, status: JobStatus, error: Job['error']) {
    job.status = status;
    job.error = error;
    job.endedAt = new Date().toISOString();
    this.changed();
    this.emit('finished', job);
  }

  private pump() {
    while (this.running.size < this.concurrency) {
      const next = this.list().find((j) => j.status === 'waiting');
      if (!next) return;
      this.start(next);
    }
  }

  private start(job: Job) {
    const ctl = new AbortController();
    this.running.set(job.id, ctl);
    job.status = 'preparing';
    job.attempts += 1;
    job.startedAt = new Date().toISOString();
    this.changed();

    const ctx: ExecutorContext = {
      signal: ctl.signal,
      setStatus: (s) => {
        if (ctl.signal.aborted) return;
        job.status = s;
        this.changed();
      },
      onProgress: (p) => {
        job.progress = p;
        this.emit('progress', job);
      },
      addWarning: (w) => {
        if (!job.warnings.includes(w)) job.warnings.push(w);
      },
    };

    Promise.resolve()
      .then(() => this.executor(job, ctx))
      .then(
        (res) => {
          job.outputPath = res.outputPath;
          if (job.progress) job.progress = { ...job.progress, percent: 100, etaSec: 0 };
          this.finish(job, 'completed', null);
        },
        (err: unknown) => {
          if (ctl.signal.aborted) {
            this.finish(job, 'cancelled', {
              kind: 'cancelled',
              message: 'Conversion cancelled.',
              details: null,
            });
          } else if (err instanceof JobFailure) {
            this.finish(job, 'failed', err.toJobError());
          } else {
            this.finish(job, 'failed', {
              kind: 'unknown',
              message: (err as Error)?.message ?? 'Unknown error',
              details: (err as Error)?.stack ?? null,
            });
          }
        },
      )
      .finally(() => {
        this.running.delete(job.id);
        this.pump();
      });
  }
}
