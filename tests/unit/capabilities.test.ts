import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  findEncoder,
  hasFormat,
  parseCodecList,
  parseDemuxers,
  parseFormatList,
  parseHwaccels,
  parseMuxerHelp,
  parseMuxers,
} from '../../electron/services/capabilities';
import { parseVersion } from '../../electron/services/locator';

const fx = (name: string) =>
  fs.readFileSync(path.join(__dirname, '../fixtures/ffmpeg-output', name), 'utf8');

describe('parseCodecList', () => {
  const encoders = parseCodecList(fx('encoders.txt'));

  it('skips the legend and parses every entry', () => {
    expect(encoders.map((e) => e.name)).toEqual([
      'ffv1',
      'libx264',
      'h264_vaapi',
      'libx265',
      'prores_ks',
      'libvpx-vp9',
      'aac',
      'libmp3lame',
      'libopus',
      'mov_text',
      'subrip',
    ]);
  });

  it('extracts the implemented codec and type', () => {
    expect(findEncoder(encoders, 'libx264')).toMatchObject({ type: 'video', codec: 'h264' });
    expect(findEncoder(encoders, 'libmp3lame')).toMatchObject({ type: 'audio', codec: 'mp3' });
    expect(findEncoder(encoders, 'subrip')).toMatchObject({ type: 'subtitle', codec: 'subrip' });
    // no "(codec x)" suffix means the encoder name is the codec name
    expect(findEncoder(encoders, 'ffv1')?.codec).toBe('ffv1');
    expect(findEncoder(encoders, 'libx264')?.description).not.toContain('(codec');
  });

  it('flags experimental encoders', () => {
    const list = parseCodecList(' ------\n V..X.. foo   Foo experimental (codec bar)\n');
    expect(list[0]).toMatchObject({ name: 'foo', codec: 'bar', experimental: true });
  });

  it('returns nothing for garbage', () => {
    expect(parseCodecList('')).toEqual([]);
    expect(parseCodecList('not ffmpeg output\nat all')).toEqual([]);
  });
});

describe('format lists', () => {
  it('parses muxers and ignores devices flag column', () => {
    const muxers = parseMuxers(fx('muxers.txt'));
    expect(muxers.map((m) => m.name)).toContain('mp4');
    expect(muxers.map((m) => m.name)).toContain('alsa');
    expect(hasFormat(muxers, 'matroska')).toBe(true);
    expect(hasFormat(muxers, 'avi')).toBe(false);
  });

  it('parses demuxers with comma-separated names', () => {
    const demuxers = parseDemuxers(fx('demuxers.txt'));
    expect(hasFormat(demuxers, 'mp4')).toBe(true);
    expect(hasFormat(demuxers, 'webm')).toBe(true);
    expect(hasFormat(demuxers, 'mpegts')).toBe(true);
  });

  it('handles the combined -formats listing (old two-column style too)', () => {
    const list = parseFormatList(
      ' --\n DE matroska,webm   Matroska / WebM\n  E mp4   MP4\n D  mpegts  MPEG-TS\n',
    );
    expect(list).toEqual([
      { name: 'matroska,webm', description: 'Matroska / WebM', demux: true, mux: true },
      { name: 'mp4', description: 'MP4', demux: false, mux: true },
      { name: 'mpegts', description: 'MPEG-TS', demux: true, mux: false },
    ]);
  });
});

describe('misc parsers', () => {
  it('parses hwaccels', () => {
    const hw = parseHwaccels(fx('hwaccels.txt'));
    expect(hw.length).toBeGreaterThan(0);
    expect(parseHwaccels('Hardware acceleration methods:\nvaapi\ncuda\n\n')).toEqual([
      'vaapi',
      'cuda',
    ]);
    expect(parseHwaccels('Hardware acceleration methods:\n')).toEqual([]);
  });

  it('parses version output', () => {
    expect(parseVersion(fx('version.txt')).version).toMatch(/\S+/);
    expect(parseVersion('ffprobe version 6.1.1-3ubuntu5 Copyright (c)').version).toBe(
      '6.1.1-3ubuntu5',
    );
    expect(
      parseVersion(
        'ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright\nconfiguration: --enable-gpl --enable-libx264\n',
      ),
    ).toEqual({
      version: '4.4.2-0ubuntu0.22.04.1',
      configuration: '--enable-gpl --enable-libx264',
    });
    expect(parseVersion('something else').version).toBeNull();
  });

  it('parses muxer help', () => {
    expect(
      parseMuxerHelp(
        'Muxer matroska [Matroska]:\n    Common extensions: mkv.\n    Mime type: video/x-matroska.\n',
      ),
    ).toEqual({ extensions: ['mkv'], mimeType: 'video/x-matroska' });
    expect(
      parseMuxerHelp('Muxer mpegts:\n    Common extensions: ts,m2t,m2ts,mts.\n').extensions,
    ).toEqual(['ts', 'm2t', 'm2ts', 'mts']);
    expect(parseMuxerHelp('nothing').extensions).toEqual([]);
  });
});
