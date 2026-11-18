import { describe, expect, it } from 'vitest';
import { ProgressParser, computeProgress } from '../../electron/services/progress';
import { LineRing } from '../../electron/services/runner';

const block = (us: string, speed: string, end = false) =>
  `frame=100\nfps=50.0\nout_time_us=${us}\nout_time_ms=${us}\nout_time=00:00:02.000000\ntotal_size=1024\nspeed=${speed}\nprogress=${end ? 'end' : 'continue'}\n`;

describe('ProgressParser', () => {
  it('parses complete blocks, even when split across chunks', () => {
    const p = new ProgressParser();
    const text = block('2000000', '2.5x');
    expect(p.feed(text.slice(0, 30))).toEqual([]);
    const snaps = p.feed(text.slice(30));
    expect(snaps).toEqual([
      { outTimeSec: 2, speed: 2.5, fps: 50, totalSize: 1024, frame: 100, end: false },
    ]);
  });

  it('handles N/A values and the end marker', () => {
    const p = new ProgressParser();
    const [s] = p.feed('out_time_us=N/A\nout_time=N/A\nspeed=N/A\nprogress=end\n');
    expect(s).toMatchObject({ outTimeSec: null, speed: null, end: true });
  });

  it('falls back to out_time when microseconds are missing', () => {
    const [s] = new ProgressParser().feed('out_time=01:02:03.500000\nprogress=continue\n');
    expect(s.outTimeSec).toBeCloseTo(3723.5);
  });

  it('does not grow without bound on garbage', () => {
    const p = new ProgressParser();
    p.feed('x'.repeat(200_000));
    expect(p.feed('\nprogress=continue\n')).toHaveLength(1);
  });
});

describe('computeProgress', () => {
  it('computes percent and ETA from speed', () => {
    const r = computeProgress(
      { outTimeSec: 30, speed: 2, fps: null, totalSize: null, frame: null, end: false },
      120,
      15,
    );
    expect(r.percent).toBe(25);
    expect(r.etaSec).toBe(45);
  });

  it('is indeterminate when duration is unknown', () => {
    const r = computeProgress(
      { outTimeSec: 30, speed: 2, fps: null, totalSize: null, frame: null, end: false },
      null,
      15,
    );
    expect(r.percent).toBeNull();
    expect(r.etaSec).toBeNull();
  });

  it('clamps and finishes at 100', () => {
    expect(
      computeProgress(
        { outTimeSec: 130, speed: 1, fps: null, totalSize: null, frame: null, end: false },
        120,
        5,
      ).percent,
    ).toBe(100);
    expect(
      computeProgress(
        { outTimeSec: 119, speed: 1, fps: null, totalSize: null, frame: null, end: true },
        120,
        5,
      ).percent,
    ).toBe(100);
  });
});

describe('LineRing', () => {
  it('keeps only the last N lines and truncates long ones', () => {
    const r = new LineRing(3, 10);
    r.push('a\nb\nc\n');
    r.push('d\n' + 'x'.repeat(50) + '\npartial');
    const lines = r.text().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('c');
    expect(lines[1]).toBe('d');
    expect(lines[2]).toBe('x'.repeat(10) + '…');
    expect(lines[3]).toBe('partial');
  });
});
