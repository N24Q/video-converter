import fs from 'node:fs/promises';
import type { FfmpegCapabilities, FfmpegStatus, HwEncoderTest } from '../../shared/types';
import { runCapture } from './exec';
import { getVersion, resolveExecutable } from './locator';
import {
  parseCodecList,
  parseDemuxers,
  parseHwaccels,
  parseMuxerHelp,
  parseMuxers,
} from './capabilities';

/** Hardware encoders the app knows how to drive, and how. */
export const HW_ENCODERS: { encoder: string; method: 'vaapi' | 'nvenc' }[] = [
  { encoder: 'h264_vaapi', method: 'vaapi' },
  { encoder: 'hevc_vaapi', method: 'vaapi' },
  { encoder: 'av1_vaapi', method: 'vaapi' },
  { encoder: 'vp9_vaapi', method: 'vaapi' },
  { encoder: 'h264_nvenc', method: 'nvenc' },
  { encoder: 'hevc_nvenc', method: 'nvenc' },
  { encoder: 'av1_nvenc', method: 'nvenc' },
];

export async function listVaapiDevices(): Promise<string[]> {
  try {
    const entries = await fs.readdir('/dev/dri');
    return entries
      .filter((e) => /^renderD\d+$/.test(e))
      .sort()
      .map((e) => `/dev/dri/${e}`);
  } catch {
    return [];
  }
}

/**
 * Discovers FFmpeg/FFprobe, their capabilities, and which hardware encoders
 * actually work on this machine. Results are cached until refresh().
 */
export class FfmpegService {
  private status: FfmpegStatus = {
    ok: false,
    ffmpegPath: null,
    ffprobePath: null,
    error: 'Not yet checked',
    capabilities: null,
  };
  private muxerInfoCache = new Map<string, { extensions: string[] }>();

  getStatus(): FfmpegStatus {
    return this.status;
  }

  get ffmpegPath(): string | null {
    return this.status.ok ? this.status.ffmpegPath : null;
  }

  get ffprobePath(): string | null {
    return this.status.ffprobePath;
  }

  get caps(): FfmpegCapabilities | null {
    return this.status.capabilities;
  }

  async refresh(
    config: { ffmpegPath: string | null; ffprobePath: string | null },
    testHardware = true,
  ) {
    this.muxerInfoCache.clear();
    const ff = await resolveExecutable('ffmpeg', config.ffmpegPath);
    const fp = await resolveExecutable('ffprobe', config.ffprobePath);
    const errors: string[] = [];
    if (!ff.path) errors.push(ff.error ?? 'ffmpeg not found');
    if (!fp.path) errors.push(fp.error ?? 'ffprobe not found');

    if (!ff.path || !fp.path) {
      this.status = {
        ok: false,
        ffmpegPath: ff.path,
        ffprobePath: fp.path,
        error: errors.join(' '),
        capabilities: null,
      };
      return this.status;
    }

    try {
      const [ffv, fpv] = await Promise.all([getVersion(ff.path), getVersion(fp.path)]);
      const run = async (flag: string) => {
        const r = await runCapture(ff.path!, ['-hide_banner', flag], { timeoutMs: 15_000 });
        if (r.spawnError || r.code !== 0) {
          throw new Error(`ffmpeg ${flag} failed: ${r.spawnError ?? r.stderr.slice(0, 500)}`);
        }
        return r.stdout;
      };
      const [enc, dec, mux, demux, hw] = await Promise.all([
        run('-encoders'),
        run('-decoders'),
        run('-muxers'),
        run('-demuxers'),
        run('-hwaccels'),
      ]);
      const encoders = parseCodecList(enc);
      const caps: FfmpegCapabilities = {
        ffmpeg: { path: ff.path, version: ffv.version },
        ffprobe: { path: fp.path, version: fpv.version },
        buildConfiguration: ffv.configuration,
        encoders,
        decoders: parseCodecList(dec),
        muxers: parseMuxers(mux),
        demuxers: parseDemuxers(demux),
        hwaccels: parseHwaccels(hw),
        hwEncoderTests: [],
        discoveredAt: new Date().toISOString(),
      };
      if (testHardware) {
        caps.hwEncoderTests = await this.testHardwareEncoders(ff.path, caps);
      }
      this.status = {
        ok: true,
        ffmpegPath: ff.path,
        ffprobePath: fp.path,
        error: null,
        capabilities: caps,
      };
    } catch (err) {
      this.status = {
        ok: false,
        ffmpegPath: ff.path,
        ffprobePath: fp.path,
        error: (err as Error).message,
        capabilities: null,
      };
    }
    return this.status;
  }

  /**
   * Hardware encoders listed by `ffmpeg -encoders` are only compiled in; they
   * may not work on this machine (e.g. inside Crostini). Run a tiny encode to
   * find out, so the UI only offers ones that actually work.
   */
  private async testHardwareEncoders(
    ffmpeg: string,
    caps: FfmpegCapabilities,
  ): Promise<HwEncoderTest[]> {
    const present = HW_ENCODERS.filter((h) => caps.encoders.some((e) => e.name === h.encoder));
    const devices = await listVaapiDevices();
    const results: HwEncoderTest[] = [];
    for (const h of present) {
      if (h.method === 'vaapi' && devices.length === 0) {
        results.push({ ...h, ok: false, message: 'No /dev/dri render device available' });
        continue;
      }
      const args = ['-hide_banner', '-nostdin', '-v', 'error'];
      if (h.method === 'vaapi') args.push('-vaapi_device', devices[0]);
      args.push('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10', '-frames:v', '5');
      if (h.method === 'vaapi') args.push('-vf', 'format=nv12,hwupload');
      args.push('-c:v', h.encoder, '-f', 'null', '-');
      const r = await runCapture(ffmpeg, args, { timeoutMs: 10_000, maxBytes: 8192 });
      const ok = r.code === 0 && !r.timedOut;
      const msg = ok
        ? 'Test encode succeeded'
        : r.timedOut
          ? 'Test encode timed out'
          : (r.stderr.trim().split('\n').slice(-2).join(' ') || `exit code ${r.code}`).slice(
              0,
              300,
            );
      results.push({ encoder: h.encoder, method: h.method, ok, message: msg });
    }
    return results;
  }

  /** Common file extensions for a muxer, from `ffmpeg -h muxer=NAME`. */
  async getMuxerExtensions(muxer: string): Promise<string[]> {
    if (!/^[a-z0-9_]+$/i.test(muxer)) return [];
    const cached = this.muxerInfoCache.get(muxer);
    if (cached) return cached.extensions;
    const ff = this.ffmpegPath;
    if (!ff) return [];
    const r = await runCapture(ff, ['-hide_banner', '-h', `muxer=${muxer}`], { timeoutMs: 5000 });
    const info = parseMuxerHelp(r.stdout);
    this.muxerInfoCache.set(muxer, { extensions: info.extensions });
    return info.extensions;
  }

  workingHwEncoders(): string[] {
    return (this.caps?.hwEncoderTests ?? []).filter((t) => t.ok).map((t) => t.encoder);
  }
}
