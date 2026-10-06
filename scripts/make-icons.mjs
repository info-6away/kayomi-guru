// Draws Koyomi's icons: the vermilion dot on warm paper.
// Run with `npm run icons`. No dependencies; the files it writes are committed.
// Next picks up app/favicon.ico, app/icon.svg and app/apple-icon.png by name; the manifest lists public/icons.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const PAPER = [0xf5, 0xf1, 0xe8];
const VERMILION = [0xc4, 0x58, 0x45];
const SAMPLES = 4; // per axis, for smooth edges

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 4);
  return out;
}

/**
 * @param size   width and height in pixels
 * @param corner corner radius of the paper tile as a fraction of the size (0 = full bleed)
 * @param dot    dot diameter as a fraction of the size
 */
function icon(size, corner, dot) {
  const r = corner * size;
  const dotR = (dot * size) / 2;
  const inTile = (x, y) => {
    const dx = Math.max(r - x, x - (size - r), 0);
    const dy = Math.max(r - y, y - (size - r), 0);
    return dx * dx + dy * dy <= r * r;
  };
  const inDot = (x, y) => (x - size / 2) ** 2 + (y - size / 2) ** 2 <= dotR * dotR;

  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      let tile = 0;
      let red = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;
          if (!inTile(px, py)) continue;
          tile++;
          if (inDot(px, py)) red++;
        }
      }
      const i = row + 1 + x * 4;
      const mix = tile ? red / tile : 0;
      for (let c = 0; c < 3; c++) rows[i + c] = Math.round(PAPER[c] + (VERMILION[c] - PAPER[c]) * mix);
      rows[i + 3] = Math.round((tile / SAMPLES ** 2) * 255);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A .ico file holding one PNG, which every current browser reads. */
function ico(size, png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header.set([size, size], 6);
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // where the PNG starts
  return Buffer.concat([header, png]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', icon(192, 0.22, 0.36));
writeFileSync('public/icons/icon-512.png', icon(512, 0.22, 0.36));
// Launchers crop maskable icons to their own shape, so the paper fills the square and the dot stays well inside.
writeFileSync('public/icons/icon-maskable-512.png', icon(512, 0, 0.3));
writeFileSync('app/apple-icon.png', icon(180, 0, 0.34));
writeFileSync('app/favicon.ico', ico(48, icon(48, 0.22, 0.38)));
console.log('Wrote 3 icons to public/icons, plus app/apple-icon.png and app/favicon.ico');
