import { describe, expect, it } from 'vitest';
import {
  sanitizeStem,
  stemOf,
  tempOutputPath,
  uniqueOutputPath,
} from '../../electron/services/outputNames';

describe('output names', () => {
  it('sanitises unsafe characters but keeps unicode and spaces', () => {
    expect(sanitizeStem('Holiday 2024 – Ŝkiing 🎿')).toBe('Holiday 2024 – Ŝkiing 🎿');
    expect(sanitizeStem('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(sanitizeStem('..hidden')).toBe('hidden');
    expect(sanitizeStem('\u0000\u0007')).toBe('output');
    expect(Buffer.byteLength(sanitizeStem('é'.repeat(500)))).toBeLessThanOrEqual(180);
  });

  it('gets the stem of a path', () => {
    expect(stemOf('/a/b/00001.MTS')).toBe('00001');
    expect(stemOf('/a/b/my.video.file.mkv')).toBe('my.video.file');
    expect(stemOf('/a/noext')).toBe('noext');
  });

  it('avoids existing files, queued outputs and sources', () => {
    const existing = new Set(['/out/holiday.mp4', '/out/holiday_converted.mp4']);
    const ctx = {
      exists: (p: string) => existing.has(p),
      reserved: new Set(['/out/holiday_converted_1.mp4']),
      sources: new Set<string>(),
    };
    expect(uniqueOutputPath('/out', 'holiday', 'mp4', ctx)).toBe('/out/holiday_converted_2.mp4');
    expect(uniqueOutputPath('/out', 'other', 'mp4', ctx)).toBe('/out/other.mp4');
    const src = {
      exists: () => false,
      reserved: new Set<string>(),
      sources: new Set(['/v/clip.mp4']),
    };
    expect(uniqueOutputPath('/v', 'clip', 'mp4', src)).toBe('/v/clip_converted.mp4');
  });

  it('puts the temp file next to the output, hidden', () => {
    expect(tempOutputPath('/out/My File.mp4', 'abcdef1234567890')).toBe(
      '/out/.My File.partial-abcdef12.mp4',
    );
  });
});
