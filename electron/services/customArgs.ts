// Validation for user-supplied extra FFmpeg arguments (advanced mode).
//
// The arguments are passed straight to spawn() as an array, so there is no
// shell to inject into. The remaining risks are FFmpeg options that read or
// write arbitrary files, change inputs/outputs, or run filters (some filters
// can open files). We therefore only accept options from an allowlist, each
// taking exactly one value, and reject values that look like paths or URLs.

const MAX_ARGS = 40;
const MAX_LEN = 256;

// option name (without stream specifier) -> description
const ALLOWED = new Set([
  'tune',
  'profile',
  'level',
  'g',
  'keyint_min',
  'bf',
  'refs',
  'sc_threshold',
  'x264-params',
  'x265-params',
  'svtav1-params',
  'aq-mode',
  'cpu-used',
  'deadline',
  'row-mt',
  'tile-columns',
  'threads',
  'metadata',
  'movflags',
  'fps_mode',
  'aspect',
  'color_primaries',
  'color_trc',
  'colorspace',
  'color_range',
  'bufsize',
  'minrate',
  'maxrate',
  'qmin',
  'qmax',
  'tag',
  'cutoff',
  'compression_level',
  't',
  'ss',
  'to',
  'disposition',
  'frames',
  'af_cutoff',
  'lag-in-frames',
  'arnr-maxframes',
  'arnr-strength',
  'crf',
  'qp',
  'b',
  'q',
  'preset',
  'pix_fmt',
  'vbr',
  'application',
  'frame_duration',
]);

// Options that must never appear even though a prefix might look harmless.
const FORBIDDEN_HINT =
  /^(i|y|n|f|map.*|filter.*|vf|af|lavfi|progress|report|dump.*|attach|stats|vstats.*|passlogfile|pass|sdp_file|init_hw_device|filter_complex.*|filter_script.*|hwaccel.*|vaapi_device|codec.*|c|vcodec|acodec|scodec|loglevel|v|nostdin|benchmark.*|timelimit|hide_banner)$/;

export interface CustomArgsResult {
  ok: boolean;
  errors: string[];
}

function optionName(token: string): string {
  // "-profile:v:0" -> "profile"
  return token.replace(/^-/, '').split(':')[0];
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

export function validateCustomArgs(args: unknown): CustomArgsResult {
  const errors: string[] = [];
  if (args === undefined || args === null) return { ok: true, errors };
  if (!Array.isArray(args)) return { ok: false, errors: ['Custom arguments must be a list.'] };
  if (args.length > MAX_ARGS) errors.push(`At most ${MAX_ARGS} custom arguments are allowed.`);

  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (typeof tok !== 'string' || tok.length === 0 || tok.length > MAX_LEN) {
      errors.push(`Custom argument ${i + 1} is empty or too long.`);
      continue;
    }
    if (/[\0\r\n]/.test(tok)) {
      errors.push(`Custom argument ${i + 1} contains control characters.`);
      continue;
    }
    if (!tok.startsWith('-') || NUMERIC.test(tok)) {
      errors.push(`"${tok}" is not an option. Custom arguments must be "-option value" pairs.`);
      continue;
    }
    if (!/^-[a-zA-Z0-9_-]+(:[a-zA-Z0-9_:]+)?$/.test(tok)) {
      errors.push(`"${tok}" is not a valid option name.`);
      continue;
    }
    const name = optionName(tok);
    if (FORBIDDEN_HINT.test(name)) {
      errors.push(`"${tok}" is managed by the app and cannot be overridden.`);
      i++;
      continue;
    }
    if (!ALLOWED.has(name)) {
      errors.push(`"${tok}" is not in the list of supported custom options.`);
      i++;
      continue;
    }
    const value = args[i + 1];
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`"${tok}" needs a value.`);
      continue;
    }
    if (value.startsWith('-') && !NUMERIC.test(value)) {
      errors.push(`"${tok}" needs a value, but got "${value}".`);
      continue;
    }
    if (/[/\\]/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes('..')) {
      errors.push(`The value for "${tok}" looks like a path or URL, which is not allowed.`);
    }
    if (value.length > MAX_LEN || /[\0\r\n]/.test(value)) {
      errors.push(`The value for "${tok}" is too long or contains control characters.`);
    }
    i++; // skip value
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Split a text box into argument tokens, honouring simple single/double
 * quotes. This is NOT shell parsing: no expansion, escapes or substitution.
 */
export function tokenizeArgs(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}
