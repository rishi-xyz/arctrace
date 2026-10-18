import { describe, expect, it } from "vitest";
import {
  ALLOWED_ATTRIBUTES,
  assertAllowedAttributes,
  DecryptionRecordSchema,
  DOMAIN,
  hexOfBytes,
  SignedDecryptionRecordSchema,
  AttributePolicyError,
} from "./index.js";

const validRecord = {
  schema: "arctrace.decryption/1",
  orgId: "6f0a5b3e-0f0f-4a4a-9c9c-0a0a0a0a0a0a",
  docId: "11111111-1111-4111-8111-111111111111",
  docVersion: 1,
  docCiphertextSha256: "a".repeat(64),
  recipientId: "22222222-2222-4222-8222-222222222222",
  recipientSigKeyFp: "b".repeat(64),
  sessionId: "c".repeat(32),
  wmCode: "d".repeat(16),
  challenge: "e".repeat(32),
  viewMode: "VIEW_ONLY",
  clientTime: "2026-10-18T10:00:00.000Z",
  seq: 0,
  prevRecordHash: null,
} as const;

describe("DecryptionRecord schema", () => {
  it("accepts a valid record", () => {
    expect(DecryptionRecordSchema.safeParse(validRecord).success).toBe(true);
  });

  it("rejects an uppercase hex wmCode", () => {
    const bad = { ...validRecord, wmCode: "D".repeat(16) };
    expect(DecryptionRecordSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const bad = { ...validRecord, extra: 1 };
    expect(DecryptionRecordSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a negative seq", () => {
    const bad = { ...validRecord, seq: -1 };
    expect(DecryptionRecordSchema.safeParse(bad).success).toBe(false);
  });
});

describe("SignedDecryptionRecord schema", () => {
  it("accepts a valid signed record", () => {
    const signed = { record: validRecord, alg: "ML-DSA-65", sig: "AAAA" };
    expect(SignedDecryptionRecordSchema.safeParse(signed).success).toBe(true);
  });

  it("rejects a wrong algorithm", () => {
    const signed = { record: validRecord, alg: "ED25519", sig: "AAAA" };
    expect(SignedDecryptionRecordSchema.safeParse(signed).success).toBe(false);
  });
});

describe("hexOfBytes", () => {
  it("checks length and case", () => {
    expect(hexOfBytes(2)("abcd")).toBe(true);
    expect(hexOfBytes(2)("abc")).toBe(false);
    expect(hexOfBytes(2)("ABCD")).toBe(false);
  });
});

describe("attribute allow-list", () => {
  it("accepts allowed names", () => {
    expect(() =>
      assertAllowedAttributes({ kind: "decryption_event", wm_code: "aa", seq: 1 }),
    ).not.toThrow();
  });

  it("rejects a file name attribute", () => {
    expect(() => assertAllowedAttributes({ file_name: "secret.pdf" })).toThrow(
      AttributePolicyError,
    );
  });

  it("rejects any name not on the list", () => {
    for (const name of ALLOWED_ATTRIBUTES) {
      expect(() => assertAllowedAttributes({ [name]: 1 })).not.toThrow();
    }
  });
});

describe("domain strings", () => {
  it("are stable", () => {
    expect(DOMAIN.decryption).toBe("ARCTRACE-DECRYPT-V1");
    expect(DOMAIN.bundle).toBe("ARCTRACE-BUNDLE-V1");
  });
});
