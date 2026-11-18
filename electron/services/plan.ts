import type {
  ConversionSettings,
  FfmpegCapabilities,
  MediaInfo,
  MediaStream,
  StreamPlanEntry,
  ValidationResult,
} from '../../shared/types';
import {
  BITMAP_SUBTITLE_CODECS,
  CONTAINERS,
  ENCODERS,
  TEXT_SUBTITLE_CODECS,
  containerAllows,
  encoderCodec,
  getFormatDef,
  isEncoderUsable,
} from './catalog';
import { hasFormat } from './capabilities';
import { validateCustomArgs } from './customArgs';

const label = (s: MediaStream) => `${s.type} stream #${s.index}${s.codec ? ` (${s.codec})` : ''}`;

function containerName(muxer: string, formatId: string): string {
  return getFormatDef(formatId)?.label ?? muxer;
}

/**
 * Decide what happens to every stream in the source for the given settings,
 * and collect errors (conversion cannot proceed) and warnings (it can, but
 * the user should know something is dropped or changed).
 */
export function planConversion(
  info: MediaInfo,
  s: ConversionSettings,
  caps: FfmpegCapabilities | null,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const plan: StreamPlanEntry[] = [];
  const muxer = s.muxer;
  const rule = CONTAINERS[muxer];
  const cname = containerName(muxer, s.formatId);

  if (!caps) {
    errors.push('FFmpeg is not available, so nothing can be converted.');
    return { ok: false, errors, warnings, plan };
  }
  if (!hasFormat(caps.muxers, muxer)) {
    errors.push(`This FFmpeg build cannot write the "${muxer}" format.`);
  }
  if (!rule) {
    warnings.push(
      `The app has no compatibility table for "${muxer}"; FFmpeg will report any codec it cannot store.`,
    );
  }

  const add = (
    st: MediaStream,
    action: StreamPlanEntry['action'],
    target: string | null,
    reason: string | null,
  ) =>
    plan.push({
      sourceIndex: st.index,
      type: st.type,
      sourceCodec: st.codec,
      action,
      targetCodec: target,
      reason,
    });

  // ---------- video ----------
  const videos = info.streams.filter((x) => x.type === 'video');
  let videoCount = 0;
  for (const v of videos) {
    if (v.isAttachedPic) {
      add(v, 'drop', null, 'Cover art / attached picture is not carried over.');
      warnings.push(`Cover art (${label(v)}) will not be included.`);
      continue;
    }
    if (s.video.mode === 'none') {
      add(v, 'drop', null, 'Video disabled in settings.');
      continue;
    }
    if (rule && rule.video !== '*' && rule.video.length === 0) {
      add(v, 'drop', null, `${cname} is an audio-only format.`);
      continue;
    }
    if (rule?.maxVideoStreams !== undefined && videoCount >= rule.maxVideoStreams) {
      add(v, 'drop', null, `${cname} can hold only ${rule.maxVideoStreams} video stream(s).`);
      warnings.push(`Extra ${label(v)} is dropped: ${cname} holds only one video stream.`);
      continue;
    }
    if (s.video.mode === 'copy') {
      const allowed = containerAllows(muxer, 'video', v.codec);
      if (allowed === false) {
        errors.push(
          `Cannot copy ${label(v)} into ${cname} without re-encoding. Choose a re-encoding preset or a more flexible container such as MKV.`,
        );
        add(v, 'drop', null, `${v.codec} cannot be stored in ${cname}.`);
        continue;
      }
      add(v, 'copy', 'copy', null);
      videoCount++;
      continue;
    }
    // encode
    const enc = s.video.encoder;
    if (!enc) {
      errors.push('No video encoder selected.');
      add(v, 'drop', null, 'No encoder selected.');
      continue;
    }
    if (!isEncoderUsable(caps, enc)) {
      errors.push(
        ENCODERS[enc]?.hw
          ? `Hardware encoder "${enc}" is not working on this system. Choose a software (CPU) encoder.`
          : `Video encoder "${enc}" is not available in this FFmpeg build.`,
      );
      add(v, 'drop', null, 'Encoder unavailable.');
      continue;
    }
    const codec = encoderCodec(caps, enc);
    if (containerAllows(muxer, 'video', codec) === false) {
      errors.push(`${cname} cannot contain ${codec} video (encoder ${enc}).`);
    }
    add(v, 'encode', enc, null);
    videoCount++;
  }

  if (s.video.mode === 'copy') {
    const changed: string[] = [];
    if (s.video.resolution.mode !== 'original') changed.push('resolution');
    if (s.video.frameRate.mode !== 'original') changed.push('frame rate');
    if (s.video.crop) changed.push('crop');
    if (s.video.deinterlace === 'on') changed.push('deinterlacing');
    if (typeof s.video.rotation === 'number') changed.push('rotation');
    if (changed.length) {
      warnings.push(
        `Video is being copied, so these settings have no effect: ${changed.join(', ')}.`,
      );
    }
  }

  // ---------- audio ----------
  const audios = info.streams.filter((x) => x.type === 'audio');
  let audioCount = 0;
  for (const a of audios) {
    if (s.streams.audio && !s.streams.audio.includes(a.index)) {
      add(a, 'drop', null, 'Not selected.');
      continue;
    }
    if (s.audio.mode === 'none') {
      add(a, 'drop', null, 'Audio disabled in settings.');
      continue;
    }
    if (rule && rule.audio !== '*' && rule.audio.length === 0) {
      add(a, 'drop', null, `${cname} cannot contain audio.`);
      warnings.push(`${cname} has no audio support, so ${label(a)} is dropped.`);
      continue;
    }
    if (rule?.maxAudioStreams !== undefined && audioCount >= rule.maxAudioStreams) {
      add(a, 'drop', null, `${cname} holds only ${rule.maxAudioStreams} audio stream(s).`);
      warnings.push(
        `${label(a)} is dropped: ${cname} holds only ${rule.maxAudioStreams} audio stream(s). Use MKV to keep all tracks.`,
      );
      continue;
    }
    if (s.audio.mode === 'copy') {
      const allowed = containerAllows(muxer, 'audio', a.codec);
      if (allowed === false) {
        errors.push(
          `Cannot copy ${label(a)} into ${cname}. Re-encode the audio or choose a container that supports ${a.codec}.`,
        );
        add(a, 'drop', null, `${a.codec} cannot be stored in ${cname}.`);
        continue;
      }
      add(a, 'copy', 'copy', null);
      audioCount++;
      continue;
    }
    const enc = s.audio.encoder;
    if (!enc || !isEncoderUsable(caps, enc)) {
      errors.push(
        enc
          ? `Audio encoder "${enc}" is not available in this FFmpeg build.`
          : 'No audio encoder selected.',
      );
      add(a, 'drop', null, 'Encoder unavailable.');
      continue;
    }
    const codec = encoderCodec(caps, enc);
    if (containerAllows(muxer, 'audio', codec) === false) {
      errors.push(`${cname} cannot contain ${codec} audio (encoder ${enc}).`);
    }
    const info2 = ENCODERS[enc];
    let note: string | null = null;
    const ch = s.audio.channels ?? a.channels ?? null;
    if (info2?.maxChannels && ch && ch > info2.maxChannels) {
      note = `Downmixed from ${ch} to ${info2.maxChannels === 2 ? 'stereo' : `${info2.maxChannels} channels`} (encoder limit).`;
      warnings.push(`${label(a)}: ${note}`);
    }
    const sr = s.audio.sampleRate ?? a.sampleRate ?? null;
    if (info2?.sampleRates && sr && !info2.sampleRates.includes(sr)) {
      const r = `Resampled from ${sr} Hz to 48000 Hz (encoder limit).`;
      note = note ? `${note} ${r}` : r;
    }
    add(a, 'encode', enc, note);
    audioCount++;
  }

  // ---------- subtitles ----------
  const subs = info.streams.filter((x) => x.type === 'subtitle');
  for (const sub of subs) {
    if (s.streams.subtitle && !s.streams.subtitle.includes(sub.index)) {
      add(sub, 'drop', null, 'Not selected.');
      continue;
    }
    if (s.subtitles === 'remove') {
      add(sub, 'drop', null, 'Subtitles removed in settings.');
      continue;
    }
    if (!rule) {
      add(sub, 'copy', 'copy', 'Container compatibility unknown; FFmpeg will decide.');
      continue;
    }
    const isText = !!sub.codec && TEXT_SUBTITLE_CODECS.includes(sub.codec);
    const isBitmap = !!sub.codec && BITMAP_SUBTITLE_CODECS.includes(sub.codec);
    const copyOk = containerAllows(muxer, 'subtitle', sub.codec) === true;
    const convEnc = rule.textSubtitleEncoder;
    const canConvert = isText && !!convEnc && isEncoderUsable(caps, convEnc);

    if (s.subtitles === 'convert' && canConvert) {
      add(sub, 'convert', convEnc, null);
      continue;
    }
    if ((s.subtitles === 'copy' || s.subtitles === 'auto') && copyOk) {
      add(sub, 'copy', 'copy', null);
      continue;
    }
    if (s.subtitles === 'auto' && canConvert) {
      add(sub, 'convert', convEnc, `Converted to ${convEnc} for ${cname}.`);
      continue;
    }
    const why =
      rule.subtitle.length === 0
        ? `${cname} cannot contain subtitles.`
        : isBitmap
          ? `Image-based subtitles (${sub.codec}) cannot be converted to text; use MKV to keep them.`
          : `${sub.codec ?? 'This subtitle format'} cannot be stored in ${cname}.`;
    add(sub, 'drop', null, why);
    warnings.push(`Subtitle stream #${sub.index} is dropped: ${why}`);
  }

  // ---------- other ----------
  for (const st of info.streams.filter((x) => x.type === 'data' || x.type === 'unknown')) {
    add(st, 'drop', null, 'Data/metadata streams are not carried over.');
  }
  for (const st of info.streams.filter((x) => x.type === 'attachment')) {
    if (muxer === 'matroska') add(st, 'copy', 'copy', null);
    else add(st, 'drop', null, `${cname} cannot hold attachments (e.g. fonts).`);
  }

  if (s.preserveChapters && info.chapters > 0 && rule && !rule.supportsChapters) {
    warnings.push(
      `${cname} cannot store chapters; ${info.chapters} chapter marker(s) will be lost.`,
    );
  }

  const kept = plan.filter((p) => p.action !== 'drop');
  if (
    getFormatDef(s.formatId)?.kind === 'audio' &&
    !kept.some((p) => p.type === 'audio') &&
    errors.length === 0
  ) {
    errors.push('This file has no audio to extract.');
  }
  if (kept.length === 0 && errors.length === 0) {
    errors.push('With these settings, no streams would be written to the output.');
  }

  const custom = validateCustomArgs(s.customArgs);
  errors.push(...custom.errors);

  if (s.video.mode === 'encode' && s.video.resolution.mode === 'fit') {
    const { width, height } = s.video.resolution;
    if (!(width >= 16 && height >= 16 && width <= 16384 && height <= 16384)) {
      errors.push('Custom resolution must be between 16 and 16384 pixels per side.');
    }
  }

  return { ok: errors.length === 0, errors, warnings, plan };
}
