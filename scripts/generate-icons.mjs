// Generates the PNG app icons with no dependencies (pure Node + zlib).
// Geometry matches icons/icon.svg. Run:  npm run icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(outDir, { recursive: true });

const BG = [0x17, 0x17, 0x1c];
const WHITE = [0xf4, 0xf4, 0xf6];
const CYAN = [0x4c, 0xc9, 0xf0];

// Geometry in a 1024 grid.
const rects = [];
for (const [cx, cy] of [[205, 205], [634, 205], [205, 763], [634, 763]]) {
  // each corner bracket = one horizontal + one vertical bar
  const right = cx > 512;
  const bottom = cy > 512;
  rects.push([cx, cy, 185, 56]);
  rects.push([right ? cx + 185 - 56 : cx, bottom ? cy + 56 - 185 : cy, 56, 185]);
}

function colorAt(x, y) {
  // x, y in 1024-grid units
  for (const [rx, ry, rw, rh] of rects) {
    if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) return WHITE;
  }
  const d = Math.hypot(x - 512, y - 512);
  if (d <= 41) return CYAN;
  if (Math.abs(d - 174) <= 25.5) return CYAN;
  return BG;
}

function render(size, scale = 1) {
  const SS = 3; // supersampling for smooth edges
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0; // PNG filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // map pixel back to the 1024 grid, shrinking content by `scale` about the centre
          const gx = ((px + (sx + 0.5) / SS) / size) * 1024;
          const gy = ((py + (sy + 0.5) / SS) / size) * 1024;
          const c = colorAt(512 + (gx - 512) / scale, 512 + (gy - 512) / scale);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS;
      const o = py * (size * 3 + 1) + 1 + px * 3;
      raw[o] = Math.round(r / n); raw[o + 1] = Math.round(g / n); raw[o + 2] = Math.round(b / n);
    }
  }
  return png(size, size, raw);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB, no alpha (iOS dislikes transparent touch icons)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = {
  'apple-touch-icon.png': render(180),
  'icon-192.png': render(192),
  'icon-512.png': render(512),
  'icon-maskable-512.png': render(512, 0.8), // content inside the 80% safe zone
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(outDir, name), data);
  console.log('wrote icons/' + name, data.length, 'bytes');
}
