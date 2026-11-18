import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildMpls } from '../../electron/services/avchd/mpls';
import {
  hasFfmpeg,
  launch,
  makeClip,
  probeCodecs,
  probeDuration,
  stubOpenDialog,
  tmpDir,
} from './helpers';

const ffmpegAvailable = hasFfmpeg();

test.describe('application shell', () => {
  test('launches with secure webPreferences and no Node in the renderer', async () => {
    const { app, page } = await launch(tmpDir('vc-e2e-ud-'));
    try {
      expect(await page.title()).toBe('Video Converter');
      const prefs = await app.evaluate(({ BrowserWindow }) => {
        // getLastWebPreferences exists at runtime but is missing from Electron's typings
        const wc = BrowserWindow.getAllWindows()[0].webContents as unknown as {
          getLastWebPreferences(): Record<string, unknown> | null;
        };
        const p = wc.getLastWebPreferences();
        return {
          contextIsolation: p?.contextIsolation,
          nodeIntegration: p?.nodeIntegration,
          sandbox: p?.sandbox,
        };
      });
      expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
      const renderer = await page.evaluate(() => ({
        require: typeof (window as unknown as { require?: unknown }).require,
        process: typeof (window as unknown as { process?: unknown }).process,
        api: typeof window.videoConverter,
      }));
      expect(renderer).toEqual({ require: 'undefined', process: 'undefined', api: 'object' });
      // navigation away from the app is blocked
      await page.evaluate(() => {
        window.location.href = 'https://example.com';
      });
      await page.waitForTimeout(500);
      expect(page.url()).toMatch(/^file:/);
    } finally {
      await app.close();
    }
  });

  test('diagnostics show architecture and FFmpeg status', async () => {
    const { app, page } = await launch(tmpDir('vc-e2e-ud-'));
    try {
      await page.getByRole('tab', { name: 'Diagnostics' }).click();
      await expect(page.getByTestId('arch')).toContainText(
        process.arch === 'x64' ? 'x86_64' : 'ARM64',
      );
      if (ffmpegAvailable)
        await expect(page.getByTestId('ffmpeg-status')).toContainText('/ffmpeg', {
          timeout: 20_000,
        });
    } finally {
      await app.close();
    }
  });

  test('settings and mode persist across restarts', async () => {
    const ud = tmpDir('vc-e2e-ud-');
    let { app, page } = await launch(ud);
    await page.getByLabel('Advanced mode').check();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByTestId('concurrency').selectOption('2');
    await expect(page.getByTestId('concurrency')).toHaveValue('2');
    await app.close();

    ({ app, page } = await launch(ud));
    try {
      await expect(page.getByLabel('Advanced mode')).toBeChecked();
      await page.getByRole('tab', { name: 'Settings' }).click();
      await expect(page.getByTestId('concurrency')).toHaveValue('2');
    } finally {
      await app.close();
    }
  });

  test('recovers from a corrupted settings file', async () => {
    const ud = tmpDir('vc-e2e-ud-');
    fs.writeFileSync(path.join(ud, 'settings.json'), '{ this is not json');
    const { app, page } = await launch(ud);
    try {
      await expect(page.getByTestId('simple-settings')).toBeVisible();
      expect(fs.existsSync(path.join(ud, 'settings.json.corrupt'))).toBe(true);
    } finally {
      await app.close();
    }
  });
});

test.describe('conversion', () => {
  test.skip(!ffmpegAvailable, 'FFmpeg/FFprobe are not installed');

  test('imports a file, converts it with real progress, and verifies the output', async () => {
    const work = tmpDir('vc-e2e-work-');
    const src = path.join(work, 'holiday clip – ünïcode.mkv');
    makeClip(src, { seconds: 4 });
    const out = path.join(work, 'out');
    fs.mkdirSync(out);
    const before = fs.statSync(src).mtimeMs;

    const { app, page } = await launch(tmpDir('vc-e2e-ud-'));
    try {
      await stubOpenDialog(app, [src]);
      await page.getByRole('button', { name: 'Browse files…' }).click();
      await expect(page.getByTestId('media-list')).toContainText('holiday clip', {
        timeout: 20_000,
      });
      await expect(page.getByTestId('media-list')).toContainText('h264');

      await stubOpenDialog(app, [out]);
      await page.getByRole('button', { name: 'Change…' }).first().click();
      await expect(page.getByTestId('output-dir')).toHaveText(out);

      await page.getByTestId('preset').selectOption('best-compatibility');
      await page.getByTestId('format').selectOption('mp4');
      await expect(page.getByTestId('plan-preview')).toContainText('libx264');
      await page.getByTestId('start').click();

      const job = page.getByTestId('job').first();
      await expect(job).toHaveAttribute('data-status', 'completed', { timeout: 60_000 });
      const expected = path.join(out, 'holiday clip – ünïcode.mp4');
      expect(fs.existsSync(expected)).toBe(true);
      expect(probeCodecs(expected)).toEqual(['h264', 'aac']);
      expect(probeDuration(expected)).toBeGreaterThan(3.5);
      // no temporary files left behind, source untouched
      expect(fs.readdirSync(out).filter((f) => f.startsWith('.'))).toEqual([]);
      expect(fs.statSync(src).mtimeMs).toBe(before);

      // second run of the same file gets a non-conflicting name
      await page.getByTestId('start').click();
      await expect(page.getByTestId('job').nth(1)).toHaveAttribute('data-status', 'completed', {
        timeout: 60_000,
      });
      expect(fs.existsSync(path.join(out, 'holiday clip – ünïcode_converted.mp4'))).toBe(true);

      await page.getByRole('tab', { name: 'History' }).click();
      await expect(page.locator('table.list')).toContainText('completed');
    } finally {
      await app.close();
    }
  });

  test('cancelling a running conversion removes the partial output', async () => {
    const work = tmpDir('vc-e2e-work-');
    const src = path.join(work, 'long.mp4');
    makeClip(src, { seconds: 120, size: '1280x720' });
    const out = path.join(work, 'out');
    fs.mkdirSync(out);

    const { app, page } = await launch(tmpDir('vc-e2e-ud-'));
    try {
      await stubOpenDialog(app, [src]);
      await page.getByRole('button', { name: 'Browse files…' }).click();
      await expect(page.getByTestId('media-list')).toContainText('h264', { timeout: 20_000 });
      await stubOpenDialog(app, [out]);
      await page.getByRole('button', { name: 'Change…' }).first().click();
      await page.getByTestId('preset').selectOption('high-quality');
      await page.getByTestId('format').selectOption('mkv');
      await page.getByTestId('start').click();

      const job = page.getByTestId('job').first();
      await expect(job).toHaveAttribute('data-status', 'converting', { timeout: 20_000 });
      await expect(job.locator('progress')).toHaveAttribute('value', /.+/, { timeout: 20_000 });
      await job.getByRole('button', { name: 'Cancel' }).click();
      await expect(job).toHaveAttribute('data-status', 'cancelled', { timeout: 20_000 });
      expect(fs.readdirSync(out)).toEqual([]);
      // the FFmpeg process writing the partial file must be gone
      let ffmpegRunning = '';
      try {
        ffmpegRunning = execFileSync('pgrep', ['-f', 'long.partial-']).toString().trim();
      } catch {
        ffmpegRunning = '';
      }
      expect(ffmpegRunning).toBe('');

      // retry after cancel runs again
      await job.getByRole('button', { name: 'Retry' }).click();
      await expect(job).toHaveAttribute('data-status', /converting|preparing/, { timeout: 20_000 });
      await job.getByRole('button', { name: 'Cancel' }).click();
      await expect(job).toHaveAttribute('data-status', 'cancelled', { timeout: 20_000 });
    } finally {
      await app.close();
    }
  });

  test('reports an understandable error for a damaged file', async () => {
    const work = tmpDir('vc-e2e-work-');
    const bad = path.join(work, 'broken.mp4');
    fs.writeFileSync(bad, Buffer.alloc(4096, 7));
    const { app, page } = await launch(tmpDir('vc-e2e-ud-'));
    try {
      await stubOpenDialog(app, [bad]);
      await page.getByRole('button', { name: 'Browse files…' }).click();
      await expect(page.getByTestId('media-list')).toContainText(/damaged|not a recognised/i, {
        timeout: 20_000,
      });
    } finally {
      await app.close();
    }
  });

  test('AVCHD folder: detects playlist order and combines clips', async () => {
    const work = tmpDir('vc-e2e-avchd-');
    const card = path.join(work, 'SD CARD');
    const bdmv = path.join(card, 'PRIVATE', 'AVCHD', 'BDMV');
    for (const d of ['STREAM', 'PLAYLIST', 'CLIPINF'])
      fs.mkdirSync(path.join(bdmv, d), { recursive: true });
    fs.writeFileSync(path.join(bdmv, 'INDEX.BDM'), 'INDX0100');
    fs.writeFileSync(path.join(bdmv, 'MOVIEOBJ.BDM'), 'MOBJ0100');
    const ts = [
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'ac3',
      '-ac',
      '2',
    ];
    for (const n of ['00000', '00001', '00002']) {
      makeClip(path.join(bdmv, 'STREAM', `${n}.MTS`), {
        seconds: 2,
        size: '640x360',
        extra: ts,
        format: 'mpegts',
      });
      fs.writeFileSync(path.join(bdmv, 'CLIPINF', `${n}.CPI`), 'HDMV0100');
    }
    // Playback order differs from file order: 00002 then 00000 then 00001.
    fs.writeFileSync(
      path.join(bdmv, 'PLAYLIST', '00000.MPL'),
      buildMpls([{ clip: '00002' }, { clip: '00000' }, { clip: '00001', cc: 6 }]),
    );
    const before = fs
      .readdirSync(path.join(bdmv, 'STREAM'))
      .map((f) => fs.statSync(path.join(bdmv, 'STREAM', f)).mtimeMs);
    const out = path.join(work, 'out');
    fs.mkdirSync(out);

    const { app, page } = await launch(tmpDir('vc-e2e-ud-'));
    try {
      await stubOpenDialog(app, [card]);
      await page.getByRole('button', { name: 'Browse folder…' }).click();
      const panel = page.getByTestId('avchd-panel');
      await expect(panel).toContainText('Camera playlist');
      const names = await panel.locator('td.name').allTextContents();
      expect(names).toEqual(['00002.MTS', '00000.MTS', '00001.MTS']);
      await expect(panel).toContainText('Recording 2');
      await expect(panel.locator('text=Inspecting…')).toHaveCount(0, { timeout: 20_000 });

      await stubOpenDialog(app, [out]);
      await page.getByRole('button', { name: 'Change…' }).first().click();

      // Lossless join with stream copy
      await page.getByTestId('preset').selectOption('stream-copy');
      await page.getByTestId('format').selectOption('mkv');
      await expect(panel).toContainText('can be joined directly');
      await page.getByTestId('combine-button').click();
      const job = page.getByTestId('job').first();
      await expect(job).toHaveAttribute('data-status', 'completed', { timeout: 60_000 });
      const combined = path.join(out, '00002_combined.mkv');
      expect(fs.existsSync(combined)).toBe(true);
      expect(probeDuration(combined)).toBeGreaterThan(5.5);
      expect(probeCodecs(combined)).toEqual(['h264', 'ac3']);

      // Convert individually as a batch
      await page.getByTestId('preset').selectOption('best-compatibility');
      await page.getByTestId('format').selectOption('mp4');
      await page.getByTestId('start').click();
      await expect(page.locator('[data-testid=job][data-status=completed]')).toHaveCount(4, {
        timeout: 90_000,
      });
      for (const n of ['00000', '00001', '00002'])
        expect(fs.existsSync(path.join(out, `${n}.mp4`))).toBe(true);

      // Source card untouched
      const after = fs
        .readdirSync(path.join(bdmv, 'STREAM'))
        .map((f) => fs.statSync(path.join(bdmv, 'STREAM', f)).mtimeMs);
      expect(after).toEqual(before);
    } finally {
      await app.close();
    }
  });

  test('AVCHD: clips with different parameters are normalised when combined', async () => {
    const work = tmpDir('vc-e2e-avchd2-');
    const bdmv = path.join(work, 'BDMV');
    fs.mkdirSync(path.join(bdmv, 'STREAM'), { recursive: true });
    const ts = (ac: string) => [
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'ac3',
      '-ac',
      ac,
    ];
    makeClip(path.join(bdmv, 'STREAM', '00001.MTS'), {
      seconds: 2,
      size: '640x360',
      rate: 25,
      extra: ts('2'),
      format: 'mpegts',
    });
    makeClip(path.join(bdmv, 'STREAM', '00002.MTS'), {
      seconds: 2,
      size: '320x240',
      rate: 30,
      extra: ts('1'),
      format: 'mpegts',
    });
    const out = path.join(work, 'out');
    fs.mkdirSync(out);

    const { app, page } = await launch(tmpDir('vc-e2e-ud-'));
    try {
      await stubOpenDialog(app, [work]);
      await page.getByRole('button', { name: 'Browse folder…' }).click();
      const panel = page.getByTestId('avchd-panel');
      await expect(panel).toContainText('File number');
      await expect(panel.locator('text=Inspecting…')).toHaveCount(0, { timeout: 20_000 });
      await stubOpenDialog(app, [out]);
      await page.getByRole('button', { name: 'Change…' }).first().click();
      await expect(panel).toContainText('normalised');

      // Stream copy is refused with an explanation
      await page.getByTestId('preset').selectOption('stream-copy');
      await page.getByTestId('combine-button').click();
      await expect(page.getByTestId('errors')).toContainText(
        'cannot be joined without re-encoding',
      );

      await page.getByTestId('preset').selectOption('best-compatibility');
      await page.getByTestId('format').selectOption('mp4');
      await page.getByTestId('combine-button').click();
      const job = page.getByTestId('job').first();
      await expect(job).toHaveAttribute('data-status', 'completed', { timeout: 60_000 });
      const combined = path.join(out, '00001_combined.mp4');
      expect(probeDuration(combined)).toBeGreaterThan(3.5);
      expect(probeCodecs(combined)).toEqual(['h264', 'aac']);
    } finally {
      await app.close();
    }
  });
});
