import { describe, expect, it } from 'vitest';
import {
  explainProbeFailure,
  parseProbeJson,
  parseRational,
  primaryAudio,
  primaryVideo,
} from '../../electron/services/probe';
import { fixtureProbe } from './helpers';

describe('parseRational', () => {
  it('handles common forms', () => {
    expect(parseRational('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseRational('25/1')).toBe(25);
    expect(parseRational('25')).toBe(25);
    expect(parseRational('0/0')).toBeNull();
    expect(parseRational('N/A')).toBeNull();
    expect(parseRational(undefined)).toBeNull();
  });
});

describe('parseProbeJson', () => {
  it('parses an interlaced AVCHD-style MTS', () => {
    const info = fixtureProbe('avchd');
    expect(info.formatName).toBe('mpegts');
    const v = primaryVideo(info)!;
    expect(v).toMatchObject({
      codec: 'h264',
      width: 1920,
      height: 1080,
      interlaced: true,
      fieldOrder: 'tt',
    });
    expect(v.frameRate).toBe(25);
    expect(primaryAudio(info)).toMatchObject({ codec: 'ac3', channels: 2, sampleRate: 48000 });
    expect(info.duration).toBeGreaterThan(0.5);
  });

  it('parses multiple audio and subtitle streams with languages', () => {
    const info = fixtureProbe('multi');
    expect(info.streams.map((s) => s.type)).toEqual(['video', 'audio', 'audio', 'subtitle']);
    expect(info.streams[2]).toMatchObject({ codec: 'opus', language: 'fre' });
    expect(info.streams[3].codec).toBe('subrip');
  });

  it('reads rotation side data (portrait phone video)', () => {
    const v = primaryVideo(fixtureProbe('phone'))!;
    expect([90, 270]).toContain(v.rotation);
  });

  it('tolerates missing fields and unknown durations', () => {
    const info = parseProbeJson(
      JSON.stringify({
        format: { duration: 'N/A' },
        streams: [{ codec_type: 'video' }, { codec_type: 'weird' }],
      }),
      '/x',
    );
    expect(info.duration).toBeNull();
    expect(info.streams[0]).toMatchObject({ index: 0, type: 'video', codec: null });
    expect(info.streams[1].type).toBe('unknown');
  });

  it('rejects invalid JSON with a clear message', () => {
    expect(() => parseProbeJson('{not json', '/x')).toThrow(/not valid JSON/);
  });

  it('explains common failures', () => {
    expect(explainProbeFailure('/a: Invalid data found when processing input')).toMatch(/damaged/);
    expect(explainProbeFailure('/a: Permission denied')).toMatch(/Permission/);
    expect(explainProbeFailure('/a: No such file or directory')).toMatch(/no longer exists/);
  });
});
