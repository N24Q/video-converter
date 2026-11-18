import fs from 'node:fs/promises';
import type { ConcatCheck, MediaInfo } from '../../shared/types';
import { primaryAudio, primaryVideo } from './probe';

/**
 * Decide whether clips can be joined with the concat demuxer (identical
 * stream parameters) or need the normalising re-encode.
 */
export function checkConcatCompatibility(clips: MediaInfo[]): ConcatCheck {
  const differences: string[] = [];
  if (clips.length < 2)
    return { compatible: false, differences: ['Select at least two recordings to combine.'] };
  const first = clips[0];
  const v0 = primaryVideo(first);
  const a0 = primaryAudio(first);
  const count = (m: MediaInfo, t: string) =>
    m.streams.filter((s) => s.type === t && !s.isAttachedPic).length;

  clips.slice(1).forEach((c, i) => {
    const name = `Clip ${i + 2}`;
    const v = primaryVideo(c);
    const a = primaryAudio(c);
    if (count(c, 'video') !== count(first, 'video'))
      differences.push(`${name} has a different number of video streams.`);
    if (count(c, 'audio') !== count(first, 'audio'))
      differences.push(`${name} has a different number of audio streams.`);
    if (v && v0) {
      if (v.codec !== v0.codec)
        differences.push(`${name} video codec ${v.codec} differs from ${v0.codec}.`);
      if (v.width !== v0.width || v.height !== v0.height)
        differences.push(
          `${name} resolution ${v.width}x${v.height} differs from ${v0.width}x${v0.height}.`,
        );
      if (v.pixFmt !== v0.pixFmt)
        differences.push(`${name} pixel format ${v.pixFmt} differs from ${v0.pixFmt}.`);
      if (v.frameRate && v0.frameRate && Math.abs(v.frameRate - v0.frameRate) > 0.01)
        differences.push(
          `${name} frame rate ${v.frameRate.toFixed(3)} differs from ${v0.frameRate.toFixed(3)}.`,
        );
      if (!!v.interlaced !== !!v0.interlaced)
        differences.push(`${name} interlacing differs from the first clip.`);
      if ((v.rotation ?? 0) !== (v0.rotation ?? 0))
        differences.push(`${name} rotation differs from the first clip.`);
    }
    if (a && a0) {
      if (a.codec !== a0.codec)
        differences.push(`${name} audio codec ${a.codec} differs from ${a0.codec}.`);
      if (a.sampleRate !== a0.sampleRate)
        differences.push(
          `${name} audio sample rate differs (${a.sampleRate} vs ${a0.sampleRate}).`,
        );
      if (a.channels !== a0.channels)
        differences.push(`${name} audio channel count differs (${a.channels} vs ${a0.channels}).`);
    }
  });
  return { compatible: differences.length === 0, differences };
}

/** Escape a path for an ffconcat list ("file '...'" with ' escaped as '\''). */
export function concatListLine(p: string): string {
  if (/[\r\n]/.test(p)) throw new Error('File paths containing line breaks cannot be combined.');
  return `file '${p.replace(/'/g, "'\\''")}'`;
}

export function concatListContent(paths: string[]): string {
  return ['ffconcat version 1.0', ...paths.map(concatListLine)].join('\n') + '\n';
}

export async function writeConcatList(listPath: string, paths: string[]) {
  await fs.writeFile(listPath, concatListContent(paths), { encoding: 'utf8', mode: 0o600 });
}
