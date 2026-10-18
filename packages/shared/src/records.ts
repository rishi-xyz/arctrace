/**
 * Zod schemas for on-ledger records (spec.md section 3). Every record is
 * canonicalized with RFC 8785 before signing and before commit.
 */
import { z } from "zod";
import {
  CHALLENGE_BYTES,
  SESSION_ID_BYTES,
  WM_CODE_BYTES,
  hexOfBytes,
} from "./constants.js";

export const DecryptionRecordSchema = z
  .object({
    schema: z.literal("arctrace.decryption/1"),
    orgId: z.string().uuid(),
    docId: z.string().uuid(),
    docVersion: z.number().int().positive(),
    docCiphertextSha256: z.string().refine(hexOfBytes(32)),
    recipientId: z.string().uuid(),
    recipientSigKeyFp: z.string().refine(hexOfBytes(32)),
    sessionId: z.string().refine(hexOfBytes(SESSION_ID_BYTES)),
    wmCode: z.string().refine(hexOfBytes(WM_CODE_BYTES)),
    challenge: z.string().refine(hexOfBytes(CHALLENGE_BYTES)),
    viewMode: z.enum(["VIEW_ONLY", "DOWNLOAD"]),
    clientTime: z.string(), // ISO-8601, informational
    seq: z.number().int().nonnegative(),
    prevRecordHash: z.string().refine(hexOfBytes(32)).nullable(),
  })
  .strict();

export type DecryptionRecord = z.infer<typeof DecryptionRecordSchema>;

export const SignedDecryptionRecordSchema = z
  .object({
    record: DecryptionRecordSchema,
    alg: z.literal("ML-DSA-65"),
    sig: z.string(), // base64
  })
  .strict();

export type SignedDecryptionRecord = z.infer<typeof SignedDecryptionRecordSchema>;

export const KeyRegistrationSchema = z
  .object({
    schema: z.literal("arctrace.keyreg/1"),
    orgId: z.string().uuid(),
    ts: z.string(),
    userId: z.string().uuid(),
    keyId: z.string().uuid(),
    kemPk: z.string(), // base64 ML-KEM-768 public key
    sigPk: z.string(), // base64 ML-DSA-65 public key
    kemFp: z.string().refine(hexOfBytes(32)),
    sigFp: z.string().refine(hexOfBytes(32)),
    alg: z.string(),
    sig: z.string(),
    signerKeyFp: z.string(),
  })
  .strict();

export type KeyRegistration = z.infer<typeof KeyRegistrationSchema>;

export const GrantEventSchema = z
  .object({
    schema: z.literal("arctrace.grant/1"),
    orgId: z.string().uuid(),
    ts: z.string(),
    docId: z.string().uuid(),
    recipientId: z.string().uuid(),
    action: z.enum(["grant", "revoke"]),
    signerKeyFp: z.string(),
    sig: z.string(),
  })
  .strict();

export type GrantEvent = z.infer<typeof GrantEventSchema>;

export const DocManifestSchema = z
  .object({
    schema: z.literal("arctrace.manifest/1"),
    orgId: z.string().uuid(),
    ts: z.string(),
    docId: z.string().uuid(),
    version: z.number().int().positive(),
    senderId: z.string().uuid(),
    ciphertextSha256: z.string().refine(hexOfBytes(32)),
    recipientSetHash: z.string().refine(hexOfBytes(32)),
    viewMode: z.enum(["VIEW_ONLY", "DOWNLOAD"]),
    signerKeyFp: z.string(),
    sig: z.string(),
  })
  .strict();

export type DocManifest = z.infer<typeof DocManifestSchema>;

// ---------------------------------------------------------------------------
// Unsigned cores: what the client signs. The server rebuilds the exact same
// object, verifies the ML-DSA-65 signature, then adds alg/sig for the payload.
// ---------------------------------------------------------------------------

export const KeyRegistrationCoreSchema = KeyRegistrationSchema.omit({
  sig: true,
  signerKeyFp: true,
});
export type KeyRegistrationCore = z.infer<typeof KeyRegistrationCoreSchema>;

export const DocManifestCoreSchema = DocManifestSchema.omit({ sig: true });
export type DocManifestCore = z.infer<typeof DocManifestCoreSchema>;

export const GrantEventCoreSchema = GrantEventSchema.omit({ sig: true });
export type GrantEventCore = z.infer<typeof GrantEventCoreSchema>;
