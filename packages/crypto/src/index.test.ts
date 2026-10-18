import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { DOMAIN } from "@arctrace/shared";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  canonicalize,
  fingerprint,
  fromBase64,
  generateKemKeyPair,
  generateSigKeyPair,
  gateShare,
  kemDecapsulate,
  kemEncapsulate,
  openPayload,
  randomBytes_,
  sealPayload,
  sha256Hex,
  sign,
  SIZE,
  toBase64,
  verify,
  wrapKey,
  zeroGateShare,
} from "./index.js";

describe("measured sizes match constants", () => {
  it("ML-KEM-768 and ML-DSA-65 sizes", () => {
    const kem = generateKemKeyPair();
    expect(kem.publicKey.length).toBe(SIZE.kemPk);
    expect(kem.secretKey.length).toBe(SIZE.kemSk);
    const { cipherText, sharedSecret } = kemEncapsulate(kem.publicKey);
    expect(cipherText.length).toBe(SIZE.kemCt);
    expect(sharedSecret.length).toBe(SIZE.kemSs);

    const dsa = generateSigKeyPair();
    expect(dsa.publicKey.length).toBe(SIZE.dsaPk);
    expect(dsa.secretKey.length).toBe(SIZE.dsaSk);
    const sig = sign(DOMAIN.decryption, new Uint8Array([1, 2, 3]), dsa.secretKey);
    expect(sig.length).toBe(SIZE.dsaSig);
  });
});

describe("ML-KEM encapsulate/decapsulate", () => {
  it("round trips", () => {
    const kem = generateKemKeyPair();
    const { cipherText, sharedSecret } = kemEncapsulate(kem.publicKey);
    const ss2 = kemDecapsulate(cipherText, kem.secretKey);
    expect(Buffer.from(ss2)).toEqual(Buffer.from(sharedSecret));
  });
});

describe("sign/verify with domain separation", () => {
  it("round trips", () => {
    const dsa = generateSigKeyPair();
    const msg = new TextEncoder().encode("hello arctrace");
    const sig = sign(DOMAIN.decryption, msg, dsa.secretKey);
    expect(verify(DOMAIN.decryption, msg, sig, dsa.publicKey)).toBe(true);
  });

  it("fails on tampered message", () => {
    const dsa = generateSigKeyPair();
    const msg = new TextEncoder().encode("hello");
    const sig = sign(DOMAIN.decryption, msg, dsa.secretKey);
    const bad = new TextEncoder().encode("hellp");
    expect(verify(DOMAIN.decryption, bad, sig, dsa.publicKey)).toBe(false);
  });

  it("fails on tampered signature byte", () => {
    const dsa = generateSigKeyPair();
    const msg = new TextEncoder().encode("hello");
    const sig = sign(DOMAIN.decryption, msg, dsa.secretKey);
    sig[100] = sig[100]! ^ 0x01;
    expect(verify(DOMAIN.decryption, msg, sig, dsa.publicKey)).toBe(false);
  });

  it("fails on a different domain", () => {
    const dsa = generateSigKeyPair();
    const msg = new TextEncoder().encode("hello");
    const sig = sign(DOMAIN.decryption, msg, dsa.secretKey);
    expect(verify(DOMAIN.trace, msg, sig, dsa.publicKey)).toBe(false);
  });

  it("fails on a wrong public key", () => {
    const a = generateSigKeyPair();
    const b = generateSigKeyPair();
    const msg = new TextEncoder().encode("hello");
    const sig = sign(DOMAIN.decryption, msg, a.secretKey);
    expect(verify(DOMAIN.decryption, msg, sig, b.publicKey)).toBe(false);
  });

  it("returns false instead of throwing on a garbage signature", () => {
    const dsa = generateSigKeyPair();
    expect(
      verify(DOMAIN.decryption, new Uint8Array(3), new Uint8Array(10), dsa.publicKey),
    ).toBe(false);
  });

  it("sign is deterministic (ML-DSA is deterministic)", () => {
    const dsa = generateSigKeyPair();
    const msg = new TextEncoder().encode("det");
    expect(Buffer.from(sign(DOMAIN.decryption, msg, dsa.secretKey))).toEqual(
      Buffer.from(sign(DOMAIN.decryption, msg, dsa.secretKey)),
    );
  });
});

describe("AES-256-GCM", () => {
  it("round trips with AAD", () => {
    const key = randomBytes_(32);
    const pt = new TextEncoder().encode("plaintext bytes");
    const aad = new TextEncoder().encode("doc-1||1");
    const { nonce, ct } = aesGcmEncrypt(key, pt, aad);
    expect(nonce.length).toBe(12);
    const out = aesGcmDecrypt(key, nonce, ct, aad);
    expect(Buffer.from(out)).toEqual(Buffer.from(pt));
  });

  it("fails when AAD differs", () => {
    const key = randomBytes_(32);
    const { nonce, ct } = aesGcmEncrypt(key, new Uint8Array([9]), new TextEncoder().encode("a"));
    expect(() => aesGcmDecrypt(key, nonce, ct, new TextEncoder().encode("b"))).toThrow();
  });

  it("fails when ciphertext is tampered", () => {
    const key = randomBytes_(32);
    const { nonce, ct } = aesGcmEncrypt(key, new Uint8Array([9, 9, 9]), new Uint8Array(0));
    ct[0] = ct[0]! ^ 0xff;
    expect(() => aesGcmDecrypt(key, nonce, ct, new Uint8Array(0))).toThrow();
  });
});

describe("wrapKey / gate share", () => {
  it("is deterministic and key-dependent", () => {
    const ss = randomBytes_(32);
    const gs = randomBytes_(32);
    const k1 = wrapKey(ss, gs, "doc-1");
    const k2 = wrapKey(ss, gs, "doc-1");
    const k3 = wrapKey(ss, gs, "doc-2");
    expect(k1.length).toBe(32);
    expect(Buffer.from(k1)).toEqual(Buffer.from(k2));
    expect(Buffer.from(k1)).not.toEqual(Buffer.from(k3));
  });

  it("zero gate share (gate off) differs from a real share", () => {
    const ss = randomBytes_(32);
    const master = randomBytes_(32);
    const off = wrapKey(ss, zeroGateShare(), "doc-1");
    const on = wrapKey(ss, gateShare(master, "doc-1", "bob", 1), "doc-1");
    expect(Buffer.from(off)).not.toEqual(Buffer.from(on));
  });

  it("gate share differs per recipient and doc", () => {
    const master = randomBytes_(32);
    expect(Buffer.from(gateShare(master, "d", "bob", 1))).not.toEqual(
      Buffer.from(gateShare(master, "d", "alice", 1)),
    );
    expect(Buffer.from(gateShare(master, "d", "bob", 1))).not.toEqual(
      Buffer.from(gateShare(master, "e", "bob", 1)),
    );
  });
});

describe("JCS canonicalize (RFC 8785)", () => {
  it("sorts keys regardless of insertion order", () => {
    const a = canonicalize({ b: 1, a: 2, c: { z: 1, y: [3, 2, 1] } });
    const b = canonicalize({ c: { y: [3, 2, 1], z: 1 }, a: 2, b: 1 });
    expect(Buffer.from(a)).toEqual(Buffer.from(b));
    expect(new TextDecoder().decode(a)).toBe('{"a":2,"b":1,"c":{"y":[3,2,1],"z":1}}');
  });

  it("throws on undefined", () => {
    expect(() => canonicalize(undefined)).toThrow();
  });
});

describe("fingerprints and hashes", () => {
  it("fingerprint is sha256 hex", () => {
    const pk = randomBytes_(1952);
    expect(fingerprint(pk)).toBe(sha256Hex(pk));
    expect(fingerprint(pk)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint(pk)).not.toBe(fingerprint(randomBytes_(1952)));
  });

  it("sha256 matches a known vector", () => {
    // sha256("abc")
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(Buffer.from(sha256(new Uint8Array(0))).toString("hex")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("HKDF-SHA-256 known vector (RFC 5869 test case 1)", () => {
  it("derives the documented bytes", () => {
    const ikm = Buffer.from("0b".repeat(22), "hex");
    const salt = Buffer.from("000102030405060708090a0b0c", "hex");
    const info = Buffer.from("f0f1f2f3f4f5f6f7f8f9", "hex");
    const okm = hkdf(sha256, ikm, salt, info, 42);
    expect(Buffer.from(okm).toString("hex")).toBe(
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
    );
  });
});

describe("sealed payload", () => {
  it("round trips for the intended audit recipient only", () => {
    const auditA = generateKemKeyPair();
    const auditB = generateKemKeyPair();
    const auditKey = randomBytes_(32);
    const record = new TextEncoder().encode('{"seq":1,"wmCode":"aabb"}');
    const sealed = sealPayload(record, auditKey, [auditA.publicKey, auditB.publicKey]);

    expect(openPayload(sealed, auditA)).toEqual(record);
    expect(openPayload(sealed, auditB)).toEqual(record);

    const stranger = generateKemKeyPair();
    expect(() => openPayload(sealed, stranger)).toThrow();
  });
});

describe("base64 helpers", () => {
  it("round trips", () => {
    const b = randomBytes_(40);
    expect(fromBase64(toBase64(b))).toEqual(b);
  });
});
