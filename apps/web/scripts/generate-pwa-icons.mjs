#!/usr/bin/env node
// Rasterizes the Markaz app icon to PNG using only Node built-ins.
// No dependencies, no canvas, no npm installs: analytic shapes + 4x4 supersampling
// + hand-written PNG chunk/CRC32 writer.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public', 'icons');

const VIEWBOX = 64;
const SS = 4; // 4x4 supersampling
const GREEN = [0x1c, 0x5a, 0x40];
const CREAM = [0xf8, 0xf6, 0xf1];
const BRASS = [0xc9, 0xaa, 0x5c];
const WHITE = [0xff, 0xff, 0xff];

// Glyph geometry in 64-unit viewBox space.
// Corner brackets expressed as L-shaped strokes of width 6 with butt caps.
const STROKE = 6;
const H = STROKE / 2;
const BRACKETS = [
  // top-left (miter join: each arm reaches the outer corner so the corner is square, not notched)
  { x: 10 - H, y: 10 - H, w: STROKE, h: 26 - 10 + H },
  { x: 10 - H, y: 10 - H, w: 26 - 10 + H, h: STROKE },
  // top-right
  { x: 38, y: 10 - H, w: 54 - 38 + H, h: STROKE },
  { x: 54 - H, y: 10 - H, w: STROKE, h: 26 - 10 + H },
  // bottom-right
  { x: 54 - H, y: 38, w: STROKE, h: 54 - 38 + H },
  { x: 38, y: 54 - H, w: 54 - 38 + H, h: STROKE },
  // bottom-left
  { x: 10 - H, y: 54 - H, w: 26 - 10 + H, h: STROKE },
  { x: 10 - H, y: 38, w: STROKE, h: 54 - 38 + H },
];
const CENTRE = { x: 24, y: 24, w: 16, h: 16 };

function inRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// Point-in-rounded-rect (full containment, radius clamped to half the shorter side).
function inRoundedRect(px, py, w, h, radius) {
  if (px < 0 || py < 0 || px > w || py > h) return false;
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 0) return true;
  const cx = Math.min(Math.max(px, r), w - r);
  const cy = Math.min(Math.max(py, r), h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function inBrackets(px, py) {
  for (const b of BRACKETS) if (inRect(px, py, b)) return true;
  return false;
}

// Map a viewBox-space point into glyph space after scaling the glyph about (32,32).
function glyphPoint(px, py, glyphScale) {
  return [32 + (px - 32) / glyphScale, 32 + (py - 32) / glyphScale];
}

/**
 * Rasterize a 64-unit design.
 * opts: { size, tile: bool, radius, glyphScale, monochrome, bg, glyph, accent }
 */
function render(opts) {
  const { size, tile = true, radius = 0, glyphScale = 1, monochrome = false } = opts;
  const bg = opts.bg ?? GREEN;
  const glyph = monochrome ? WHITE : CREAM;
  const accent = monochrome ? WHITE : BRASS;

  const pixels = Buffer.alloc(size * size * 4);
  const unitPerPx = VIEWBOX / size;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sumA = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (px + (sx + 0.5) / SS) * unitPerPx;
          const uy = (py + (sy + 0.5) / SS) * unitPerPx;

          let cr = 0;
          let cg = 0;
          let cb = 0;
          let ca = 0; // opaque layers composited over transparent

          if (tile && inRoundedRect(ux, uy, VIEWBOX, VIEWBOX, radius)) {
            [cr, cg, cb] = bg;
            ca = 255;
          }

          const [gx, gy] = glyphPoint(ux, uy, glyphScale);
          if (inRect(gx, gy, CENTRE)) {
            [cr, cg, cb] = accent;
            ca = 255;
          } else if (inBrackets(gx, gy)) {
            [cr, cg, cb] = glyph;
            ca = 255;
          }

          // Accumulate premultiplied colour so partial coverage mixes correctly.
          sumA += ca;
          sumR += (cr * ca) / 255;
          sumG += (cg * ca) / 255;
          sumB += (cb * ca) / 255;
        }
      }

      const samples = SS * SS;
      const a = Math.round(sumA / samples);
      const i = (py * size + px) * 4;
      if (a === 0) {
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 0;
      } else {
        // Un-premultiply the accumulated averages: sumR already includes alpha.
        const scale = 255 / sumA;
        pixels[i] = Math.min(255, Math.round(sumR * scale));
        pixels[i + 1] = Math.min(255, Math.round(sumG * scale));
        pixels[i + 2] = Math.min(255, Math.round(sumB * scale));
        pixels[i + 3] = a;
      }
    }
  }

  return encodePng(size, size, pixels);
}

// ---------------------------------------------------------------------------
// PNG writing: signature + IHDR + IDAT (deflateSync) + IEND, CRC32 by hand.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline prefixed with filter byte 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const src = y * stride;
    const dst = y * (stride + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, src, src + stride);
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Output set
// ---------------------------------------------------------------------------

const outputs = [
  // Standard "any" icons: rounded green tile, 14-unit corner radius.
  { name: 'icon-192.png', png: render({ size: 192, tile: true, radius: 14 }) },
  { name: 'icon-512.png', png: render({ size: 512, tile: true, radius: 14 }) },
  // Maskable: full-bleed tile, glyph scaled to 0.72 inside the safe zone.
  { name: 'icon-maskable-512.png', png: render({ size: 512, tile: true, radius: 0, glyphScale: 0.72 }) },
  // Apple touch: full-bleed (opaque corners), brackets scaled 0.85.
  { name: 'apple-touch-icon.png', png: render({ size: 180, tile: true, radius: 0, glyphScale: 0.85 }) },
  // Monochrome notification badge: white glyph, transparent background.
  { name: 'badge-72.png', png: render({ size: 72, tile: false, monochrome: true }) },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const { name, png } of outputs) {
  writeFileSync(resolve(OUT_DIR, name), png);
  console.log(`wrote ${name} (${png.length} bytes)`);
}
