// Integration tests: real FFmpeg/FFprobe, real files, the real executor and
// queue. Each test is skipped (with the reason) when FFmpeg or the encoder
// it needs is not available, rather than passing falsely.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConversionSettings, Job, PresetId } from '../../shared/types';
import { FfmpegService } from '../../electron/services/ffmpegService';
import { createExecutor } from '../../electron/services/converter';
import { JobQueue } from '../../electron/services/queue';
import { TempTracker } from '../../electron/services/tempTracker';
import { resolvePreset } from '../../electron/services/presets';
import { probeFile } from '../../electron/services/probe';
import { hasEncoder } from '../../electron/services/catalog';
import { writeConcatList } from '../../electron/services/concat';
import { buildMpls } from '../../electron/services/avchd/mpls';
import { findAvchdRoots, scanBdmv } from '../../electron/services/avchd/scan';

const svc = new FfmpegService();
let ready = false;
let work: string;
let queue: JobQueue;

function has(...encoders: string[]) {
  return ready && encoders.every((e) => hasEncoder(svc.caps, e));
}

function ff(args: string[]) {
  execFileSync(svc.ffmpegPath!, ['-v', 'error', '-y', ...args]);
}

/** Make a short source clip with test video and a tone. */
function source(
  name: string,
  codecArgs: string[],
  opts: { seconds?: number; size?: string; audio?: boolean; extraInputs?: string[] } = {},
) {
  const file = path.join(work, 'src', name);
  const inputs = ['-f', 'lavfi', '-i', `testsrc2=size=${opts.size ?? '320x240'}:rate=25`];
  if (opts.audio !== false)
    inputs.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000');
  ff([...inputs, ...(opts.extraInputs ?? []), '-t', String(opts.seconds ?? 2), ...codecArgs, file]);
  return file;
}

let n = 0;
function makeJob(
  sources: string[],
  settings: ConversionSettings,
  mode: Job['mode'] = 'single',
  concatStrategy: Job['concatStrategy'] = null,
): Job {
  const out = path.join(work, 'out', `out-${++n}.${settings.extension}`);
  return {
    id: `${(n * 2654435761).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`.slice(
      0,
      36,
    ),
    mode,
    sources,
    sourceNames: sources.map((s) => path.basename(s)),
    outputPath: out,
    settings,
    concatStrategy,
    status: 'waiting',
    progress: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    error: null,
    warnings: [],
    attempts: 0,
    hwEncoderUsed: false,
    overwrite: false,
  };
}

function run(job: Job): Promise<Job> {
  return new Promise((resolve) => {
    const onFinish = (j: Job) => {
      if (j.id !== job.id) return;
      queue.off('finished', onFinish);
      resolve(j);
    };
    queue.on('finished', onFinish);
    queue.add(job);
  });
}

function preset(id: PresetId, format: string) {
  const r = resolvePreset(id, format, svc.caps);
  if (!r.settings) throw new Error(r.error ?? 'no settings');
  return r.settings;
}

async function expectOutput(job: Job, codecs: string[]) {
  expect(job.error, job.error?.details ?? '').toBeNull();
  expect(job.status).toBe('completed');
  const info = await probeFile(svc.ffprobePath!, job.outputPath);
  expect(info.streams.map((s) => s.codec)).toEqual(codecs);
  expect(info.duration ?? 0).toBeGreaterThan(1.5);
  // no partial files left next to the output
  expect(
    fs.readdirSync(path.dirname(job.outputPath)).filter((f) => f.includes('.partial-')),
  ).toEqual([]);
  return info;
}

beforeAll(async () => {
  const st = await svc.refresh({ ffmpegPath: null, ffprobePath: null }, false);
  ready = st.ok;
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-int-'));
  fs.mkdirSync(path.join(work, 'src'));
  fs.mkdirSync(path.join(work, 'out'));
  const tracker = new TempTracker(path.join(work, 'partials.json'));
  queue = new JobQueue(
    createExecutor({
      ffmpegPath: () => svc.ffmpegPath,
      ffprobePath: () => svc.ffprobePath,
      caps: () => svc.caps,
      vaapiDevice: () => null,
      tempDir: path.join(work, 'tmp'),
      tempTracker: tracker,
      reservedOutputs: () => queue.reservedOutputs(),
      log: () => {},
      minFreeBytes: 1,
    }),
    2,
  );
});

afterAll(() => {
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

describe('integration', () => {
  const x264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];

  it('FFmpeg is available (other tests skip if not)', (ctx) => {
    if (!ready) ctx.skip();
    expect(svc.caps?.encoders.length).toBeGreaterThan(10);
  });

  it('MP4 -> MKV (stream copy)', async (ctx) => {
    if (!has('libx264', 'aac')) return ctx.skip();
    const src = source('a.mp4', [...x264, '-c:a', 'aac']);
    const job = await run(makeJob([src], preset('stream-copy', 'mkv')));
    await expectOutput(job, ['h264', 'aac']);
  });

  it('MKV -> MP4 (H.264 re-encode, Best Compatibility)', async (ctx) => {
    if (!has('libx264', 'aac', 'libopus')) return ctx.skip();
    const src = source('b.mkv', [...x264, '-c:a', 'libopus']);
    const job = await run(makeJob([src], preset('best-compatibility', 'mp4')));
    const info = await expectOutput(job, ['h264', 'aac']);
    expect(info.streams[0].pixFmt).toBe('yuv420p');
    expect(job.progress?.percent).toBe(100);
  });

  it('MOV -> MP4', async (ctx) => {
    if (!has('libx264', 'aac', 'pcm_s16le')) return ctx.skip();
    const src = source('c.mov', [...x264, '-c:a', 'pcm_s16le']);
    await expectOutput(await run(makeJob([src], preset('best-compatibility', 'mp4'))), [
      'h264',
      'aac',
    ]);
  });

  it('AVI -> MP4', async (ctx) => {
    if (!has('libx264', 'aac', 'mpeg4', 'libmp3lame')) return ctx.skip();
    const src = source('d.avi', ['-c:v', 'mpeg4', '-c:a', 'libmp3lame']);
    await expectOutput(await run(makeJob([src], preset('best-compatibility', 'mp4'))), [
      'h264',
      'aac',
    ]);
  });

  it('WebM -> MP4', async (ctx) => {
    if (!has('libx264', 'aac', 'libvpx-vp9', 'libopus')) return ctx.skip();
    const src = source('e.webm', [
      '-c:v',
      'libvpx-vp9',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-c:a',
      'libopus',
    ]);
    await expectOutput(await run(makeJob([src], preset('best-compatibility', 'mp4'))), [
      'h264',
      'aac',
    ]);
  });

  it('MTS (interlaced, AC-3) -> MP4 with deinterlacing', async (ctx) => {
    if (!has('libx264', 'aac', 'ac3')) return ctx.skip();
    const src = source(
      '00001.MTS',
      [
        '-vf',
        'interlace=scan=tff',
        '-flags',
        '+ildct+ilme',
        ...x264,
        '-x264-params',
        'tff=1',
        '-c:a',
        'ac3',
        '-f',
        'mpegts',
      ],
      { size: '640x480' },
    );
    const input = await probeFile(svc.ffprobePath!, src);
    expect(input.streams[0].interlaced).toBe(true);
    const job = await run(makeJob([src], preset('best-compatibility', 'mp4')));
    const info = await expectOutput(job, ['h264', 'aac']);
    expect(info.streams[0].interlaced).toBe(false);
  });

  it('M2TS -> MP4', async (ctx) => {
    if (!has('libx264', 'aac', 'ac3')) return ctx.skip();
    const src = source('00002.m2ts', [
      ...x264,
      '-c:a',
      'ac3',
      '-f',
      'mpegts',
      '-mpegts_m2ts_mode',
      '1',
    ]);
    await expectOutput(await run(makeJob([src], preset('best-compatibility', 'mp4'))), [
      'h264',
      'aac',
    ]);
  });

  it('MTS -> MP4 by stream copy (H.264 + AC-3)', async (ctx) => {
    if (!has('libx264', 'ac3')) return ctx.skip();
    const src = source('00003.MTS', [...x264, '-c:a', 'ac3', '-f', 'mpegts']);
    await expectOutput(await run(makeJob([src], preset('stream-copy', 'mp4'))), ['h264', 'ac3']);
  });

  it('audio extraction to MP3, FLAC, M4A and WAV', async (ctx) => {
    if (!has('libx264', 'aac', 'libmp3lame', 'flac')) return ctx.skip();
    const src = source('f.mp4', [...x264, '-c:a', 'aac']);
    for (const [fmt, codec] of [
      ['mp3', 'mp3'],
      ['flac', 'flac'],
      ['m4a', 'aac'],
      ['wav', 'pcm_s16le'],
    ]) {
      const job = await run(makeJob([src], preset('audio-only', fmt)));
      await expectOutput(job, [codec]);
    }
  });

  it('H.265 re-encode (Smaller File)', async (ctx) => {
    if (!has('libx265', 'libx264', 'aac')) return ctx.skip();
    const src = source('g.mp4', [...x264, '-c:a', 'aac']);
    const s = preset('smaller-file', 'mp4');
    s.video.speedPreset = 'ultrafast';
    await expectOutput(await run(makeJob([src], s)), ['hevc', 'aac']);
  });

  it('WebM output (VP9/AV1 + Opus)', async (ctx) => {
    if (!has('libx264', 'libopus', 'aac') || !(has('libsvtav1') || has('libvpx-vp9')))
      return ctx.skip();
    const src = source('h.mp4', [...x264, '-c:a', 'aac']);
    const s = preset('web-optimised', 'webm');
    s.video.speedPreset = s.video.encoder === 'libvpx-vp9' ? '5' : s.video.speedPreset;
    const job = await run(makeJob([src], s));
    await expectOutput(job, [s.video.encoder === 'libvpx-vp9' ? 'vp9' : 'av1', 'opus']);
  });

  it('archive presets (FFV1+FLAC in MKV, ProRes+PCM in MOV)', async (ctx) => {
    if (!has('ffv1', 'flac', 'prores_ks', 'pcm_s24le', 'libx264', 'aac')) return ctx.skip();
    const src = source('i.mp4', [...x264, '-c:a', 'aac'], { seconds: 2 });
    await expectOutput(await run(makeJob([src], preset('archive', 'mkv'))), ['ffv1', 'flac']);
    await expectOutput(await run(makeJob([src], preset('archive', 'mov'))), [
      'prores',
      'pcm_s24le',
    ]);
  });

  it('source without audio converts fine', async (ctx) => {
    if (!has('libx264', 'aac')) return ctx.skip();
    const src = source('j.mp4', x264, { audio: false });
    await expectOutput(await run(makeJob([src], preset('best-compatibility', 'mp4'))), ['h264']);
  });

  it('removing audio on request', async (ctx) => {
    if (!has('libx264', 'aac')) return ctx.skip();
    const src = source('k.mp4', [...x264, '-c:a', 'aac']);
    const s = preset('best-compatibility', 'mp4');
    s.audio.mode = 'none';
    await expectOutput(await run(makeJob([src], s)), ['h264']);
  });

  it('keeps multiple audio tracks and subtitles in MKV; converts subtitles for MP4', async (ctx) => {
    if (!has('libx264', 'aac', 'libopus', 'srt', 'mov_text')) return ctx.skip();
    const srt = path.join(work, 'src', 's.srt');
    fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
    const src = path.join(work, 'src', 'multi.mkv');
    ff([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=f=440',
      '-f',
      'lavfi',
      '-i',
      'sine=f=880',
      '-i',
      srt,
      '-t',
      '2',
      '-map',
      '0',
      '-map',
      '1',
      '-map',
      '2',
      '-map',
      '3',
      ...x264,
      '-c:a:0',
      'aac',
      '-c:a:1',
      'libopus',
      '-c:s',
      'srt',
      src,
    ]);
    await expectOutput(await run(makeJob([src], preset('stream-copy', 'mkv'))), [
      'h264',
      'aac',
      'opus',
      'subrip',
    ]);
    await expectOutput(await run(makeJob([src], preset('best-compatibility', 'mp4'))), [
      'h264',
      'aac',
      'aac',
      'mov_text',
    ]);
    const s = preset('best-compatibility', 'mkv');
    s.streams.audio = [2];
    s.subtitles = 'remove';
    await expectOutput(await run(makeJob([src], s)), ['h264', 'aac']);
  });

  it('scales to a fit box keeping aspect ratio and changes frame rate', async (ctx) => {
    if (!has('libx264', 'aac')) return ctx.skip();
    const src = source('l.mp4', [...x264, '-c:a', 'aac'], { size: '640x360' });
    const s = preset('best-compatibility', 'mp4');
    s.video.resolution = { mode: 'fit', width: 320, height: 240 };
    s.video.frameRate = { mode: 'fixed', fps: '29.97' };
    const info = await expectOutput(await run(makeJob([src], s)), ['h264', 'aac']);
    expect([info.streams[0].width, info.streams[0].height]).toEqual([320, 180]);
    expect(info.streams[0].frameRate).toBeCloseTo(29.97, 1);
  });

  it('combines compatible AVCHD clips with the concat demuxer (lossless)', async (ctx) => {
    if (!has('libx264', 'ac3')) return ctx.skip();
    const card = path.join(work, 'card');
    const bdmv = path.join(card, 'PRIVATE', 'AVCHD', 'BDMV');
    fs.mkdirSync(path.join(bdmv, 'STREAM'), { recursive: true });
    fs.mkdirSync(path.join(bdmv, 'PLAYLIST'), { recursive: true });
    for (const c of ['00000', '00001']) {
      ff([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x240:rate=25',
        '-f',
        'lavfi',
        '-i',
        'sine',
        '-t',
        '2',
        ...x264,
        '-c:a',
        'ac3',
        '-f',
        'mpegts',
        path.join(bdmv, 'STREAM', `${c}.MTS`),
      ]);
    }
    fs.writeFileSync(
      path.join(bdmv, 'PLAYLIST', '00000.MPL'),
      buildMpls([{ clip: '00001' }, { clip: '00000', cc: 6 }]),
    );
    const [root] = await findAvchdRoots(card);
    const scan = await scanBdmv(root);
    expect(scan.clips.map((c) => c.name)).toEqual(['00001', '00000']);
    const job = await run(
      makeJob(
        scan.clips.map((c) => c.path),
        preset('stream-copy', 'mkv'),
        'concat',
        'demuxer',
      ),
    );
    const info = await expectOutput(job, ['h264', 'ac3']);
    expect(info.duration).toBeGreaterThan(3.8);
  });

  it('combines incompatible clips by normalising them', async (ctx) => {
    if (!has('libx264', 'aac', 'ac3')) return ctx.skip();
    const a = source('n1.MTS', [...x264, '-c:a', 'ac3', '-f', 'mpegts'], { size: '640x360' });
    const b = source('n2.MTS', [...x264, '-r', '30', '-f', 'mpegts'], {
      size: '320x240',
      audio: false,
    });
    const job = await run(
      makeJob([a, b], preset('best-compatibility', 'mp4'), 'concat', 'normalise'),
    );
    const info = await expectOutput(job, ['h264', 'aac']);
    expect([info.streams[0].width, info.streams[0].height]).toEqual([640, 360]);
    expect(info.duration).toBeGreaterThan(3.8);
  });

  it('refuses a demuxer concat of incompatible clips', async (ctx) => {
    if (!has('libx264', 'ac3')) return ctx.skip();
    const a = source('p1.MTS', [...x264, '-c:a', 'ac3', '-f', 'mpegts'], { size: '640x360' });
    const b = source('p2.MTS', [...x264, '-c:a', 'ac3', '-f', 'mpegts'], { size: '320x240' });
    const job = await run(makeJob([a, b], preset('stream-copy', 'mkv'), 'concat', 'demuxer'));
    expect(job.status).toBe('failed');
    expect(job.error?.message).toMatch(/cannot be joined directly/);
  });

  it('cancellation stops FFmpeg and removes the partial output', async (ctx) => {
    if (!has('libx264', 'aac')) return ctx.skip();
    const src = source('long.mp4', [...x264, '-c:a', 'aac'], { seconds: 60, size: '1280x720' });
    const s = preset('high-quality', 'mkv');
    s.video.speedPreset = 'veryslow';
    const job = makeJob([src], s);
    const done = run(job);
    await new Promise<void>((resolve) => {
      const check = () =>
        job.status === 'converting' && job.progress ? resolve() : setTimeout(check, 50);
      check();
    });
    queue.cancel(job.id);
    const finished = await done;
    expect(finished.status).toBe('cancelled');
    expect(fs.existsSync(job.outputPath)).toBe(false);
    expect(
      fs.readdirSync(path.dirname(job.outputPath)).filter((f) => f.includes('.partial-')),
    ).toEqual([]);
  });

  it('reports damaged input clearly', async (ctx) => {
    if (!ready) return ctx.skip();
    const bad = path.join(work, 'src', 'bad.mts');
    fs.writeFileSync(bad, Buffer.alloc(10000, 0x47));
    const job = await run(makeJob([bad], preset('best-compatibility', 'mp4')));
    expect(job.status).toBe('failed');
    expect(job.error?.kind).toBe('unsupported-input');
  });

  it('reports a missing source clearly', async (ctx) => {
    if (!ready) return ctx.skip();
    const job = await run(
      makeJob([path.join(work, 'src', 'nope.mp4')], preset('best-compatibility', 'mp4')),
    );
    expect(job.status).toBe('failed');
    expect(job.error?.kind).toBe('unreadable-source');
  });

  it('reports an impossible stream copy before running FFmpeg', async (ctx) => {
    if (!has('libx264', 'aac')) return ctx.skip();
    const src = source('q.mp4', [...x264, '-c:a', 'aac']);
    const job = await run(makeJob([src], preset('stream-copy', 'webm')));
    expect(job.status).toBe('failed');
    expect(job.error?.kind).toBe('unsupported-combination');
    expect(job.error?.message).toMatch(/Cannot copy video/);
  });

  it('never overwrites an existing file that appears during conversion', async (ctx) => {
    if (!has('libx264', 'aac')) return ctx.skip();
    const src = source('r.mp4', [...x264, '-c:a', 'aac']);
    const job = makeJob([src], preset('best-compatibility', 'mkv'));
    const original = job.outputPath;
    fs.writeFileSync(original, 'existing');
    const done = await run(job);
    expect(done.status).toBe('completed');
    expect(fs.readFileSync(original, 'utf8')).toBe('existing');
    expect(done.outputPath).not.toBe(original);
    expect(done.warnings.join(' ')).toMatch(/appeared at the original destination/);
  });

  it('writes concat lists with awkward filenames', async () => {
    const list = path.join(work, "list's.txt");
    await writeConcatList(list, ["/a/it's.mts", '/b/ünï code.mts']);
    expect(fs.readFileSync(list, 'utf8')).toContain("file '/a/it'\\''s.mts'");
  });
});
