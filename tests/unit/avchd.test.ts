import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildMpls,
  parseMpls,
  isClipInfo,
  PlaylistParseError,
} from '../../electron/services/avchd/mpls';
import {
  findAvchdRoots,
  orderClips,
  scanBdmv,
  findMediaFiles,
} from '../../electron/services/avchd/scan';
import {
  checkConcatCompatibility,
  concatListContent,
  concatListLine,
} from '../../electron/services/concat';
import { fixtureProbe } from './helpers';

let tmp: string;

function mkAvchd(
  root: string,
  opts: {
    clips: string[];
    playlist?: Buffer | null;
    ext?: string;
    upper?: boolean;
    noStream?: boolean;
    noIndex?: boolean;
  },
) {
  const up = opts.upper !== false;
  const n = (s: string) => (up ? s.toUpperCase() : s.toLowerCase());
  const bdmv = path.join(root, n('PRIVATE'), n('AVCHD'), n('BDMV'));
  fs.mkdirSync(path.join(bdmv, n('PLAYLIST')), { recursive: true });
  fs.mkdirSync(path.join(bdmv, n('CLIPINF')), { recursive: true });
  if (!opts.noStream) fs.mkdirSync(path.join(bdmv, n('STREAM')), { recursive: true });
  if (!opts.noIndex) fs.writeFileSync(path.join(bdmv, n('INDEX.BDM')), 'INDX0100');
  fs.writeFileSync(path.join(bdmv, n('MOVIEOBJ.BDM')), 'MOBJ0100');
  for (const c of opts.clips) {
    if (!opts.noStream)
      fs.writeFileSync(path.join(bdmv, n('STREAM'), `${c}.${opts.ext ?? n('MTS')}`), 'x');
    fs.writeFileSync(path.join(bdmv, n('CLIPINF'), `${c}.${n('CPI')}`), 'HDMV0100');
  }
  if (opts.playlist)
    fs.writeFileSync(path.join(bdmv, n('PLAYLIST'), `00000.${n('MPL')}`), opts.playlist);
  return bdmv;
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-avchd-'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('MPLS parsing', () => {
  it('round-trips play items with times and connection conditions', () => {
    const pl = parseMpls(
      buildMpls([
        { clip: '00003', cc: 1, inSec: 0, outSec: 12.5 },
        { clip: '00004', cc: 6 },
      ]),
    );
    expect(pl.version).toBe('0100');
    expect(pl.items).toEqual([
      { clipName: '00003', codecId: 'M2TS', connectionCondition: 1, inTime: 0, outTime: 12.5 },
      { clipName: '00004', codecId: 'M2TS', connectionCondition: 6, inTime: 0, outTime: 10 },
    ]);
  });

  it('rejects junk and truncated files', () => {
    expect(() => parseMpls(Buffer.from('hello world, not a playlist'))).toThrow(PlaylistParseError);
    const good = buildMpls([{ clip: '00001' }]);
    expect(() => parseMpls(good.subarray(0, good.length - 5))).toThrow(/Truncated/);
    expect(() => parseMpls(Buffer.alloc(4))).toThrow(/too small/);
  });

  it('recognises clip info headers', () => {
    expect(isClipInfo(Buffer.from('HDMV0100'))).toBe(true);
    expect(isClipInfo(Buffer.from('XXXX0100'))).toBe(false);
  });
});

describe('orderClips', () => {
  it('uses playlist order, not filename order, and groups seamless continuations', () => {
    const pl = parseMpls(
      buildMpls([
        { clip: '00010', cc: 1 },
        { clip: '00002', cc: 1 },
        { clip: '00003', cc: 6 }, // camera split the same recording
        { clip: '00001', cc: 1 },
      ]),
    );
    const r = orderClips(
      ['00001', '00002', '00003', '00010'],
      [{ name: '00000.MPL', playlist: pl }],
    );
    expect(r.method).toBe('playlist');
    expect(r.order.map((o) => [o.name, o.groupIndex])).toEqual([
      ['00010', 0],
      ['00002', 1],
      ['00003', 1],
      ['00001', 2],
    ]);
  });

  it('appends unlisted clips and reports partial ordering', () => {
    const pl = parseMpls(buildMpls([{ clip: '00002' }]));
    const r = orderClips(['00010', '00002', '00001'], [{ name: 'a', playlist: pl }]);
    expect(r.method).toBe('playlist-partial');
    expect(r.order.map((o) => o.name)).toEqual(['00002', '00001', '00010']);
    expect(r.explanation).toMatch(/2 clip/);
  });

  it('falls back to natural filename order without playlists', () => {
    const r = orderClips(['00010', '00002', '00001'], []);
    expect(r.method).toBe('filename');
    expect(r.order.map((o) => o.name)).toEqual(['00001', '00002', '00010']);
    expect(r.explanation).toMatch(/file number/);
  });
});

describe('AVCHD folder detection and scanning', () => {
  it('detects a standard PRIVATE/AVCHD/BDMV card layout from the card root', async () => {
    const root = path.join(tmp, 'card1');
    const bdmv = mkAvchd(root, {
      clips: ['00000', '00001', '00002'],
      playlist: buildMpls([{ clip: '00001' }, { clip: '00000' }, { clip: '00002', cc: 5 }]),
    });
    expect(await findAvchdRoots(root)).toEqual([bdmv]);
    const scan = await scanBdmv(bdmv);
    expect(scan.rootPath).toBe(root);
    expect(scan.hasIndex).toBe(true);
    expect(scan.orderMethod).toBe('playlist');
    expect(scan.clips.map((c) => c.name)).toEqual(['00001', '00000', '00002']);
    expect(scan.clips.map((c) => c.groupIndex)).toEqual([0, 1, 1]);
    expect(scan.clips.every((c) => c.hasClipInfo)).toBe(true);
    expect(scan.warnings).toEqual([]);
  });

  it('works with lower-case names, .m2ts clips and when STREAM itself is selected', async () => {
    const root = path.join(tmp, 'card2 with spaces – ünïcode');
    const bdmv = mkAvchd(root, {
      clips: ['00001', '00002'],
      upper: false,
      ext: 'm2ts',
      playlist: null,
    });
    expect(await findAvchdRoots(path.join(bdmv, 'stream'))).toEqual([bdmv]);
    const scan = await scanBdmv(bdmv);
    expect(scan.orderMethod).toBe('filename');
    expect(scan.clips.map((c) => c.fileName)).toEqual(['00001.m2ts', '00002.m2ts']);
  });

  it('finds structures copied to arbitrary folder names', async () => {
    const root = path.join(tmp, 'Backups', 'Camcorder 2014');
    fs.mkdirSync(path.join(root, 'BDMV', 'STREAM'), { recursive: true });
    fs.writeFileSync(path.join(root, 'BDMV', 'STREAM', '00001.MTS'), 'x');
    const roots = await findAvchdRoots(path.join(tmp, 'Backups'));
    expect(roots).toEqual([path.join(root, 'BDMV')]);
    const scan = await scanBdmv(roots[0]);
    expect(scan.warnings.join(' ')).toMatch(/PLAYLIST/);
    expect(scan.warnings.join(' ')).toMatch(/INDEX/);
  });

  it('does not report BDMV folders without STREAM', async () => {
    const root = path.join(tmp, 'broken');
    mkAvchd(root, { clips: ['00001'], noStream: true });
    expect(await findAvchdRoots(root)).toEqual([]);
  });

  it('reports invalid playlists and missing clips', async () => {
    const root = path.join(tmp, 'card3');
    const bdmv = mkAvchd(root, {
      clips: ['00001'],
      playlist: buildMpls([{ clip: '00001' }, { clip: '00009' }]),
    });
    fs.writeFileSync(path.join(bdmv, 'PLAYLIST', '00001.MPL'), 'garbage');
    const scan = await scanBdmv(bdmv);
    expect(scan.playlists.find((p) => p.name === '00001.MPL')?.valid).toBe(false);
    expect(scan.warnings.join(' ')).toMatch(/could not be read/);
    expect(scan.warnings.join(' ')).toMatch(/missing from STREAM.*00009/);
  });

  it('finds ordinary media files in non-AVCHD folders', async () => {
    const dir = path.join(tmp, 'plain');
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'b10.mp4'), '');
    fs.writeFileSync(path.join(dir, 'b2.MOV'), '');
    fs.writeFileSync(path.join(dir, 'notes.txt'), '');
    fs.writeFileSync(path.join(dir, 'sub', 'c.mkv'), '');
    const r = await findMediaFiles(dir, new Set(['mp4', 'mov', 'mkv']));
    expect(r.files.map((f) => path.relative(dir, f))).toEqual([
      'b2.MOV',
      'b10.mp4',
      path.join('sub', 'c.mkv'),
    ]);
    expect((await findMediaFiles(dir, new Set(['mp4', 'mov', 'mkv']), 3, 1)).truncated).toBe(true);
  });
});

describe('concat helpers', () => {
  it('escapes quotes in concat lists and rejects newlines', () => {
    expect(concatListLine("/m/it's here.mts")).toBe("file '/m/it'\\''s here.mts'");
    expect(() => concatListLine('/m/a\nb.mts')).toThrow();
    expect(concatListContent(['/a.mts'])).toBe("ffconcat version 1.0\nfile '/a.mts'\n");
  });

  it('accepts identical clips and lists differences otherwise', () => {
    const a = fixtureProbe('avchd');
    expect(checkConcatCompatibility([a, fixtureProbe('avchd')]).compatible).toBe(true);
    const r = checkConcatCompatibility([a, fixtureProbe('multi')]);
    expect(r.compatible).toBe(false);
    expect(r.differences.join(' ')).toMatch(/resolution 640x360 differs/);
    expect(r.differences.join(' ')).toMatch(/audio codec aac differs/);
    expect(checkConcatCompatibility([a]).compatible).toBe(false);
  });
});
