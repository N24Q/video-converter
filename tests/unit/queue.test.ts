import { describe, expect, it } from 'vitest';
import { JobQueue, type Executor } from '../../electron/services/queue';
import { JobFailure } from '../../electron/services/errors';
import { baseSettings } from '../../electron/services/presets';
import type { Job } from '../../shared/types';

let n = 0;
function job(out = `/out/${++n}.mp4`): Job {
  return {
    id: `job-${++n}`,
    mode: 'single',
    sources: ['/in/a.mts'],
    sourceNames: ['a.mts'],
    outputPath: out,
    settings: baseSettings(),
    concatStrategy: null,
    status: 'waiting',
    progress: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    error: null,
    warnings: [],
    attempts: 0,
    hwEncoderUsed: false,
  };
}

/** Executor whose jobs complete/fail when the test says so. */
function controllable() {
  const pending = new Map<string, { resolve: () => void; reject: (e: unknown) => void }>();
  const exec: Executor = (j, ctx) =>
    new Promise((resolve, reject) => {
      ctx.setStatus('converting');
      ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
      pending.set(j.id, { resolve: () => resolve({ outputPath: j.outputPath }), reject });
    });
  return { exec, pending };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('JobQueue', () => {
  it('runs one job at a time by default and follows state transitions', async () => {
    const { exec, pending } = controllable();
    const q = new JobQueue(exec);
    const a = job();
    const b = job();
    q.add(a);
    q.add(b);
    await tick();
    expect(a.status).toBe('converting');
    expect(b.status).toBe('waiting');
    pending.get(a.id)!.resolve();
    await tick();
    await tick();
    expect(a.status).toBe('completed');
    expect(a.endedAt).not.toBeNull();
    expect(b.status).toBe('converting');
  });

  it('respects a configurable concurrency limit', async () => {
    const { exec } = controllable();
    const q = new JobQueue(exec, 2);
    const jobs = [job(), job(), job()];
    jobs.forEach((j) => q.add(j));
    await tick();
    expect(jobs.map((j) => j.status)).toEqual(['converting', 'converting', 'waiting']);
    q.setConcurrency(3);
    await tick();
    expect(jobs[2].status).toBe('converting');
  });

  it('cancels active and waiting jobs', async () => {
    const { exec } = controllable();
    const q = new JobQueue(exec);
    const a = job();
    const b = job();
    q.add(a);
    q.add(b);
    await tick();
    q.cancel(b.id);
    expect(b.status).toBe('cancelled');
    q.cancel(a.id);
    await tick();
    await tick();
    expect(a.status).toBe('cancelled');
    expect(a.error?.kind).toBe('cancelled');
  });

  it('records failures and supports retry', async () => {
    const { exec, pending } = controllable();
    const q = new JobQueue(exec);
    const a = job();
    q.add(a);
    await tick();
    pending.get(a.id)!.reject(new JobFailure('disk-full', 'Out of space', 'details'));
    await tick();
    await tick();
    expect(a.status).toBe('failed');
    expect(a.error).toEqual({ kind: 'disk-full', message: 'Out of space', details: 'details' });
    expect(q.retry(a.id)).toBe(true);
    await tick();
    expect(a.status).toBe('converting');
    expect(a.attempts).toBe(2);
    expect(a.error).toBeNull();
  });

  it('prevents two queued jobs writing the same output', () => {
    const q = new JobQueue(controllable().exec);
    q.add(job('/out/same.mp4'));
    expect(() => q.add(job('/out/same.mp4'))).toThrow(/already writes/);
  });

  it('removes only waiting/finished jobs and clears finished ones', async () => {
    const { exec, pending } = controllable();
    const q = new JobQueue(exec);
    const a = job();
    const b = job();
    q.add(a);
    q.add(b);
    await tick();
    expect(q.remove(a.id)).toBe(false); // active
    expect(q.remove(b.id)).toBe(true);
    pending.get(a.id)!.resolve();
    await tick();
    await tick();
    q.clearFinished();
    expect(q.list()).toEqual([]);
  });

  it('emits finished events for history', async () => {
    const { exec, pending } = controllable();
    const q = new JobQueue(exec);
    const done: string[] = [];
    q.on('finished', (j: Job) => done.push(`${j.id}:${j.status}`));
    const a = job();
    q.add(a);
    await tick();
    pending.get(a.id)!.resolve();
    await tick();
    await tick();
    expect(done).toEqual([`${a.id}:completed`]);
  });
});
