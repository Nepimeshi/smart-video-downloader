// scripts/generate-icons.mjs - Generates crisp anti-aliased 16, 32, 48, 128 PNG icons
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
}

function inRoundedRect(x, y, rx, ry, rw, rh, r) {
  const cx = Math.max(rx + r, Math.min(x, rx + rw - r));
  const cy = Math.max(ry + r, Math.min(y, ry + rh - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const v0x = cx - ax, v0y = cy - ay;
  const v1x = bx - ax, v1y = by - ay;
  const v2x = px - ax, v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const inv = 1 / (dot00 * dot11 - dot01 * dot01);
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function sampleColor(u, v) {
  // Coordinates in 0..128 virtual space
  const x = u * 128;
  const y = v * 128;

  if (!inRoundedRect(x, y, 8, 8, 112, 112, 26)) {
    return [0, 0, 0, 0];
  }

  // Outer cyan-blue gradient border
  const t = (u + v) * 0.5;
  let r = Math.round(14 + (37 - 14) * t);
  let g = Math.round(165 + (99 - 165) * t);
  let b = Math.round(233 + (235 - 233) * t);
  let a = 255;

  // Inner dark slate container
  if (inRoundedRect(x, y, 16, 16, 96, 96, 20)) {
    r = 11; g = 17; b = 32;
  }

  // White Play Triangle
  if (inTriangle(x, y, 36, 30, 36, 78, 78, 54)) {
    return [255, 255, 255, 255];
  }

  // Cyan Download Arrow (shaft + head)
  if (inRoundedRect(x, y, 80, 54, 12, 28, 4) || inTriangle(x, y, 68, 76, 104, 76, 86, 98)) {
    return [34, 211, 238, 255];
  }

  // White Base Tray Bar
  if (inRoundedRect(x, y, 36, 96, 56, 8, 4)) {
    return [240, 249, 255, 255];
  }

  return [r, g, b, a];
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const ss = 4; // 4x4 supersampling for crisp anti-aliasing
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          const [r, g, b, a] = sampleColor(u, v);
          sr += r * a;
          sg += g * a;
          sb += b * a;
          sa += a;
        }
      }
      const idx = (y * size + x) * 4;
      const avgA = sa / (ss * ss);
      if (avgA > 0) {
        rgba[idx] = Math.round(sr / sa);
        rgba[idx + 1] = Math.round(sg / sa);
        rgba[idx + 2] = Math.round(sb / sa);
        rgba[idx + 3] = Math.round(avgA);
      }
    }
  }
  return encodePNG(size, size, rgba);
}

const outDir = path.resolve("C:/Users/mis/.gemini/antigravity/scratch/auto-video-downloader/assets/icons");
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = renderIcon(size);
  const outPath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${png.length} bytes)`);
}
