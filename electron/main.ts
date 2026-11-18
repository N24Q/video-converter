import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC } from '../shared/ipc';
import type { Diagnostics, Job } from '../shared/types';
import { registerHandlers } from './ipc/handlers';
import { createExecutor } from './services/converter';
import { FfmpegService, listVaapiDevices } from './services/ffmpegService';
import { HistoryStore, historyEntryFromJob } from './services/historyStore';
import { Logger } from './services/logger';
import { MediaLibrary } from './services/mediaLibrary';
import { JobQueue } from './services/queue';
import { killAllProcesses } from './services/runner';
import { SettingsStore } from './services/settingsStore';
import { TempTracker } from './services/tempTracker';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_INDEX = path.join(__dirname, '..', 'dist', 'index.html');
const RENDERER_URL = pathToFileURL(RENDERER_INDEX).toString();

// Allows tests (and portable setups) to use a separate settings directory.
if (process.env.VIDEO_CONVERTER_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.VIDEO_CONVERTER_USER_DATA));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
const userData = app.getPath('userData');
const logger = new Logger(path.join(userData, 'logs'));
const settings = new SettingsStore(path.join(userData, 'settings.json'));
const ffmpeg = new FfmpegService();
const history = new HistoryStore(
  path.join(userData, 'history.json'),
  () => settings.get().historyLimit,
);
const tempTracker = new TempTracker(path.join(userData, 'partial-outputs.json'));
let markToolsReady: () => void = () => {};
const toolsReady = new Promise<void>((resolve) => {
  markToolsReady = resolve;
});
const library = new MediaLibrary(
  () => ffmpeg.ffprobePath,
  () => toolsReady,
);
const approvedDirs = new Set<string>();
let vaapiDevices: string[] = [];

// eslint-disable-next-line prefer-const
let queue: JobQueue;
const executor = createExecutor({
  ffmpegPath: () => ffmpeg.ffmpegPath,
  ffprobePath: () => ffmpeg.ffprobePath,
  caps: () => ffmpeg.caps,
  vaapiDevice: () => vaapiDevices[0] ?? null,
  tempDir: path.join(app.getPath('temp'), 'video-converter'),
  tempTracker,
  reservedOutputs: () => queue.reservedOutputs(),
  log: (m) => logger.info(m),
});
queue = new JobQueue(executor, 1);

function isTrustedUrl(url: string): boolean {
  if (DEV_URL && url.startsWith(DEV_URL)) return true;
  return (
    url === RENDERER_URL || url.startsWith(`${RENDERER_URL}#`) || url.startsWith(`${RENDERER_URL}?`)
  );
}

function send(channel: string, payload: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// Throttle job updates so progress doesn't flood the renderer.
let jobTimer: NodeJS.Timeout | null = null;
function scheduleJobBroadcast() {
  if (jobTimer) return;
  jobTimer = setTimeout(() => {
    jobTimer = null;
    send(IPC.evJobs, queue.list());
  }, 250);
}
queue.on('change', scheduleJobBroadcast);
queue.on('progress', scheduleJobBroadcast);
queue.on('finished', (job: Job) => {
  if (job.status === 'failed')
    logger.warn(`job ${job.id.slice(0, 8)} failed: ${job.error?.kind}: ${job.error?.message}`);
  history.add(historyEntryFromJob(job)).catch((e) => logger.error(`history write failed: ${e}`));
});
library.on('change', () => send(IPC.evMedia, library.list()));

function isCrostini(): boolean {
  return existsSync('/opt/google/cros-containers') || existsSync('/dev/.cros_milestone');
}

async function refreshFfmpeg() {
  const s = settings.get();
  vaapiDevices = await listVaapiDevices();
  const status = await ffmpeg.refresh({ ffmpegPath: s.ffmpegPath, ffprobePath: s.ffprobePath });
  markToolsReady();
  if (status.ok) {
    logger.info(`ffmpeg ${status.capabilities?.ffmpeg.version} at ${status.ffmpegPath}`);
    library.reprobeFailed();
  } else logger.warn(`ffmpeg unavailable: ${status.error}`);
  send(IPC.evFfmpeg, status);
}

async function diagnostics(): Promise<Diagnostics> {
  return {
    appVersion: app.getVersion(),
    os: `${os.type()} ${os.release()}`,
    osRelease: await readOsRelease(),
    arch: process.arch,
    isCrostini: isCrostini(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
    userDataPath: userData,
    logPath: logger.file,
    ffmpeg: ffmpeg.getStatus(),
    vaapiDevices,
  };
}

async function readOsRelease(): Promise<string> {
  try {
    const text = await (await import('node:fs/promises')).readFile('/etc/os-release', 'utf8');
    return /^PRETTY_NAME="?([^"\n]*)"?/m.exec(text)?.[1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    title: 'Video Converter',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (DEV_URL) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadFile(RENDERER_INDEX);
}

app.on('web-contents-created', (_e, contents) => {
  // No navigation away from the app, no new windows, no webviews.
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  if (queue.activeCount() > 0 && mainWindow) {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Cancel conversions and quit', 'Keep converting'],
      defaultId: 1,
      cancelId: 1,
      message: 'Conversions are still running.',
      detail:
        'Quitting will cancel them and delete their unfinished output files. Source files are not affected.',
    });
    if (choice === 1) {
      event.preventDefault();
      return;
    }
  }
  quitting = true;
  event.preventDefault();
  queue.cancelAll();
  // Give cancelled jobs a moment to clean up their partial files.
  const deadline = Date.now() + 5000;
  const wait = () => {
    if (queue.activeCount() === 0 || Date.now() > deadline) {
      killAllProcesses();
      app.exit(0);
    } else setTimeout(wait, 100);
  };
  wait();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  // Deny all permission requests (camera, notifications, etc.).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  await settings.load();
  if (settings.loadStatus === 'corrupt')
    logger.warn('settings file was corrupt; defaults restored');
  const s = settings.get();
  queue.setConcurrency(s.maxConcurrentJobs);
  let outDir = s.defaultOutputDir;
  if (!outDir || !existsSync(outDir)) {
    const videos = app.getPath('videos');
    outDir = existsSync(videos) ? videos : app.getPath('home');
    await settings.update({ defaultOutputDir: outDir });
  }
  approvedDirs.add(outDir);
  await history.load();
  const removed = await tempTracker.cleanupStale();
  if (removed) logger.info(`removed ${removed} unfinished output file(s) from a previous session`);

  registerHandlers({
    window: () => mainWindow,
    isTrustedUrl,
    ffmpeg,
    library,
    queue,
    settings,
    history,
    approvedDirs,
    refreshFfmpeg,
    diagnostics,
    log: (m) => logger.info(m),
  });
  createWindow();
  await refreshFfmpeg();
});
