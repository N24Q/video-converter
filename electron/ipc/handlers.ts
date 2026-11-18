import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { IPC } from '../../shared/ipc';
import type { AddJobsResult, AppSettings, Job, PresetId } from '../../shared/types';
import { buildArgs } from '../services/args';
import { getFormats, INPUT_EXTENSIONS } from '../services/catalog';
import { checkConcatCompatibility } from '../services/concat';
import type { FfmpegService } from '../services/ffmpegService';
import type { HistoryStore } from '../services/historyStore';
import type { MediaLibrary } from '../services/mediaLibrary';
import { isSanePath } from '../services/mediaLibrary';
import { preferredOutputPath, stemOf, uniqueOutputPath } from '../services/outputNames';
import { planConversion } from '../services/plan';
import { listPresets, resolvePreset, softwareEquivalent } from '../services/presets';
import type { JobQueue } from '../services/queue';
import { isFinished } from '../services/queue';
import type { SettingsStore } from '../services/settingsStore';
import {
  assertId,
  assertIdList,
  IpcValidationError,
  sanitizeJobRequest,
  sanitizeSettings,
} from './validate';
import type { Diagnostics } from '../../shared/types';

export interface HandlerContext {
  window: () => BrowserWindow | null;
  isTrustedUrl: (url: string) => boolean;
  ffmpeg: FfmpegService;
  library: MediaLibrary;
  queue: JobQueue;
  settings: SettingsStore;
  history: HistoryStore;
  approvedDirs: Set<string>;
  refreshFfmpeg: () => Promise<void>;
  diagnostics: () => Promise<Diagnostics>;
  log: (m: string) => void;
}

type Handler = (ctx: HandlerContext, ...args: unknown[]) => unknown;

/**
 * Register a handler that rejects calls from anything other than our own
 * renderer and turns validation errors into plain messages.
 */
function handle(ctx: HandlerContext, channel: string, fn: Handler) {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const url = event.senderFrame?.url ?? '';
    if (!ctx.isTrustedUrl(url)) {
      ctx.log(`rejected IPC ${channel} from untrusted frame`);
      throw new Error('Untrusted sender');
    }
    try {
      return await fn(ctx, ...args);
    } catch (err) {
      if (err instanceof IpcValidationError) throw new Error(err.message);
      throw err;
    }
  });
}

function parentWindow(ctx: HandlerContext) {
  return ctx.window() ?? undefined;
}

async function chooseOutputDirDialog(ctx: HandlerContext): Promise<string | null> {
  const s = ctx.settings.get();
  const opts: Electron.OpenDialogOptions = {
    title: 'Choose output folder',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: s.defaultOutputDir ?? undefined,
  };
  const win = parentWindow(ctx);
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  ctx.approvedDirs.add(dir);
  await ctx.settings.update({ defaultOutputDir: dir });
  return dir;
}

async function addJobs(ctx: HandlerContext, raw: unknown): Promise<AddJobsResult> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 1000)
    throw new IpcValidationError('Invalid job list');
  const caps = ctx.ffmpeg.caps;
  const settings = ctx.settings.get();
  const result: AddJobsResult = { added: [], rejected: [] };

  type Pending = { job: Job; preferred: string; stem: string; dir: string };
  const pending: Pending[] = [];
  const reserved = ctx.queue.reservedOutputs();

  for (const r of raw) {
    let req;
    try {
      req = sanitizeJobRequest(r);
    } catch (err) {
      result.rejected.push({ mediaIds: [], reason: (err as Error).message });
      continue;
    }
    const reject = (reason: string) => result.rejected.push({ mediaIds: req.mediaIds, reason });

    if (!ctx.approvedDirs.has(req.outputDir)) {
      reject('Choose the output folder with the "Output folder" button first.');
      continue;
    }
    const items = req.mediaIds.map((id) => ctx.library.get(id));
    if (items.some((m) => !m)) {
      reject('One of the selected files is no longer in the list.');
      continue;
    }
    const notReady = items.find((m) => m!.status !== 'ready' || !m!.info);
    if (notReady) {
      reject(
        `${notReady.name} could not be inspected${notReady.error ? `: ${notReady.error}` : ''}.`,
      );
      continue;
    }
    const infos = items.map((m) => m!.info!);
    const validation = planConversion(infos[0], req.settings, caps);
    if (!validation.ok) {
      reject(validation.errors.join(' '));
      continue;
    }

    let concatStrategy: Job['concatStrategy'] = null;
    if (req.mode === 'concat') {
      const check = checkConcatCompatibility(infos);
      if (check.compatible) concatStrategy = 'demuxer';
      else if (req.settings.video.mode === 'copy' || req.settings.audio.mode === 'copy') {
        reject(
          `These recordings have different parameters and cannot be joined without re-encoding: ${check.differences.join(' ')}`,
        );
        continue;
      } else concatStrategy = 'normalise';
    }

    const sources = items.map((m) => m!.path);
    const stem = req.mode === 'concat' ? `${stemOf(sources[0])}_combined` : stemOf(sources[0]);
    const job: Job = {
      id: randomUUID(),
      mode: req.mode,
      sources,
      sourceNames: items.map((m) => m!.name),
      outputPath: '',
      settings: req.settings,
      concatStrategy,
      status: 'waiting',
      progress: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      error: null,
      warnings: validation.warnings,
      attempts: 0,
      hwEncoderUsed: false,
      overwrite: false,
    };
    pending.push({
      job,
      preferred: preferredOutputPath(req.outputDir, stem, req.settings.extension),
      stem,
      dir: req.outputDir,
    });
  }

  // Decide output paths, asking once if any would overwrite an existing file.
  const allSources = new Set(pending.flatMap((p) => p.job.sources));
  let policy = settings.conflictBehaviour;
  const conflicts = pending.filter((p) => existsSync(p.preferred) && !allSources.has(p.preferred));
  if (policy === 'ask' && conflicts.length) {
    const opts: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: ['Keep both (rename new files)', 'Overwrite existing files', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Files already exist',
      message: `${conflicts.length} output file(s) already exist.`,
      detail: conflicts
        .slice(0, 8)
        .map((c) => path.basename(c.preferred))
        .join('\n'),
    };
    const win = parentWindow(ctx);
    const answer = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (answer.response === 2) {
      result.rejected.push({
        mediaIds: [],
        reason: `Cancelled: ${conflicts.length} output file(s) already exist.`,
      });
      return result;
    }
    policy = answer.response === 1 ? 'overwrite' : 'unique';
  }

  for (const p of pending) {
    const canOverwrite =
      policy === 'overwrite' && !allSources.has(p.preferred) && !reserved.has(p.preferred);
    if (canOverwrite) {
      p.job.outputPath = p.preferred;
      p.job.overwrite = existsSync(p.preferred);
    } else {
      p.job.outputPath = uniqueOutputPath(p.dir, p.stem, p.job.settings.extension, {
        exists: existsSync,
        reserved,
        sources: allSources,
      });
    }
    reserved.add(p.job.outputPath);
    try {
      ctx.queue.add(p.job);
      result.added.push(p.job);
    } catch (err) {
      result.rejected.push({ mediaIds: [], reason: (err as Error).message });
    }
  }
  return result;
}

export function registerHandlers(ctx: HandlerContext) {
  handle(ctx, IPC.getDiagnostics, (c) => c.diagnostics());
  handle(ctx, IPC.getFfmpegStatus, (c) => c.ffmpeg.getStatus());
  handle(ctx, IPC.refreshFfmpeg, async (c) => {
    await c.refreshFfmpeg();
    return c.ffmpeg.getStatus();
  });
  handle(ctx, IPC.getFormats, (c) => getFormats(c.ffmpeg.caps));
  handle(ctx, IPC.getPresets, (c) => listPresets(c.ffmpeg.caps));
  handle(ctx, IPC.resolvePreset, (c, presetId, formatId) => {
    if (typeof presetId !== 'string' || typeof formatId !== 'string')
      throw new IpcValidationError('Invalid preset');
    return resolvePreset(presetId as PresetId, formatId, c.ffmpeg.caps, c.settings.get());
  });

  handle(ctx, IPC.openFiles, async (c) => {
    const opts: Electron.OpenDialogOptions = {
      title: 'Add media files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media files',
          extensions: [...INPUT_EXTENSIONS, ...INPUT_EXTENSIONS.map((e) => e.toUpperCase())],
        },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const win = parentWindow(c);
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || r.filePaths.length === 0) return null;
    return c.library.importPaths(r.filePaths);
  });
  handle(ctx, IPC.openFolder, async (c) => {
    const opts: Electron.OpenDialogOptions = {
      title: 'Add a folder (e.g. an AVCHD camcorder card)',
      properties: ['openDirectory'],
    };
    const win = parentWindow(c);
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || r.filePaths.length === 0) return null;
    return c.library.importPaths(r.filePaths);
  });
  handle(ctx, IPC.importDropped, async (c, paths) => {
    // Paths come from webUtils.getPathForFile() on files the user dropped.
    // They are validated (absolute, exist, regular file/dir) before use.
    if (!Array.isArray(paths) || paths.length > 1000) throw new IpcValidationError('Invalid drop');
    const clean = paths.filter(isSanePath);
    return c.library.importPaths(clean);
  });
  handle(ctx, IPC.removeMedia, (c, id) => c.library.remove(assertId(id)));
  handle(ctx, IPC.clearMedia, (c) => c.library.clear());
  handle(ctx, IPC.listMedia, (c) => c.library.list());
  handle(ctx, IPC.checkConcat, (c, ids) => {
    const items = assertIdList(ids).map((id) => c.library.get(id));
    if (items.some((m) => !m?.info))
      return { compatible: false, differences: ['Some recordings have not been inspected yet.'] };
    return checkConcatCompatibility(items.map((m) => m!.info!));
  });

  handle(ctx, IPC.chooseOutputDir, (c) => chooseOutputDirDialog(c));
  handle(ctx, IPC.openOutputFolder, async (c, id) => {
    const job = c.queue.get(assertId(id));
    if (!job) return;
    if (job.status === 'completed' && existsSync(job.outputPath))
      shell.showItemInFolder(job.outputPath);
    else await shell.openPath(path.dirname(job.outputPath));
  });

  handle(ctx, IPC.preview, (c, mediaId, rawSettings) => {
    const item = c.library.get(assertId(mediaId));
    if (!item?.info) throw new IpcValidationError('The file has not been inspected yet.');
    const settings = sanitizeSettings(rawSettings);
    const validation = planConversion(item.info, settings, c.ffmpeg.caps);
    const outputName = `${stemOf(item.path)}.${settings.extension}`;
    const args = validation.ok
      ? buildArgs({
          settings,
          plan: validation.plan,
          info: item.info,
          outputPath: `<output folder>/${outputName}`,
          vaapiDevice: '/dev/dri/renderD128',
          input: { kind: 'file', path: item.path },
        })
      : [];
    return { validation, args, outputName };
  });

  handle(ctx, IPC.addJobs, (c, raw) => addJobs(c, raw));
  handle(ctx, IPC.listJobs, (c) => c.queue.list());
  handle(ctx, IPC.cancelJob, (c, id) => c.queue.cancel(assertId(id)));
  handle(ctx, IPC.retryJob, (c, id) => {
    const job = c.queue.get(assertId(id));
    if (!job) return;
    if (job.outputPath && existsSync(job.outputPath) && !job.overwrite) {
      // keep the earlier result; pick a fresh name
      const reserved = c.queue.reservedOutputs();
      const outputPath = uniqueOutputPath(
        path.dirname(job.outputPath),
        stemOf(job.outputPath),
        job.settings.extension,
        {
          exists: existsSync,
          reserved,
          sources: new Set(job.sources),
        },
      );
      c.queue.retry(job.id, { outputPath });
    } else c.queue.retry(job.id);
  });
  handle(ctx, IPC.retryJobSoftware, (c, id) => {
    const job = c.queue.get(assertId(id));
    if (!job || !job.settings.video.encoder) return { ok: false, message: 'Job not found.' };
    const sw = softwareEquivalent(c.ffmpeg.caps, job.settings.video.encoder);
    if (!sw) return { ok: false, message: 'No software encoder for this codec is available.' };
    const settings = structuredClone(job.settings);
    settings.video.encoder = sw;
    settings.video.hwaccel = 'none';
    settings.video.quality = null;
    const ok = c.queue.retry(job.id, { settings, hwEncoderUsed: false });
    return {
      ok,
      message: ok ? `Retrying with the ${sw} software encoder.` : 'This job cannot be retried now.',
    };
  });
  handle(ctx, IPC.removeJob, (c, id) => {
    const job = c.queue.get(assertId(id));
    if (job && !isFinished(job.status) && job.status !== 'waiting') return;
    c.queue.remove(assertId(id));
  });
  handle(ctx, IPC.clearFinished, (c) => c.queue.clearFinished());
  handle(ctx, IPC.getHistory, (c) => c.history.list());
  handle(ctx, IPC.clearHistory, (c) => c.history.clear());
  handle(ctx, IPC.getSettings, (c) => c.settings.get());
  handle(ctx, IPC.setSettings, async (c, patch) => {
    // Paths can only be set through dialogs, never from the renderer directly
    // (null = reset to automatic discovery is allowed).
    const p = { ...(patch as Record<string, unknown>) };
    for (const key of ['defaultOutputDir', 'ffmpegPath', 'ffprobePath'] as const) {
      if (key in p && p[key] !== null) delete p[key];
    }
    const before = c.settings.get();
    const { settings } = await c.settings.update(p);
    if (settings.maxConcurrentJobs !== before.maxConcurrentJobs)
      c.queue.setConcurrency(settings.maxConcurrentJobs);
    if (settings.ffmpegPath !== before.ffmpegPath || settings.ffprobePath !== before.ffprobePath) {
      await c.refreshFfmpeg();
    }
    return settings;
  });
  handle(ctx, IPC.chooseExecutable, async (c, kind) => {
    if (kind !== 'ffmpeg' && kind !== 'ffprobe')
      throw new IpcValidationError('Invalid executable kind');
    const opts: Electron.OpenDialogOptions = { title: `Locate ${kind}`, properties: ['openFile'] };
    const win = parentWindow(c);
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    try {
      const st = await fs.stat(file);
      if (!st.isFile()) return null;
    } catch {
      return null;
    }
    const patch: Partial<AppSettings> =
      kind === 'ffmpeg' ? { ffmpegPath: file } : { ffprobePath: file };
    await c.settings.update(patch);
    await c.refreshFfmpeg();
    return file;
  });
}
