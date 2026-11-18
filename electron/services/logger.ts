import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 1024 * 1024;
const KEEP = 3;

/** Small rotating file logger (app.log, app.1.log, app.2.log). */
export class Logger {
  readonly file: string;
  private size = 0;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'app.log');
    try {
      this.size = fs.statSync(this.file).size;
    } catch {
      this.size = 0;
    }
  }

  info(msg: string) {
    this.write('INFO', msg);
  }
  warn(msg: string) {
    this.write('WARN', msg);
  }
  error(msg: string) {
    this.write('ERROR', msg);
  }

  private write(level: string, msg: string) {
    const line = `${new Date().toISOString()} ${level} ${msg.replace(/\s+$/, '').slice(0, 8000)}\n`;
    try {
      if (this.size + line.length > MAX_BYTES) this.rotate();
      fs.appendFileSync(this.file, line, { mode: 0o600 });
      this.size += Buffer.byteLength(line);
    } catch {
      /* logging must never crash the app */
    }
  }

  private rotate() {
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = i === 1 ? this.file : path.join(path.dirname(this.file), `app.${i - 1}.log`);
      const to = path.join(path.dirname(this.file), `app.${i}.log`);
      try {
        fs.renameSync(from, to);
      } catch {
        /* missing is fine */
      }
    }
    this.size = 0;
  }
}
