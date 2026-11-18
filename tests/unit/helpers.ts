import fs from 'node:fs';
import path from 'node:path';
import type { CodecEntry, FfmpegCapabilities, MediaInfo } from '../../shared/types';
import { parseCodecList, parseMuxers, parseDemuxers } from '../../electron/services/capabilities';
import { parseProbeJson } from '../../electron/services/probe';

export function fixtureProbe(name: string): MediaInfo {
  const json = fs.readFileSync(path.join(__dirname, '../fixtures/probe', `${name}.json`), 'utf8');
  return parseProbeJson(json, `/media/${name}`);
}

const enc = (name: string, type: CodecEntry['type'], codec = name): CodecEntry => ({
  name,
  description: name,
  type,
  codec,
  experimental: false,
});

/** A capabilities object resembling a typical full FFmpeg build. */
export function fakeCaps(overrides: Partial<FfmpegCapabilities> = {}): FfmpegCapabilities {
  const encoders = [
    enc('libx264', 'video', 'h264'),
    enc('libx265', 'video', 'hevc'),
    enc('libsvtav1', 'video', 'av1'),
    enc('libvpx-vp9', 'video', 'vp9'),
    enc('libvpx', 'video', 'vp8'),
    enc('mpeg4', 'video'),
    enc('mpeg2video', 'video'),
    enc('prores_ks', 'video', 'prores'),
    enc('dnxhd', 'video'),
    enc('ffv1', 'video'),
    enc('dvvideo', 'video'),
    enc('h264_vaapi', 'video', 'h264'),
    enc('aac', 'audio'),
    enc('libmp3lame', 'audio', 'mp3'),
    enc('libopus', 'audio', 'opus'),
    enc('libvorbis', 'audio', 'vorbis'),
    enc('flac', 'audio'),
    enc('ac3', 'audio'),
    enc('pcm_s16le', 'audio'),
    enc('pcm_s24le', 'audio'),
    enc('mov_text', 'subtitle'),
    enc('srt', 'subtitle', 'subrip'),
    enc('webvtt', 'subtitle'),
  ];
  const muxers = [
    'mp4',
    'matroska',
    'webm',
    'mov',
    'mpegts',
    'avi',
    'mp3',
    'ipod',
    'adts',
    'wav',
    'flac',
    'ogg',
    'opus',
    'dv',
    'mpeg',
    'mxf',
  ].map((name) => ({ name, description: name }));
  return {
    ffmpeg: { path: '/usr/bin/ffmpeg', version: 'test' },
    ffprobe: { path: '/usr/bin/ffprobe', version: 'test' },
    buildConfiguration: null,
    encoders,
    decoders: [],
    muxers,
    demuxers: [{ name: 'mpegts', description: '' }],
    hwaccels: ['vaapi'],
    hwEncoderTests: [{ encoder: 'h264_vaapi', method: 'vaapi', ok: false, message: 'no device' }],
    discoveredAt: new Date(0).toISOString(),
    ...overrides,
  };
}

export { parseCodecList, parseMuxers, parseDemuxers };
