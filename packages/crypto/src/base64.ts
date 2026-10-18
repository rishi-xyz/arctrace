/**
 * Browser-safe base64 (RFC 4648). The previous implementation used Buffer,
 * which does not exist in browsers and is not polyfilled by bundlers — the
 * web app passes key material through the same helpers (decision D-024).
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = /* @__PURE__ */ (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  t["=".charCodeAt(0)] = -2;
  return t;
})();

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < n ? bytes[i + 1]! : 0;
    const b2 = i + 2 < n ? bytes[i + 2]! : 0;
    out += ALPHABET[b0 >> 2]! + ALPHABET[((b0 & 3) << 4) | (b1 >> 4)]!;
    out += i + 1 < n ? ALPHABET[((b1 & 15) << 2) | (b2 >> 6)]! : "=";
    out += i + 2 < n ? ALPHABET[b2 & 63]! : "=";
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  let clean = s.replace(/\s+/g, "");
  let end = clean.length;
  while (end > 0 && clean[end - 1] === "=") end--;
  const outLen = (end * 3) >> 2;
  const out = new Uint8Array(outLen);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < end; i++) {
    const v = LOOKUP[clean.charCodeAt(i)]!;
    if (v < 0) throw new Error("bad base64");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  if (o !== outLen) throw new Error("bad base64 length");
  return out;
}
