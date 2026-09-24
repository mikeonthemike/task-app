// Draws the menu-bar template icon (a rounded checkbox with a tick) as black-on-transparent
// PNGs at 1x and 2x, so no image editor is needed. Run: node scripts/make-tray-icon.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
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

function png(size, alphaAt) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      // 4x4 supersampling for antialiasing
      let a = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) a += alphaAt((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size);
      row[1 + x * 4 + 3] = Math.round((a / 16) * 255);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Coordinates in 0..1 of the icon box.
function alphaAt(x, y) {
  const stroke = 0.085;
  // Rounded square outline, inset from the edges.
  const half = 0.36, r = 0.12, cx = 0.5, cy = 0.5;
  const qx = Math.abs(x - cx) - (half - r), qy = Math.abs(y - cy) - (half - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  if (Math.abs(outside) < stroke / 2) return 1;
  // Tick.
  const d = Math.min(distToSegment(x, y, 0.32, 0.5, 0.45, 0.63), distToSegment(x, y, 0.45, 0.63, 0.7, 0.37));
  return d < stroke / 2 ? 1 : 0;
}

writeFileSync(new URL("../resources/trayTemplate.png", import.meta.url), png(18, alphaAt));
writeFileSync(new URL("../resources/trayTemplate@2x.png", import.meta.url), png(36, alphaAt));
console.log("Wrote resources/trayTemplate.png and trayTemplate@2x.png");
