import { describe, expect, it } from 'vitest';
import { classifyFfmpegFailure } from '../../electron/services/errors';

const c = (s: string, hw = false, signal: NodeJS.Signals | null = null) =>
  classifyFfmpegFailure(s, 1, signal, { hwEncoder: hw });

describe('classifyFfmpegFailure', () => {
  it('recognises common failure kinds', () => {
    expect(c('av_interleaved_write_frame(): No space left on device').kind).toBe('disk-full');
    expect(c('/out/x.mp4: Permission denied').kind).toBe('permission-denied');
    expect(c('/in/x.mts: Invalid data found when processing input').kind).toBe('unsupported-input');
    expect(
      c(
        'Could not find tag for codec pcm_bluray in stream #1, codec not currently supported in container',
      ).kind,
    ).toBe('unsupported-combination');
    expect(c('Unknown encoder libfoo').kind).toBe('unsupported-combination');
    expect(c('', false, 'SIGKILL').kind).toBe('unexpected-termination');
    expect(c('weird').kind).toBe('unknown');
  });

  it('only blames the hardware encoder when one was used', () => {
    expect(c('Failed to initialise VAAPI connection: -1', true).kind).toBe('hw-encoder-failed');
    expect(c('Failed to initialise VAAPI connection: -1', false).kind).not.toBe(
      'hw-encoder-failed',
    );
  });

  it('keeps a bounded technical tail', () => {
    const r = c(Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'));
    expect(r.details?.split('\n')).toHaveLength(40);
    expect(r.details).toContain('line 99');
  });
});
