/**
 * ArcTrace shared types, Zod schemas, domain strings and the public
 * attribute allow-list (spec.md section 3 and 4.3).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HEX_LOWER = /^[0-9a-f]+$/;

export const WM_CODE_BYTES = 8; // 64-bit watermark code
export const SESSION_ID_BYTES = 16;
export const CHALLENGE_BYTES = 16;

/** Signing domain separation strings (spec.md section 2.3). */
export const DOMAIN = {
  decryption: "ARCTRACE-DECRYPT-V1",
  keyreg: "ARCTRACE-KEYREG-V1",
  manifest: "ARCTRACE-MANIFEST-V1",
  grant: "ARCTRACE-GRANT-V1",
  anchor: "ARCTRACE-ANCHOR-V1",
  trace: "ARCTRACE-TRACE-V1",
  bundle: "ARCTRACE-BUNDLE-V1",
} as const;

export type Domain = (typeof DOMAIN)[keyof typeof DOMAIN];

export type Hex = string;

export const hexOfBytes =
  (bytes: number) =>
  (v: string): boolean =>
    typeof v === "string" && v.length === bytes * 2 && HEX_LOWER.test(v);

// ---------------------------------------------------------------------------
// Zod schemas for on-ledger records (spec.md section 3)
// ---------------------------------------------------------------------------

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
// Ledger kinds
// ---------------------------------------------------------------------------

export const LEDGER_KINDS = [
  "key_registration",
  "doc_manifest",
  "grant_event",
  "decryption_event",
  "anchor",
  "trace_report",
] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

// ---------------------------------------------------------------------------
// Public attribute policy (spec.md section 4.3)
// ---------------------------------------------------------------------------

/**
 * Attribute names allowed on any Arkiv entity. On-chain names are
 * snake_case because Arkiv attribute names must be lowercase ASCII
 * (see docs/decisions.md D-003).
 */
export const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "schema",
  "kind",
  "org_id",
  "doc_id",
  "doc_hash",
  "recipient_id",
  "wm_code",
  "session_id",
  "seq",
  "ts",
  "action",
  "key_fp",
  "trace_id",
  "from_seq",
  "to_seq",
]);

export class AttributePolicyError extends Error {
  constructor(name: string) {
    super(`attribute "${name}" is not on the ArcTrace public attribute allow-list`);
    this.name = "AttributePolicyError";
  }
}

/** Throws if any attribute name is not on the allow-list. Unit-testable gate. */
export function assertAllowedAttributes(attrs: Record<string, unknown>): void {
  for (const name of Object.keys(attrs)) {
    if (!ALLOWED_ATTRIBUTES.has(name)) throw new AttributePolicyError(name);
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ArcTraceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ArcTraceError";
    this.code = code;
  }
}

export const ERROR_CODES = {
  chainMoved: "CHAIN_MOVED",
  sessionExpired: "SESSION_EXPIRED",
  sessionUsed: "SESSION_USED",
  challengeMismatch: "CHALLENGE_MISMATCH",
  grantInactive: "GRANT_INACTIVE",
  keyRevoked: "KEY_REVOKED",
  badSignature: "BAD_SIGNATURE",
  untrustedCreator: "UNTRUSTED_CREATOR",
  ledgerUnavailable: "LEDGER_UNAVAILABLE",
} as const;
