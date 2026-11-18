import type { VideoConverterApi } from '../shared/ipc';

declare global {
  interface Window {
    videoConverter: VideoConverterApi;
  }
}

export const api: VideoConverterApi = window.videoConverter;

/** Strip Electron's "Error invoking remote method 'x': Error: " prefix. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
