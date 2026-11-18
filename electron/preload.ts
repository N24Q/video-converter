import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type VideoConverterApi } from '../shared/ipc';

// The only bridge between the sandboxed renderer and the main process.
// Each function maps to one validated IPC channel; no Node APIs are exposed.

function subscribe<T>(channel: string, cb: (data: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, data: T) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: VideoConverterApi = {
  getDiagnostics: () => ipcRenderer.invoke(IPC.getDiagnostics),
  getFfmpegStatus: () => ipcRenderer.invoke(IPC.getFfmpegStatus),
  refreshFfmpeg: () => ipcRenderer.invoke(IPC.refreshFfmpeg),
  getFormats: () => ipcRenderer.invoke(IPC.getFormats),
  getPresets: () => ipcRenderer.invoke(IPC.getPresets),
  resolvePreset: (presetId, formatId, mediaId) =>
    ipcRenderer.invoke(IPC.resolvePreset, presetId, formatId, mediaId),
  openFiles: () => ipcRenderer.invoke(IPC.openFiles),
  openFolder: () => ipcRenderer.invoke(IPC.openFolder),
  importDropped: (files: File[]) => {
    const paths = files.map((f) => webUtils.getPathForFile(f)).filter((p) => !!p);
    return ipcRenderer.invoke(IPC.importDropped, paths);
  },
  removeMedia: (id) => ipcRenderer.invoke(IPC.removeMedia, id),
  clearMedia: () => ipcRenderer.invoke(IPC.clearMedia),
  listMedia: () => ipcRenderer.invoke(IPC.listMedia),
  checkConcat: (ids) => ipcRenderer.invoke(IPC.checkConcat, ids),
  chooseOutputDir: () => ipcRenderer.invoke(IPC.chooseOutputDir),
  openOutputFolder: (jobId) => ipcRenderer.invoke(IPC.openOutputFolder, jobId),
  preview: (mediaId, settings) => ipcRenderer.invoke(IPC.preview, mediaId, settings),
  addJobs: (requests) => ipcRenderer.invoke(IPC.addJobs, requests),
  listJobs: () => ipcRenderer.invoke(IPC.listJobs),
  cancelJob: (id) => ipcRenderer.invoke(IPC.cancelJob, id),
  retryJob: (id) => ipcRenderer.invoke(IPC.retryJob, id),
  retryJobSoftware: (id) => ipcRenderer.invoke(IPC.retryJobSoftware, id),
  removeJob: (id) => ipcRenderer.invoke(IPC.removeJob, id),
  clearFinished: () => ipcRenderer.invoke(IPC.clearFinished),
  getHistory: () => ipcRenderer.invoke(IPC.getHistory),
  clearHistory: () => ipcRenderer.invoke(IPC.clearHistory),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  chooseExecutable: (kind) => ipcRenderer.invoke(IPC.chooseExecutable, kind),
  onJobs: (cb) => subscribe(IPC.evJobs, cb),
  onMedia: (cb) => subscribe(IPC.evMedia, cb),
  onFfmpeg: (cb) => subscribe(IPC.evFfmpeg, cb),
};

contextBridge.exposeInMainWorld('videoConverter', api);
