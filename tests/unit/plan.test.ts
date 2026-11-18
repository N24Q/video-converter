import { describe, expect, it } from 'vitest';
import { planConversion } from '../../electron/services/plan';
import {
  resolvePreset,
  listPresets,
  baseSettings,
  softwareEquivalent,
} from '../../electron/services/presets';
import { getFormats } from '../../electron/services/catalog';
import { fakeCaps, fixtureProbe } from './helpers';

const caps = fakeCaps();

function preset(id: Parameters<typeof resolvePreset>[0], format: string) {
  const r = resolvePreset(id, format, caps);
  if (!r.settings) throw new Error(r.error ?? 'no settings');
  return r.settings;
}

describe('presets', () => {
  it('best compatibility = MP4 + x264 CRF 21 + AAC + faststart', () => {
    const s = preset('best-compatibility', 'mp4');
    expect(s).toMatchObject({ muxer: 'mp4', extension: 'mp4', fastStart: true });
    expect(s.video).toMatchObject({
      mode: 'encode',
      encoder: 'libx264',
      quality: 21,
      speedPreset: 'medium',
    });
    expect(s.audio).toMatchObject({ encoder: 'aac', bitrateKbps: 192 });
    expect(s.video.resolution).toEqual({ mode: 'original' });
  });

  it('smaller file prefers HEVC, and AV1 for WebM', () => {
    expect(preset('smaller-file', 'mp4').video.encoder).toBe('libx265');
    expect(preset('smaller-file', 'webm').video.encoder).toBe('libsvtav1');
    expect(preset('smaller-file', 'webm').audio.encoder).toBe('libopus');
  });

  it('archive uses lossless codecs', () => {
    expect(preset('archive', 'mkv').video.encoder).toBe('ffv1');
    expect(preset('archive', 'mkv').audio.encoder).toBe('flac');
    expect(preset('archive', 'mov').video.encoder).toBe('prores_ks');
  });

  it('audio only disables video', () => {
    const s = preset('audio-only', 'mp3');
    expect(s.video.mode).toBe('none');
    expect(s.audio.encoder).toBe('libmp3lame');
  });

  it('rejects formats a preset cannot produce', () => {
    expect(resolvePreset('web-optimised', 'avi', caps).error).toMatch(/cannot produce/);
    expect(resolvePreset('best-compatibility', 'mp4', null).error).toMatch(/FFmpeg/);
  });

  it('marks presets unavailable when encoders are missing', () => {
    const noX264 = fakeCaps();
    noX264.encoders = noX264.encoders.filter(
      (e) => !['libx264', 'libx265', 'mpeg4', 'libsvtav1'].includes(e.name),
    );
    const bc = listPresets(noX264).find((p) => p.id === 'best-compatibility')!;
    // MKV still possible via other encoders listed for MKV
    expect(bc.formats).not.toContain('mp4');
    expect(listPresets(null).every((p) => !p.available)).toBe(true);
  });

  it('does not use an untested hardware encoder even when preferred', () => {
    const r = resolvePreset('best-compatibility', 'mp4', caps, {
      defaultResolution: { mode: 'original' },
      defaultFrameRate: { mode: 'original' },
      preserveMetadata: true,
      hwaccelPreference: 'vaapi',
    });
    expect(r.settings?.video.encoder).toBe('libx264');
    const ok = fakeCaps({
      hwEncoderTests: [{ encoder: 'h264_vaapi', method: 'vaapi', ok: true, message: '' }],
    });
    const r2 = resolvePreset('best-compatibility', 'mp4', ok, {
      defaultResolution: { mode: 'original' },
      defaultFrameRate: { mode: 'original' },
      preserveMetadata: true,
      hwaccelPreference: 'vaapi',
    });
    expect(r2.settings?.video.encoder).toBe('h264_vaapi');
    expect(softwareEquivalent(ok, 'h264_vaapi')).toBe('libx264');
  });
});

describe('formats', () => {
  it('only marks formats available when muxer and encoders exist', () => {
    const f = getFormats(caps);
    expect(f.find((x) => x.id === 'mp4')?.available).toBe(true);
    expect(f.find((x) => x.id === 'wmv')?.available).toBe(false); // no asf muxer / wmv2 in fake caps
    expect(f.find((x) => x.id === 'wmv')?.notes).toMatch(/asf/);
    expect(getFormats(null).every((x) => !x.available)).toBe(true);
  });
});

describe('planConversion', () => {
  it('encodes video and audio from MTS to MP4', () => {
    const r = planConversion(fixtureProbe('avchd'), preset('best-compatibility', 'mp4'), caps);
    expect(r.errors).toEqual([]);
    expect(r.plan.map((p) => [p.type, p.action, p.targetCodec])).toEqual([
      ['video', 'encode', 'libx264'],
      ['audio', 'encode', 'aac'],
    ]);
  });

  it('allows stream-copying AVCHD H.264 + AC-3 into MP4 and MKV', () => {
    for (const fmt of ['mp4', 'mkv']) {
      const r = planConversion(fixtureProbe('avchd'), preset('stream-copy', fmt), caps);
      expect(r.ok, fmt).toBe(true);
      expect(r.plan.every((p) => p.action === 'copy')).toBe(true);
    }
  });

  it('explains when stream copy is impossible', () => {
    const r = planConversion(fixtureProbe('avchd'), preset('stream-copy', 'webm'), caps);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Cannot copy video stream #0 \(h264\) into WebM/);
  });

  it('converts text subtitles for MP4 and keeps them for MKV', () => {
    const mp4 = planConversion(fixtureProbe('multi'), preset('best-compatibility', 'mp4'), caps);
    expect(mp4.plan.find((p) => p.type === 'subtitle')).toMatchObject({
      action: 'convert',
      targetCodec: 'mov_text',
    });
    const mkv = planConversion(fixtureProbe('multi'), preset('stream-copy', 'mkv'), caps);
    expect(mkv.plan.find((p) => p.type === 'subtitle')).toMatchObject({ action: 'copy' });
  });

  it('keeps every audio track by default and respects stream selection', () => {
    const s = preset('best-compatibility', 'mkv');
    expect(
      planConversion(fixtureProbe('multi'), s, caps).plan.filter(
        (p) => p.type === 'audio' && p.action !== 'drop',
      ),
    ).toHaveLength(2);
    s.streams.audio = [2];
    const r = planConversion(fixtureProbe('multi'), s, caps);
    expect(r.plan.filter((p) => p.type === 'audio').map((p) => p.action)).toEqual([
      'drop',
      'encode',
    ]);
  });

  it('warns rather than silently dropping streams the container cannot hold', () => {
    const r = planConversion(fixtureProbe('multi'), preset('audio-only', 'mp3'), caps);
    expect(r.ok).toBe(true);
    expect(r.plan.filter((p) => p.type === 'audio' && p.action === 'encode')).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/holds only 1 audio stream/);
  });

  it('removes subtitles when asked, with a reason', () => {
    const s = preset('best-compatibility', 'mp4');
    s.subtitles = 'remove';
    const p = planConversion(fixtureProbe('multi'), s, caps).plan.find(
      (x) => x.type === 'subtitle',
    );
    expect(p).toMatchObject({ action: 'drop', reason: expect.stringMatching(/removed/) });
  });

  it('errors for missing or incompatible encoders', () => {
    const s = preset('best-compatibility', 'mp4');
    s.video.encoder = 'libvpx';
    expect(planConversion(fixtureProbe('avchd'), s, caps).errors.join(' ')).toMatch(
      /cannot contain vp8/,
    );
    s.video.encoder = 'h264_vaapi';
    expect(planConversion(fixtureProbe('avchd'), s, caps).errors.join(' ')).toMatch(
      /Hardware encoder/,
    );
    s.video.encoder = 'nonexistent';
    expect(planConversion(fixtureProbe('avchd'), s, caps).errors.join(' ')).toMatch(
      /not available/,
    );
  });

  it('errors when nothing would be written or no audio to extract', () => {
    const s = baseSettings('mp4');
    s.video.mode = 'none';
    s.audio.mode = 'none';
    expect(planConversion(fixtureProbe('avchd'), s, caps).errors.join(' ')).toMatch(/no streams/);
    const video = fixtureProbe('avchd');
    video.streams = video.streams.filter((x) => x.type === 'video');
    expect(planConversion(video, preset('audio-only', 'mp3'), caps).errors.join(' ')).toMatch(
      /no audio/,
    );
  });

  it('notes downmixing for encoder channel limits', () => {
    const info = fixtureProbe('avchd');
    info.streams[1].channels = 6;
    const r = planConversion(info, preset('audio-only', 'mp3'), caps);
    expect(r.plan.find((p) => p.type === 'audio')?.reason).toMatch(/Downmixed/);
  });

  it('rejects invalid custom args', () => {
    const s = preset('best-compatibility', 'mp4');
    s.customArgs = ['-i', '/etc/passwd'];
    expect(planConversion(fixtureProbe('avchd'), s, caps).ok).toBe(false);
  });
});
