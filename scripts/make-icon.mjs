// Generates assets/icon.png (512x512): a rounded blue square with a white
// play triangle and a circular "convert" arrow. Pure Node, no dependencies.
import fs from 'node:fs';
import zlib from 'node:zlib';

const S = 512;
const px = Buffer.alloc(S * S * 4);

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
  const i = (y * S + x) * 4;
  const ia = px[i + 3] / 255;
  const oa = a + ia * (1 - a);
  for (const [k, c] of [
    [0, r],
    [1, g],
    [2, b],
  ]) {
    px[i + k] = Math.round((c * a + px[i + k] * ia * (1 - a)) / (oa || 1));
  }
  px[i + 3] = Math.round(oa * 255);
}

// 4x4 supersampled shape fill
function fill(inside, r, g, b) {
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let n = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) n++;
      if (n) blend(x, y, r, g, b, n / 16);
    }
}

const rr = (x, y) => {
  const m = 40,
    rad = 96;
  const cx = Math.min(Math.max(x, m + rad), S - m - rad);
  const cy = Math.min(Math.max(y, m + rad), S - m - rad);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad && x >= m && x <= S - m && y >= m && y <= S - m;
};
fill(rr, 31, 111, 235);

const tri = (x, y) => {
  const ax = 210,
    ay = 170,
    bx = 210,
    by = 342,
    cx = 350,
    cy = 256;
  const d = (px1, py1, px2, py2, px3, py3) => (px1 - px3) * (py2 - py3) - (px2 - px3) * (py1 - py3);
  const d1 = d(x, y, ax, ay, bx, by),
    d2 = d(x, y, bx, by, cx, cy),
    d3 = d(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
fill(tri, 255, 255, 255);

const ring = (x, y) => {
  const dx = x - 256,
    dy = y - 256,
    r = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  return (
    r >= 150 &&
    r <= 172 &&
    !(ang > -0.35 && ang < 0.35) &&
    !(ang > Math.PI - 0.35 || ang < -Math.PI + 0.35)
  );
};
fill(ring, 255, 255, 255);
const head = (x, y, tx, ty, dir) => {
  const lx = x - tx,
    ly = (y - ty) * dir;
  return ly >= 0 && ly <= 46 && Math.abs(lx) <= 34 * (1 - ly / 46);
};
fill((x, y) => head(x, y, 417, 236, 1) || head(x, y, 95, 276, -1), 255, 255, 255);

function png(w, h, rgba) {
  const crc = (buf) => {
    let c,
      crcVal = ~0;
    for (const byte of buf) {
      c = (crcVal ^ byte) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcVal = (crcVal >>> 8) ^ c;
    }
    return ~crcVal >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync('assets/icon.png', png(S, S, px));
console.log('wrote assets/icon.png');
