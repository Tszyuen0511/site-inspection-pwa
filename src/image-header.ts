/**
 * Pixel size from the file header, so an oversized image is refused before the
 * browser tries to decode it (which can crash a phone tab). Undefined if unknown.
 */
export function headerSize(b: Uint8Array, type: string) {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (type === "image/png" && b.length >= 24)
    return {
      w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0,
      h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0,
    };
  if (type === "image/jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { w: u16be(i + 7), h: u16be(i + 5) };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      i += 2 + u16be(i + 2);
    }
    return undefined;
  }
  if (type === "image/webp" && b.length >= 30) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8X") return { w: 1 + u24le(24), h: 1 + u24le(27) };
    if (chunk === "VP8 ")
      return {
        w: (b[26] | (b[27] << 8)) & 0x3fff,
        h: (b[28] | (b[29] << 8)) & 0x3fff,
      };
    if (chunk === "VP8L")
      return {
        w: 1 + (((b[22] & 0x3f) << 8) | b[21]),
        h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
      };
  }
  return undefined;
}
