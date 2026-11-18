import { describe, expect, it } from 'vitest';
import {
  buildArgs,
  buildVideoFilters,
  frameRateArg,
  normaliseTarget,
  orientBox,
  isPalRate,
} from '../../electron/services/args';
import { planConversion } from '../../electron/services/plan';
import { resolvePreset } from '../../electron/services/presets';
import { primaryVideo } from '../../electron/services/probe';
import { fakeCaps, fixtureProbe } from './helpers';
import type { ConversionSettings } from '../../shared/types';

const caps = fakeCaps();
const preset = (id: Parameters<typeof resolvePreset>[0], fmt: string) =>
  resolvePreset(id, fmt, caps).settings!;

function build(name: string, s: ConversionSettings, out = '/out/x.tmp') {
  const info = fixtureProbe(name);
  const v = planConversion(info, s, caps);
  return buildArgs({
    settings: s,
    plan: v.plan,
    info,
    outputPath: out,
    input: { kind: 'file', path: info.path },
  });
}

function argAfter(args: string[], flag: string) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe('frameRateArg', () => {
  it('maps NTSC rates to exact rationals and validates input', () => {
    expect(frameRateArg('29.97')).toBe('30000/1001');
    expect(frameRateArg('23.976')).toBe('24000/1001');
    expect(frameRateArg('59.94')).toBe('60000/1001');
    expect(frameRateArg('25')).toBe('25');
    expect(frameRateArg('30000/1001')).toBe('30000/1001');
    expect(frameRateArg('0')).toBeNull();
    expect(frameRateArg('abc')).toBeNull();
    expect(frameRateArg('1;rm')).toBeNull();
  });
});

describe('orientBox', () => {
  it('swaps the box for portrait sources', () => {
    expect(orientBox({ width: 1920, height: 1080 }, { w: 1080, h: 1920 })).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(orientBox({ width: 1920, height: 1080 }, { w: 3840, h: 2160 })).toEqual({
      width: 1920,
      height: 1080,
    });
  });
});

describe('buildArgs', () => {
  it('produces a safe, structured command for MTS -> MP4', () => {
    const args = build('avchd', preset('best-compatibility', 'mp4'));
    expect(args.slice(0, 3)).toEqual(['-hide_banner', '-nostdin', '-n']);
    expect(args).toContain('-progress');
    expect(argAfter(args, '-i')).toBe('/media/avchd');
    expect(args.filter((a) => a === '-map')).toHaveLength(2);
    expect(argAfter(args, '-c:v:0')).toBe('libx264');
    expect(argAfter(args, '-crf:v:0')).toBe('21');
    expect(argAfter(args, '-preset:v:0')).toBe('medium');
    expect(argAfter(args, '-pix_fmt:v:0')).toBe('yuv420p');
    expect(argAfter(args, '-c:a:0')).toBe('aac');
    expect(argAfter(args, '-b:a:0')).toBe('192k');
    expect(argAfter(args, '-movflags')).toBe('+faststart');
    // interlaced source -> deinterlace automatically
    expect(argAfter(args, '-filter:v:0')).toMatch(/^bwdif/);
    expect(args.slice(-3)).toEqual(['-f', 'mp4', '/out/x.tmp']);
  });

  it('never applies CRF to encoders that do not support it', () => {
    const s = preset('archive', 'mkv');
    const args = build('avchd', s);
    expect(args.some((a) => a.startsWith('-crf'))).toBe(false);
    expect(argAfter(args, '-c:v:0')).toBe('ffv1');
    expect(args.some((a) => a.startsWith('-b:a'))).toBe(false); // flac is lossless
  });

  it('uses the ProRes profile argument rather than CRF', () => {
    const args = build('avchd', preset('archive', 'mov'));
    expect(argAfter(args, '-profile:v:0')).toBe('3');
    expect(argAfter(args, '-pix_fmt:v:0')).toBe('yuv422p10le');
  });

  it('stream copy has no filters or encoder options', () => {
    const args = build('avchd', preset('stream-copy', 'mkv'));
    expect(argAfter(args, '-c:v:0')).toBe('copy');
    expect(argAfter(args, '-c:a:0')).toBe('copy');
    expect(args.some((a) => a.startsWith('-filter'))).toBe(false);
    expect(args.some((a) => a.startsWith('-crf'))).toBe(false);
  });

  it('maps multiple audio tracks and converts subtitles', () => {
    const args = build('multi', preset('best-compatibility', 'mp4'));
    expect(args.filter((a) => a === '-map')).toHaveLength(4);
    expect(argAfter(args, '-c:a:1')).toBe('aac');
    expect(argAfter(args, '-c:s:0')).toBe('mov_text');
  });

  it('handles scaling, frame rate, crop, stretch and rotation', () => {
    const s = preset('best-compatibility', 'mp4');
    s.video.resolution = { mode: 'fit', width: 1280, height: 720 };
    s.video.frameRate = { mode: 'fixed', fps: '29.97' };
    s.video.deinterlace = 'off';
    const v = primaryVideo(fixtureProbe('avchd'));
    expect(buildVideoFilters(s, v)).toEqual([
      'scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2',
      'fps=30000/1001',
    ]);
    s.video.stretch = true;
    s.video.crop = { width: 1000, height: 800, x: 10, y: 20 };
    s.video.rotation = 90;
    const f = buildVideoFilters(s, v);
    expect(f[0]).toBe('crop=1000:800:10:20');
    expect(f[1]).toBe('transpose=clock');
    // rotated 90 -> portrait -> box flips to 720x1280
    expect(f[2]).toBe('scale=720:1280');
  });

  it('auto-orients the fit box for portrait phone video', () => {
    const s = preset('best-compatibility', 'mp4');
    s.video.resolution = { mode: 'fit', width: 640, height: 360 };
    const f = buildVideoFilters(s, primaryVideo(fixtureProbe('phone')));
    expect(f.join(',')).toContain('scale=w=360:h=640');
  });

  it('adds hwupload for VAAPI and the device before the input', () => {
    const okCaps = fakeCaps({
      hwEncoderTests: [{ encoder: 'h264_vaapi', method: 'vaapi', ok: true, message: '' }],
    });
    const s = resolvePreset('best-compatibility', 'mp4', okCaps).settings!;
    s.video.encoder = 'h264_vaapi';
    s.video.quality = 24;
    const info = fixtureProbe('avchd');
    const plan = planConversion(info, s, okCaps).plan;
    const args = buildArgs({
      settings: s,
      plan,
      info,
      outputPath: '/o',
      vaapiDevice: '/dev/dri/renderD128',
      input: { kind: 'file', path: info.path },
    });
    expect(args.indexOf('-vaapi_device')).toBeLessThan(args.indexOf('-i'));
    expect(argAfter(args, '-filter:v:0')).toMatch(/format=nv12,hwupload$/);
    expect(argAfter(args, '-qp:v:0')).toBe('24');
    expect(args.some((a) => a.startsWith('-pix_fmt'))).toBe(false);
  });

  it('DV output is forced to PAL or NTSC', () => {
    expect(isPalRate({ mode: 'original' }, 25)).toBe(true);
    expect(isPalRate({ mode: 'original' }, 29.97)).toBe(false);
    expect(isPalRate({ mode: 'fixed', fps: '50' }, null)).toBe(true);
  });

  it('appends validated custom args before the output', () => {
    const s = preset('best-compatibility', 'mp4');
    s.customArgs = ['-tune', 'film'];
    const args = build('avchd', s);
    expect(args.slice(-5)).toEqual(['-tune', 'film', '-f', 'mp4', '/out/x.tmp']);
  });

  it('builds concat-demuxer and normalised concat commands', () => {
    const s = preset('best-compatibility', 'mp4');
    const info = fixtureProbe('avchd');
    const plan = planConversion(info, s, caps).plan;
    const demux = buildArgs({
      settings: s,
      plan,
      info,
      outputPath: '/o',
      input: { kind: 'concat-list', listPath: '/tmp/l.txt' },
    });
    expect(demux.join(' ')).toContain('-f concat -safe 0 -i /tmp/l.txt');

    const noAudio = fixtureProbe('phone');
    noAudio.streams = noAudio.streams.filter((x) => x.type === 'video');
    const norm = buildArgs({
      settings: s,
      plan,
      info,
      outputPath: '/o',
      input: { kind: 'normalise', clips: [info, noAudio] },
    });
    const fc = argAfter(norm, '-filter_complex')!;
    expect(fc).toContain('concat=n=2:v=1:a=1[vcat][aout]');
    expect(fc).toContain('pad=1920:1080');
    expect(fc).toContain('[2:a:0]aresample'); // generated silence for the clip without audio
    expect(norm.join(' ')).toMatch(/-f lavfi -t [\d.]+ -i anullsrc/);
    expect(norm).toContain('[vout]');
  });

  it('normalise target follows the first clip and output settings', () => {
    const s = preset('best-compatibility', 'mp4');
    expect(normaliseTarget(s, [fixtureProbe('avchd')])).toMatchObject({
      width: 1920,
      height: 1080,
      fps: '25/1',
      sampleRate: 48000,
    });
    s.video.resolution = { mode: 'fit', width: 1280, height: 720 };
    s.video.frameRate = { mode: 'fixed', fps: '30' };
    expect(normaliseTarget(s, [fixtureProbe('avchd')])).toMatchObject({
      width: 1280,
      height: 720,
      fps: '30',
    });
  });
});
