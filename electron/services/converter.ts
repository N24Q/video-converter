import fs from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import path from 'node:path';
import type { FfmpegCapabilities, Job, MediaInfo } from '../../shared/types';
import { buildArgs } from './args';
import { checkConcatCompatibility, writeConcatList } from './concat';
import { ENCODERS } from './catalog';
import { JobFailure, classifyFfmpegFailure } from './errors';
import { tempOutputPath, uniqueOutputPath, stemOf } from './outputNames';
import { planConversion } from './plan';
import { probeFile } from './probe';
import { computeProgress } from './progress';
import type { Executor } from './queue';
import { runFfmpeg } from './runner';
import type { TempTracker } from './tempTracker';

export interface ConverterDeps {
  ffmpegPath: () => string | null;
  ffprobePath: () => string | null;
  caps: () => FfmpegCapabilities | null;
  vaapiDevice: () => string | null;
  tempDir: string; // for concat list files
  tempTracker: TempTracker;
  reservedOutputs: () => Set<string>;
  log: (msg: string) => void;
  minFreeBytes?: number;
}

const MIN_FREE = 200 * 1024 * 1024;

async function freeBytes(dir: string): Promise<number | null> {
  try {
    const st = await fs.statfs(dir);
    return st.bavail * st.bsize;
  } catch {
    return null;
  }
}

async function assertReadable(p: string) {
  try {
    const st = await fs.stat(p);
    if (!st.isFile())
      throw new JobFailure('unreadable-source', `Source is not a file: ${path.basename(p)}`);
    await fs.access(p, fsConstants.R_OK);
  } catch (err) {
    if (err instanceof JobFailure) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM')
      throw new JobFailure('permission-denied', `Permission denied reading ${path.basename(p)}.`);
    throw new JobFailure(
      'unreadable-source',
      `Source file not found: ${path.basename(p)}. It may have been moved or its drive disconnected.`,
    );
  }
}

async function assertWritableDir(dir: string) {
  try {
    const st = await fs.stat(dir);
    if (!st.isDirectory()) throw new Error('not a directory');
    await fs.access(dir, fsConstants.W_OK);
  } catch {
    throw new JobFailure(
      'permission-denied',
      `The output folder is missing or not writable: ${dir}`,
    );
  }
}

/** Validates a finished output with FFprobe. Returns warnings; throws on failure. */
export async function validateOutput(
  ffprobe: string,
  file: string,
  expect: { video: boolean; audio: boolean; durationSec: number | null },
): Promise<{ info: MediaInfo; warnings: string[] }> {
  const warnings: string[] = [];
  let st;
  try {
    st = await fs.stat(file);
  } catch {
    throw new JobFailure(
      'output-validation-failed',
      'FFmpeg reported success but no output file was written.',
    );
  }
  if (st.size === 0) throw new JobFailure('output-validation-failed', 'The output file is empty.');
  let info: MediaInfo;
  try {
    info = await probeFile(ffprobe, file);
  } catch (err) {
    throw new JobFailure(
      'output-validation-failed',
      `The output file could not be read back: ${(err as Error).message}`,
    );
  }
  const has = (t: string) => info.streams.some((s) => s.type === t);
  if (expect.video && !has('video'))
    throw new JobFailure('output-validation-failed', 'The output is missing its video stream.');
  if (expect.audio && !has('audio'))
    throw new JobFailure('output-validation-failed', 'The output is missing its audio stream.');
  if (
    expect.durationSec &&
    expect.durationSec > 2 &&
    info.duration !== null &&
    info.duration < expect.durationSec * 0.9 - 1
  ) {
    warnings.push(
      `The output is shorter than the source (${info.duration.toFixed(1)} s vs ${expect.durationSec.toFixed(1)} s). The source may be damaged near the end.`,
    );
  }
  return { info, warnings };
}

export function createExecutor(deps: ConverterDeps): Executor {
  return async (job: Job, ctx) => {
    const ffmpeg = deps.ffmpegPath();
    const ffprobe = deps.ffprobePath();
    const caps = deps.caps();
    if (!ffmpeg || !caps)
      throw new JobFailure('ffmpeg-missing', 'FFmpeg is not installed or could not be started.');
    if (!ffprobe)
      throw new JobFailure('ffprobe-missing', 'FFprobe is not installed or could not be started.');

    // ---- prepare ----
    for (const s of job.sources) await assertReadable(s);
    const outDir = path.dirname(job.outputPath);
    await assertWritableDir(outDir);
    const free = await freeBytes(outDir);
    if (free !== null && free < (deps.minFreeBytes ?? MIN_FREE)) {
      throw new JobFailure(
        'disk-full',
        `Not enough free space in the output folder (${Math.round(free / 1048576)} MB free).`,
      );
    }

    // Re-probe now: the file may have changed since import.
    const infos: MediaInfo[] = [];
    for (const s of job.sources) {
      if (ctx.signal.aborted) throw new Error('aborted');
      try {
        infos.push(await probeFile(ffprobe, s));
      } catch (err) {
        throw new JobFailure('unsupported-input', `${path.basename(s)}: ${(err as Error).message}`);
      }
    }
    const primary = infos[0];
    const validation = planConversion(primary, job.settings, caps);
    if (!validation.ok) {
      throw new JobFailure('unsupported-combination', validation.errors.join(' '));
    }
    validation.warnings.forEach((w) => ctx.addWarning(w));

    const totalDuration = infos.every((i) => i.duration)
      ? infos.reduce((a, i) => a + (i.duration ?? 0), 0)
      : null;
    const copying = validation.plan.some((p) => p.action === 'copy');
    const sourceBytes = infos.reduce((a, i) => a + (i.size ?? 0), 0);
    if (free !== null && copying && sourceBytes > 0 && free < sourceBytes * 1.05) {
      throw new JobFailure(
        'disk-full',
        `Not enough free space: about ${Math.round(sourceBytes / 1048576)} MB is needed, ${Math.round(free / 1048576)} MB is free.`,
      );
    }

    let input: Parameters<typeof buildArgs>[0]['input'];
    let listPath: string | null = null;
    if (job.mode === 'concat') {
      const check = checkConcatCompatibility(infos);
      if (job.concatStrategy === 'demuxer') {
        if (!check.compatible) {
          throw new JobFailure(
            'unsupported-combination',
            `These recordings cannot be joined directly: ${check.differences.join(' ')} Use "combine with re-encoding" instead.`,
          );
        }
        await fs.mkdir(deps.tempDir, { recursive: true });
        listPath = path.join(deps.tempDir, `concat-${job.id}.txt`);
        await writeConcatList(listPath, job.sources);
        input = { kind: 'concat-list', listPath };
      } else {
        if (
          job.settings.video.mode !== 'encode' &&
          primary.streams.some((s) => s.type === 'video')
        ) {
          throw new JobFailure(
            'unsupported-combination',
            'Combining recordings with different parameters requires re-encoding the video.',
          );
        }
        input = { kind: 'normalise', clips: infos };
      }
    } else {
      input = { kind: 'file', path: job.sources[0] };
    }

    const encVideo = validation.plan.find(
      (p) => p.type === 'video' && p.action === 'encode',
    )?.targetCodec;
    const hw = encVideo ? ENCODERS[encVideo]?.hw : undefined;
    job.hwEncoderUsed = !!hw;
    const vaapiDevice = hw === 'vaapi' ? deps.vaapiDevice() : null;
    if (hw === 'vaapi' && !vaapiDevice) {
      throw new JobFailure(
        'hw-encoder-failed',
        'No VAAPI device is available. Retry with the software (CPU) encoder.',
      );
    }

    const temp = tempOutputPath(job.outputPath, job.id);
    await fs.rm(temp, { force: true });
    const args = buildArgs({
      settings: job.settings,
      plan: validation.plan,
      info: primary,
      outputPath: temp,
      vaapiDevice,
      input,
    });
    deps.log(
      `job ${job.id.slice(0, 8)} start: ${job.sources.length} source(s) -> ${job.settings.formatId}`,
    );

    // ---- convert ----
    if (ctx.signal.aborted) throw new Error('aborted');
    ctx.setStatus('converting');
    await deps.tempTracker.add(temp);
    const started = Date.now();
    const handle = runFfmpeg(ffmpeg, args, (snap) => {
      ctx.onProgress(computeProgress(snap, totalDuration, (Date.now() - started) / 1000));
    });
    const onAbort = () => handle.cancel();
    ctx.signal.addEventListener('abort', onAbort);

    const cleanup = async () => {
      await fs.rm(temp, { force: true }).catch(() => {});
      await deps.tempTracker.remove(temp).catch(() => {});
      if (listPath) await fs.rm(listPath, { force: true }).catch(() => {});
    };

    let result;
    try {
      result = await handle.promise;
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }

    if (result.cancelled || ctx.signal.aborted) {
      await cleanup();
      throw new Error('aborted');
    }
    if (result.spawnError) {
      await cleanup();
      throw new JobFailure('ffmpeg-missing', `FFmpeg could not be started: ${result.spawnError}`);
    }
    if (result.code !== 0) {
      await cleanup();
      const err = classifyFfmpegFailure(result.stderr, result.code, result.signal, {
        hwEncoder: !!hw,
      });
      deps.log(
        `job ${job.id.slice(0, 8)} failed: ${err.kind} (exit ${result.code}, signal ${result.signal})`,
      );
      throw new JobFailure(err.kind, err.message, err.details);
    }

    // ---- validate & finalise ----
    try {
      const kept = validation.plan.filter((p) => p.action !== 'drop');
      const { warnings } = await validateOutput(ffprobe, temp, {
        video: kept.some((p) => p.type === 'video'),
        audio: kept.some((p) => p.type === 'audio'),
        durationSec: totalDuration,
      });
      warnings.forEach((w) => ctx.addWarning(w));
    } catch (err) {
      await cleanup();
      throw err;
    }

    let finalPath = job.outputPath;
    const sources = new Set(job.sources);
    if (existsSync(finalPath) && (!job.overwrite || sources.has(finalPath))) {
      // Something appeared at the destination while we were converting.
      const reserved = deps.reservedOutputs();
      reserved.delete(finalPath);
      finalPath = uniqueOutputPath(outDir, stemOf(finalPath), path.extname(finalPath).slice(1), {
        exists: existsSync,
        reserved,
        sources,
      });
      ctx.addWarning(
        `A file appeared at the original destination, so the output was saved as ${path.basename(finalPath)}.`,
      );
    }
    try {
      await fs.rename(temp, finalPath);
    } catch (err) {
      await cleanup();
      throw new JobFailure(
        'permission-denied',
        `Could not move the finished file into place: ${(err as Error).message}`,
      );
    }
    await deps.tempTracker.remove(temp).catch(() => {});
    if (listPath) await fs.rm(listPath, { force: true }).catch(() => {});
    deps.log(
      `job ${job.id.slice(0, 8)} completed in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    return { outputPath: finalPath };
  };
}
