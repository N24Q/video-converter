import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findOnPath, resolveExecutable } from '../../electron/services/locator';

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-locator-'));
  fs.mkdirSync(path.join(dir, 'bin dir with spaces'));
  const exe = path.join(dir, 'bin dir with spaces', 'fakeffmpeg');
  fs.writeFileSync(exe, '#!/bin/sh\necho ffmpeg version 1.2.3\n');
  fs.chmodSync(exe, 0o755);
  fs.writeFileSync(path.join(dir, 'notexec'), 'x');
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('findOnPath', () => {
  it('finds an executable in a PATH entry with spaces', async () => {
    const p = await findOnPath(
      'fakeffmpeg',
      `/nonexistent:${path.join(dir, 'bin dir with spaces')}`,
      [],
    );
    expect(p).toBe(path.join(dir, 'bin dir with spaces', 'fakeffmpeg'));
  });

  it('ignores non-executable files and missing dirs', async () => {
    expect(await findOnPath('notexec', dir, [])).toBeNull();
    expect(await findOnPath('nothing-here-xyz', '/nonexistent', [])).toBeNull();
  });
});

describe('resolveExecutable', () => {
  it('rejects relative configured paths', async () => {
    const r = await resolveExecutable('ffmpeg', 'bin/ffmpeg');
    expect(r.path).toBeNull();
    expect(r.error).toMatch(/absolute/);
  });

  it('rejects configured paths that are not executable', async () => {
    const r = await resolveExecutable('ffmpeg', path.join(dir, 'notexec'));
    expect(r.path).toBeNull();
    expect(r.error).toMatch(/not an executable/);
  });

  it('accepts a configured executable', async () => {
    const exe = path.join(dir, 'bin dir with spaces', 'fakeffmpeg');
    expect(await resolveExecutable('ffmpeg', exe)).toEqual({ path: exe, error: null });
  });
});
