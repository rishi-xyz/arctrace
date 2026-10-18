/**
 * Deterministic keyed PRNG (SHA-256 counter mode). Not a CSPRNG: it only
 * needs to be unpredictable without K_wm and reproducible with it.
 */
import { sha256 } from "@noble/hashes/sha2.js";

function le32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** 32-bit value at counter index i. */
export function prngU32(key: Uint8Array, label: number, i: number): number {
  const h = sha256(concat(concat(key, le32(label)), le32(i)));
  return new DataView(h.buffer, h.byteOffset).getUint32(0, true);
}
