/**
 * L1 text-layer watermark: zero-width characters (U+200B / U+200C) inserted
 * at pseudo-random word boundaries. FRAGILE: stripped by normalization and by
 * most editors. Used for TXT and clipboard text (spec.md section 5.3).
 */
import { prngU32 } from "./prng.js";
import { buildPayload80, decodePayload80, PAYLOAD_BITS } from "./payload.js";

const ZWSP = "​";
const ZWNJ = "‌";

export function embedText(text: string, wmCodeHex: string, keyWm: Uint8Array): string {
  const bits = buildPayload80(wmCodeHex);
  const words = text.split(/(\s+)/); // keep separators
  const boundaries = words.map((_, i) => i).filter((i) => i % 2 === 1); // between tokens
  if (boundaries.length === 0) return text;
  // All 80 bits go at one PRNG-chosen boundary, in bit order. Earlier drafts
  // spread bits across boundaries, but short texts do not have 80 boundaries
  // and the chunking dropped bits (decision D-012).
  const at = boundaries[prngU32(keyWm, 3, 0) % boundaries.length]!;
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    out.push(words[i]!);
    if (i === at) {
      for (const b of bits) out.push(b === 1 ? ZWSP : ZWNJ);
    }
  }
  return out.join("");
}

export function extractText(text: string): { wmCode?: string; ok: boolean } {
  const bits: number[] = [];
  for (const ch of text) {
    if (ch === ZWSP) bits.push(1);
    else if (ch === ZWNJ) bits.push(0);
  }
  if (bits.length < PAYLOAD_BITS) return { ok: false };
  const wmCode = decodePayload80(Uint8Array.from(bits.slice(0, PAYLOAD_BITS)));
  return wmCode ? { ok: true, wmCode } : { ok: false };
}

export const ZERO_WIDTH = { ZWSP, ZWNJ } as const;
