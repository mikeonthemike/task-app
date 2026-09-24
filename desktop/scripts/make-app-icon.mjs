// Draws the app icon (white checkbox and tick on a blue rounded square, on the macOS icon grid)
// and packs it into resources/icon.icns with iconutil. Run: node scripts/make-app-icon.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZE = 1024;

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    let c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Signed distance to a rounded square centred at (cx, cy). Negative inside. */
function roundedSquare(x, y, cx, cy, half, r) {
  const qx = Math.abs(x - cx) - (half - r);
  const qy = Math.abs(y - cy) - (half - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Coverage from a signed distance, antialiased over about one pixel.
const cover = (d) => Math.max(0, Math.min(1, 0.5 - d * SIZE));

function pixel(x, y) {
  // Big Sur icon grid: an 824px tile inset 100px, corner radius ~185px.
  const tile = cover(roundedSquare(x, y, 0.5, 0.5, 412 / 1024, 185 / 1024));
  if (!tile) return [0, 0, 0, 0];
  // Top-to-bottom blue gradient.
  const t = (y - 0.1) / 0.8;
  let r = 64 + (18 - 64) * t, g = 148 + (96 - 148) * t, b = 255 + (220 - 255) * t;
  const stroke = 0.055;
  const box = cover(Math.abs(roundedSquare(x, y, 0.5, 0.5, 0.2, 0.06)) - stroke / 2);
  const tick = cover(
    Math.min(distToSegment(x, y, 0.4, 0.5, 0.47, 0.575), distToSegment(x, y, 0.47, 0.575, 0.61, 0.425)) - stroke / 2,
  );
  const white = Math.max(box, tick);
  r += (255 - r) * white;
  g += (255 - g) * white;
  b += (255 - b) * white;
  return [r, g, b, tile * 255];
}

const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE * 4);
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b, a] = pixel((x + 0.5) / SIZE, (y + 0.5) / SIZE);
    row.set([r, g, b, a].map(Math.round), 1 + x * 4);
  }
  rows.push(row);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(Buffer.concat(rows))),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = new URL("../resources/", import.meta.url).pathname;
const master = `${out}icon.png`;
writeFileSync(master, png);
const set = `${out}icon.iconset`;
rmSync(set, { recursive: true, force: true });
mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  for (const [scale, suffix] of [[1, ""], [2, "@2x"]]) {
    execFileSync("sips", ["-z", String(s * scale), String(s * scale), master, "--out", `${set}/icon_${s}x${s}${suffix}.png`], { stdio: "ignore" });
  }
}
execFileSync("iconutil", ["-c", "icns", set, "-o", `${out}icon.icns`]);
rmSync(set, { recursive: true });
console.log("Wrote resources/icon.png and resources/icon.icns");
