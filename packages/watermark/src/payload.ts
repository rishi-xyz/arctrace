/**
 * Watermark payload: wmCode (64 bits) || CRC16-CCITT(wmCode) (16 bits) = 80 bits.
 * spec.md section 5.1.
 */

export const PAYLOAD_BITS = 80;
export const WM_CODE_BITS = 64;

/** CRC16-CCITT (poly 0x1021, init 0xFFFF). */
export function crc16Ccitt(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function hexToBytesChecked(hex: string, bytes: number): Uint8Array {
  if (hex.length !== bytes * 2 || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error(`expected ${bytes} bytes of lowercase hex`);
  }
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** wmCode hex (8 bytes) -> 80 bits (0/1), MSB first. */
export function buildPayload80(wmCodeHex: string): Uint8Array {
  const code = hexToBytesChecked(wmCodeHex, 8);
  const crc = crc16Ccitt(code);
  const bits = new Uint8Array(PAYLOAD_BITS);
  let i = 0;
  for (const b of code) for (let k = 7; k >= 0; k--) bits[i++] = (b >> k) & 1;
  for (let k = 15; k >= 0; k--) bits[i++] = (crc >> k) & 1;
  return bits;
}

/** 80 bits -> wmCode hex, or null if the CRC fails. */
export function decodePayload80(bits: Uint8Array): string | null {
  if (bits.length !== PAYLOAD_BITS) return null;
  const code = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i * 8 + k]!;
    code[i] = b;
  }
  let crc = 0;
  for (let k = 0; k < 16; k++) crc = (crc << 1) | bits[64 + k]!;
  if (crc !== crc16Ccitt(code)) return null;
  return Array.from(code, (b) => b.toString(16).padStart(2, "0")).join("");
}
