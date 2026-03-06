/**
 * Generate a UUID v7 as a 32-char lowercase hex string.
 * Uses Web Crypto API (available in Bun) — zero external deps.
 *
 * UUID v7 layout (128 bits):
 *   48-bit ms timestamp | 4-bit version (0x7) | 12 random bits | 2-bit variant (0b10) | 62 random bits
 *
 * Sub-millisecond monotonicity: when multiple IDs are generated in the same
 * millisecond, the 12-bit rand_a field is incremented to preserve sort order.
 */

let lastTimestamp = 0;
let seq = 0;

export function uuidv7Hex(): string {
  const now = Date.now();

  if (now === lastTimestamp) {
    seq++;
  } else {
    lastTimestamp = now;
    seq = Math.floor(Math.random() * 0x100); // random start within the 12-bit space
  }

  // 16 bytes of randomness for the lower bits
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Bytes 0-5: 48-bit timestamp (big-endian)
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Byte 6-7: version nibble 0x7 + 12-bit sequence (rand_a)
  const seqClamped = seq & 0xfff;
  bytes[6] = 0x70 | ((seqClamped >> 8) & 0x0f);
  bytes[7] = seqClamped & 0xff;

  // Byte 8: variant 0b10 in high 2 bits, keep low 6 random
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  // Convert to 32-char hex string
  let hex = "";
  for (let i = 0; i < 16; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
