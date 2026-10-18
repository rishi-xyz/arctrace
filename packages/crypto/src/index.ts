/**
 * ArcTrace crypto primitives (spec.md section 2).
 *
 * Verified against the installed library versions on 2026-10-18:
 *   - @noble/post-quantum 0.7.1: subpath imports `./ml-kem.js` and `./ml-dsa.js`.
 *     ml_dsa65.sign(msg, secretKey) -> sig   (argument order: message FIRST)
 *     ml_dsa65.verify(sig, msg, publicKey) -> boolean (sig FIRST)
 *     ml_kem768.encapsulate(publicKey) -> { cipherText, sharedSecret }
 *     ml_kem768.decapsulate(cipherText, secretKey) -> sharedSecret
 *   - @noble/ciphers 2.4.0: gcm(key, nonce, AAD).encrypt/decrypt
 *   - @noble/hashes 2.4.0: hkdf(sha256, ikm, salt, info, length)
 *   - canonicalize 5.1.0: RFC 8785 JCS
 * Measured sizes: ML-KEM-768 pk=1184 sk=2400 ct=1088 ss=32;
 *   ML-DSA-65 pk=1952 sk=4032 sig=3309.
 */
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/hashes/utils.js";
import jcsCanonicalize from "canonicalize";

export { toBase64, fromBase64 } from "./base64.js";
export * from "./kdf.js";

// ---------------------------------------------------------------------------
// Measured sizes (constants file per spec.md section 2.2 note)
// ---------------------------------------------------------------------------

export const SIZE = {
  kemPk: 1184,
  kemSk: 2400,
  kemCt: 1088,
  kemSs: 32,
  dsaPk: 1952,
  dsaSk: 4032,
  dsaSig: 3309,
  sha256: 32,
  aesKey: 32,
  gcmNonce: 12,
  gcmTag: 16,
} as const;

export interface KemKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}
export interface SigKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// PQC
// ---------------------------------------------------------------------------

export function generateKemKeyPair(): KemKeyPair {
  return ml_kem768.keygen();
}

export function generateSigKeyPair(): SigKeyPair {
  return ml_dsa65.keygen();
}

export function kemEncapsulate(pk: Uint8Array): {
  cipherText: Uint8Array;
  sharedSecret: Uint8Array;
} {
  return ml_kem768.encapsulate(pk);
}

export function kemDecapsulate(ct: Uint8Array, sk: Uint8Array): Uint8Array {
  return ml_kem768.decapsulate(ct, sk);
}

function domainSeparate(domain: string, message: Uint8Array): Uint8Array {
  const d = enc.encode(domain);
  const out = new Uint8Array(d.length + 1 + message.length);
  out.set(d, 0);
  out[d.length] = 0;
  out.set(message, d.length + 1);
  return out;
}

/**
 * ML-DSA-65 sign over `domain || 0x00 || message`.
 *
 * `extraEntropy: false` selects FIPS 204 deterministic signing: noble 0.7.1
 * defaults to hedged (randomized) signing, which produces a different valid
 * signature on every call and broke signature determinism (decision D-011).
 */
export function sign(domain: string, message: Uint8Array, sk: Uint8Array): Uint8Array {
  return ml_dsa65.sign(domainSeparate(domain, message), sk, { extraEntropy: false });
}

/** Returns false on any failure; never throws on a bad signature. */
export function verify(
  domain: string,
  message: Uint8Array,
  sig: Uint8Array,
  pk: Uint8Array,
): boolean {
  try {
    return ml_dsa65.verify(sig, domainSeparate(domain, message), pk);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Symmetric
// ---------------------------------------------------------------------------

export function aesGcmEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): { nonce: Uint8Array; ct: Uint8Array } {
  if (key.length !== SIZE.aesKey) throw new Error("aes key must be 32 bytes");
  const nonce = randomBytes(SIZE.gcmNonce);
  const ct = gcm(key, nonce, aad).encrypt(plaintext);
  return { nonce, ct };
}

export function aesGcmDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ct: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  return gcm(key, nonce, aad).decrypt(ct);
}

/**
 * Wrap key = HKDF-SHA-256(ss || gateShare, salt=docId, info="tv-wrap-v1") -> 32 bytes.
 * gateShare is all-zero bytes when the gate is off (PoC mode).
 */
export function wrapKey(ss: Uint8Array, gateShare: Uint8Array, docId: string): Uint8Array {
  const ikm = new Uint8Array(ss.length + gateShare.length);
  ikm.set(ss, 0);
  ikm.set(gateShare, ss.length);
  return hkdf(sha256, ikm, enc.encode(docId), enc.encode("tv-wrap-v1"), SIZE.aesKey);
}

/**
 * The all-zero gate share used when GATE_MODE=off.
 */
export function zeroGateShare(): Uint8Array {
  return new Uint8Array(SIZE.aesKey);
}

/**
 * Per-document watermark key K_wm (spec.md section 5.2). Never stored on the
 * ledger (decision D-008): derived from the org's WM master, delivered to the
 * recipient's browser only after its decryption record is committed, and
 * re-derived by the investigator worker for extraction.
 */
export function wmKeyFor(docId: string, wmMaster: string): Uint8Array {
  return hexToBytes(sha256Hex(enc.encode(`wmkey|${docId}|${wmMaster}`)));
}

/** Gate share = HKDF(gateMaster, salt=docId, info="gate|recipientId|keyVersion"). */
export function gateShare(
  gateMaster: Uint8Array,
  docId: string,
  recipientId: string,
  keyVersion: number,
): Uint8Array {
  return hkdf(
    sha256,
    gateMaster,
    enc.encode(docId),
    enc.encode(`gate|${recipientId}|${keyVersion}`),
    SIZE.aesKey,
  );
}

// ---------------------------------------------------------------------------
// Canonical JSON (RFC 8785)
// ---------------------------------------------------------------------------

/** JCS canonical JSON bytes. Throws on values JCS cannot serialize. */
export function canonicalize(obj: unknown): Uint8Array {
  const out = jcsCanonicalize(obj);
  if (out === undefined) throw new Error("value is not canonicalizable (undefined or cyclic)");
  return enc.encode(out);
}

// ---------------------------------------------------------------------------
// Fingerprints and hashes
// ---------------------------------------------------------------------------

export function fingerprint(pk: Uint8Array): string {
  return bytesToHex(sha256(pk));
}

export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(h: string): Uint8Array {
  if (h.length % 2 !== 0 || !/^[0-9a-f]*$/.test(h)) throw new Error("bad hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomBytes_(n: number): Uint8Array {
  return randomBytes(n);
}

export { randomBytes };

// ---------------------------------------------------------------------------
// Sealed payload (production option, spec.md section 4.5)
// ---------------------------------------------------------------------------

export interface SealedPayload {
  v: 1;
  nonce: string; // hex, AES-GCM nonce of the sealed body
  ct: string; // hex, AES-GCM(auditKey, plaintext) with AAD = "arctrace-sealed-v1"
  /** Per audit recipient: KEM fingerprint, ML-KEM ciphertext, and the wrapped
   *  audit key (hex nonce||ct of AES-GCM(wrapKey, auditKey, AAD=kemFp)). */
  wrapped: Array<{ kemFp: string; kemCt: string; key: string }>;
}

const SEAL_AAD = enc.encode("arctrace-sealed-v1");
const SEAL_WRAP_SALT = enc.encode("seal");
const SEAL_WRAP_INFO = enc.encode("audit-key");

export function sealPayload(
  plaintext: Uint8Array,
  auditKey: Uint8Array,
  auditRecipientKemPks: Uint8Array[],
): SealedPayload {
  const { nonce, ct } = aesGcmEncrypt(auditKey, plaintext, SEAL_AAD);
  const wrapped = auditRecipientKemPks.map((pk) => {
    const { cipherText, sharedSecret } = kemEncapsulate(pk);
    const wrap = hkdf(sha256, sharedSecret, SEAL_WRAP_SALT, SEAL_WRAP_INFO, SIZE.aesKey);
    const fp = fingerprint(pk);
    const wrappedKey = aesGcmEncrypt(wrap, auditKey, enc.encode(fp));
    return {
      kemFp: fp,
      kemCt: bytesToHex(cipherText),
      key: `${bytesToHex(wrappedKey.nonce)}${bytesToHex(wrappedKey.ct)}`,
    };
  });
  return { v: 1, nonce: bytesToHex(nonce), ct: bytesToHex(ct), wrapped };
}

/** Open a sealed payload with the audit recipient's KEM key pair. */
export function openPayload(sealed: SealedPayload, auditRecipientKem: KemKeyPair): Uint8Array {
  const fp = fingerprint(auditRecipientKem.publicKey);
  const mine = sealed.wrapped.find((w) => w.kemFp === fp);
  if (!mine) throw new Error("no wrapped audit key for this recipient");
  const sharedSecret = kemDecapsulate(hexToBytes(mine.kemCt), auditRecipientKem.secretKey);
  const wrap = hkdf(sha256, sharedSecret, SEAL_WRAP_SALT, SEAL_WRAP_INFO, SIZE.aesKey);
  const keyNonce = hexToBytes(mine.key.slice(0, SIZE.gcmNonce * 2));
  const keyCt = hexToBytes(mine.key.slice(SIZE.gcmNonce * 2));
  const auditKey = aesGcmDecrypt(wrap, keyNonce, keyCt, enc.encode(fp));
  return aesGcmDecrypt(auditKey, hexToBytes(sealed.nonce), hexToBytes(sealed.ct), SEAL_AAD);
}
