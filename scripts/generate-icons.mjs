import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    len = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function make(size, maskable = false) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = y * (size * 4 + 1) + 1 + x * 4;
    pixels.set(c, i);
  };
  const scale = size / 64;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = maskable ? 0 : 13 * scale;
      const dx = Math.max(r - x, 0, x - (size - r - 1)),
        dy = Math.max(r - y, 0, y - (size - r - 1));
      put(x, y, [23, 33, 43, dx * dx + dy * dy > r * r ? 0 : 255]);
    }
  const line = (x1, y1, x2, y2) => {
    x1 *= scale;
    y1 *= scale;
    x2 *= scale;
    y2 *= scale;
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    for (let i = 0; i <= steps; i++) {
      const x = x1 + ((x2 - x1) * i) / steps,
        y = y1 + ((y2 - y1) * i) / steps;
      for (let j = -1.6 * scale; j <= 1.6 * scale; j++)
        for (let k = -1.6 * scale; k <= 1.6 * scale; k++)
          if (j * j + k * k < 2.56 * scale * scale)
            put(Math.round(x + j), Math.round(y + k), [255, 255, 255, 255]);
    }
  };
  [
    [17, 46, 17, 24],
    [17, 24, 32, 15],
    [32, 15, 47, 24],
    [47, 24, 47, 46],
    [14, 46, 50, 46],
    [25, 46, 25, 29],
    [25, 29, 32, 25],
    [32, 25, 39, 29],
    [39, 29, 39, 46],
    [25, 35, 30, 40],
    [30, 40, 40, 29],
  ].forEach((p) => line(...p));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512])
  writeFileSync(`public/icons/icon-${size}.png`, make(size));
writeFileSync("public/icons/maskable-512.png", make(512, true));
writeFileSync("public/icons/apple-touch-icon.png", make(180));
