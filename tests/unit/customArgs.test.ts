import { describe, expect, it } from 'vitest';
import { tokenizeArgs, validateCustomArgs } from '../../electron/services/customArgs';

describe('validateCustomArgs', () => {
  it('accepts allowlisted option/value pairs', () => {
    expect(
      validateCustomArgs([
        '-tune',
        'film',
        '-g',
        '48',
        '-profile:v',
        'high',
        '-x264-params',
        'aq-mode=3',
      ]),
    ).toEqual({ ok: true, errors: [] });
    expect(validateCustomArgs(['-qmin', '-1']).ok).toBe(true);
    expect(validateCustomArgs([]).ok).toBe(true);
    expect(validateCustomArgs(undefined).ok).toBe(true);
  });

  it('blocks app-managed and dangerous options', () => {
    for (const bad of [
      ['-i', 'x'],
      ['-y'],
      ['-f', 'mp4'],
      ['-map', '0'],
      ['-vf', 'movie=x'],
      ['-filter_complex', 'a'],
      ['-lavfi', 'a'],
      ['-progress', 'x'],
      ['-report'],
      ['-dump_attachment:t', 'x'],
      ['-attach', 'x'],
      ['-filter_script:v', 'x'],
      ['-c:v', 'copy'],
    ]) {
      expect(validateCustomArgs(bad).ok, bad.join(' ')).toBe(false);
    }
  });

  it('rejects unknown options, bare values and paths', () => {
    expect(validateCustomArgs(['-whatever', '1']).ok).toBe(false);
    expect(validateCustomArgs(['film']).ok).toBe(false);
    expect(validateCustomArgs(['-metadata', 'title=/etc/passwd']).ok).toBe(false);
    expect(validateCustomArgs(['-x264-params', 'stats=..']).ok).toBe(false);
    expect(validateCustomArgs(['-tune', 'http://evil']).ok).toBe(false);
    expect(validateCustomArgs(['-tune']).ok).toBe(false);
    expect(validateCustomArgs(['-tune', '-g']).ok).toBe(false);
    expect(validateCustomArgs(['-tune', 'a\nb']).ok).toBe(false);
    expect(validateCustomArgs('-tune film').ok).toBe(false);
    expect(validateCustomArgs([';rm', '-rf']).ok).toBe(false);
  });

  it('limits argument count', () => {
    expect(validateCustomArgs(Array.from({ length: 50 }, (_, i) => (i % 2 ? '1' : '-g'))).ok).toBe(
      false,
    );
  });
});

describe('tokenizeArgs', () => {
  it('splits on whitespace and honours quotes without shell semantics', () => {
    expect(tokenizeArgs('-tune film  -metadata "title=My Film"')).toEqual([
      '-tune',
      'film',
      '-metadata',
      'title=My Film',
    ]);
    expect(tokenizeArgs("-x264-params 'a=1:b=2' $(whoami)")).toEqual([
      '-x264-params',
      'a=1:b=2',
      '$(whoami)',
    ]);
    expect(tokenizeArgs('  ')).toEqual([]);
    expect(tokenizeArgs('-a ""')).toEqual(['-a', '']);
  });
});
