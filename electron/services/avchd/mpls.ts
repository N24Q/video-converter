// Parser for Blu-ray/AVCHD movie playlists (.MPLS on BDMV discs, .MPL on
// AVCHD camcorder media). Only the PlayList section is read: the ordered
// list of clips with their in/out times and connection conditions.
//
// Layout (all big-endian):
//   0  "MPLS"                type indicator
//   4  "0100"|"0200"|"0300"  version
//   8  u32 PlayList start address
//   at PlayList start:
//     u32 length, u16 reserved, u16 number_of_PlayItems, u16 number_of_SubPaths
//     PlayItem[]: u16 length, char[5] clip name, char[4] codec id ("M2TS"),
//                 u16 (11 reserved bits, 1 multi-angle bit, 4 bit connection_condition),
//                 u8 ref_to_STC_id, u32 IN_time, u32 OUT_time   (45 kHz ticks)

export interface PlayItem {
  clipName: string; // e.g. "00001"
  codecId: string;
  connectionCondition: number; // 1 = not seamless, 5/6 = seamless continuation
  inTime: number; // seconds
  outTime: number; // seconds
}

export interface Playlist {
  version: string;
  items: PlayItem[];
}

const TICKS = 45_000;

export class PlaylistParseError extends Error {}

export function parseMpls(buf: Buffer): Playlist {
  if (buf.length < 20) throw new PlaylistParseError('File too small to be a playlist');
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'MPLS') throw new PlaylistParseError(`Not a playlist (magic "${magic}")`);
  const version = buf.toString('ascii', 4, 8);
  const start = buf.readUInt32BE(8);
  if (start + 10 > buf.length) throw new PlaylistParseError('PlayList section is outside the file');

  const count = buf.readUInt16BE(start + 6);
  if (count > 2000) throw new PlaylistParseError('Unreasonable number of play items');
  let pos = start + 10;
  const items: PlayItem[] = [];
  for (let i = 0; i < count; i++) {
    if (pos + 2 > buf.length) throw new PlaylistParseError('Truncated play item');
    const len = buf.readUInt16BE(pos);
    const body = pos + 2;
    if (len < 20 || body + len > buf.length) throw new PlaylistParseError('Truncated play item');
    const clipName = buf.toString('ascii', body, body + 5);
    const codecId = buf.toString('ascii', body + 5, body + 9);
    const flags = buf.readUInt16BE(body + 9);
    const connectionCondition = flags & 0x0f;
    const inTicks = buf.readUInt32BE(body + 12);
    const outTicks = buf.readUInt32BE(body + 16);
    if (!/^\d{5}$/.test(clipName)) throw new PlaylistParseError(`Invalid clip name "${clipName}"`);
    items.push({
      clipName,
      codecId,
      connectionCondition,
      inTime: inTicks / TICKS,
      outTime: outTicks / TICKS,
    });
    pos = body + len;
  }
  return { version, items };
}

/** CLPI/CPI clip information files start with "HDMV". */
export function isClipInfo(buf: Buffer): boolean {
  return buf.length >= 8 && buf.toString('ascii', 0, 4) === 'HDMV';
}

/** Build an MPLS buffer (used by tests to create synthetic AVCHD structures). */
export function buildMpls(
  items: { clip: string; cc?: number; inSec?: number; outSec?: number }[],
): Buffer {
  const header = Buffer.alloc(40);
  header.write('MPLS', 0, 'ascii');
  header.write('0100', 4, 'ascii');
  const plStart = 40;
  header.writeUInt32BE(plStart, 8);
  const itemBufs = items.map((it) => {
    const b = Buffer.alloc(2 + 20);
    b.writeUInt16BE(20, 0);
    b.write(it.clip.padStart(5, '0').slice(0, 5), 2, 'ascii');
    b.write('M2TS', 7, 'ascii');
    b.writeUInt16BE((it.cc ?? 1) & 0x0f, 11);
    b.writeUInt8(0, 13);
    b.writeUInt32BE(Math.round((it.inSec ?? 0) * TICKS), 14);
    b.writeUInt32BE(Math.round((it.outSec ?? 10) * TICKS), 18);
    return b;
  });
  const plHead = Buffer.alloc(10);
  const body = Buffer.concat(itemBufs);
  plHead.writeUInt32BE(6 + body.length, 0);
  plHead.writeUInt16BE(items.length, 6);
  plHead.writeUInt16BE(0, 8);
  return Buffer.concat([header, plHead, body]);
}
