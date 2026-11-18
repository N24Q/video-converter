import type { ErrorKind, JobError } from '../../shared/types';

export class JobFailure extends Error {
  constructor(
    public readonly kind: ErrorKind,
    message: string,
    public readonly details: string | null = null,
  ) {
    super(message);
  }

  toJobError(): JobError {
    return { kind: this.kind, message: this.message, details: this.details };
  }
}

const RULES: { test: RegExp; kind: ErrorKind; message: string }[] = [
  {
    test: /No space left on device|ENOSPC/i,
    kind: 'disk-full',
    message: 'The output drive ran out of space.',
  },
  {
    test: /Permission denied|EACCES|EPERM|Read-only file system/i,
    kind: 'permission-denied',
    message:
      'Permission denied: the output folder is not writable, or a source file cannot be read.',
  },
  {
    test: /No such file or directory/i,
    kind: 'unreadable-source',
    message:
      'A source file could not be found. It may have been moved, renamed or its drive disconnected.',
  },
  {
    test: /Invalid data found when processing input|moov atom not found|Error while decoding|corrupt/i,
    kind: 'unsupported-input',
    message: 'The source file could not be decoded. It may be damaged or use an unsupported codec.',
  },
  {
    test: /Could not find tag for codec|codec not currently supported in container|not supported in this container|Unsupported codec .* for (output )?stream|incompatible with/i,
    kind: 'unsupported-combination',
    message:
      'The chosen container cannot hold one of the selected codecs. Try MKV or a different encoder.',
  },
  {
    test: /Unknown encoder|Encoder .* not found/i,
    kind: 'unsupported-combination',
    message: 'The selected encoder is not available in this FFmpeg build.',
  },
  {
    test: /vaapi|hwupload|Device creation failed|Failed to (initialise|initialize|create) .*(device|surface)|nvenc|CUDA|No capable devices found|OpenEncodeSessionEx failed/i,
    kind: 'hw-encoder-failed',
    message: 'The hardware encoder failed. Retry using the software (CPU) encoder.',
  },
];

/** Map an FFmpeg failure to an understandable message, keeping technical details. */
export function classifyFfmpegFailure(
  stderr: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  ctx: { hwEncoder: boolean },
): JobError {
  const details = stderr.trim() ? stderr.trim().split('\n').slice(-40).join('\n') : null;
  if (
    ctx.hwEncoder &&
    /vaapi|hwupload|Device|nvenc|cuda|surface|hw_frames|VA-API|libva/i.test(stderr)
  ) {
    return {
      kind: 'hw-encoder-failed',
      message: 'The hardware encoder failed. Retry using the software (CPU) encoder.',
      details,
    };
  }
  for (const r of RULES) {
    if (r.test.test(stderr)) {
      if (r.kind === 'hw-encoder-failed' && !ctx.hwEncoder) continue;
      return { kind: r.kind, message: r.message, details };
    }
  }
  if (signal) {
    return {
      kind: 'unexpected-termination',
      message: `FFmpeg was terminated unexpectedly (${signal}). The system may have run out of memory.`,
      details,
    };
  }
  return {
    kind: 'unknown',
    message: `FFmpeg failed (exit code ${code ?? 'unknown'}). See details for the FFmpeg log.`,
    details,
  };
}
