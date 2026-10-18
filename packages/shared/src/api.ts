/**
 * ArcTrace HTTP API contract (spec.md section 6). Both apps/api (validation)
 * and apps/web (typed client) import from here, so the wire format has a
 * single source of truth. Base path: /v1. Errors are { error: { code, message } }.
 */
import { z } from "zod";
import { ROLES, hexSchema } from "./constants.js";
import {
  DocManifestCoreSchema,
  GrantEventCoreSchema,
  KeyRegistrationCoreSchema,
  SignedDecryptionRecordSchema,
} from "./records.js";

const iso = z.string();
const b64 = z.string().min(1);
const hex32 = hexSchema(32);

/** AES-256-GCM blob: base64 nonce || ct, as stored for titles. */
export const EncBlobSchema = z
  .object({
    alg: z.literal("AES-256-GCM"),
    nonce: b64,
    ct: b64,
  })
  .strict();
export type EncBlob = z.infer<typeof EncBlobSchema>;

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const RegisterRequestSchema = z
  .object({
    email: z.string().email().max(200),
    password: z.string().min(10).max(200),
    displayName: z.string().min(1).max(80),
    role: z.enum(ROLES),
  })
  .strict();
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z
  .object({
    email: z.string().email().max(200),
    password: z.string().min(1).max(200),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const SessionUserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().nullable(),
    walletAddress: z.string().nullable(),
    displayName: z.string(),
    role: z.enum(ROLES),
    orgId: z.string().uuid(),
    hasKeys: z.boolean(),
    createdAt: iso,
  })
  .strict();
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const LedgerStatusSchema = z
  .object({
    mode: z.enum(["arkiv", "mock"]),
    ok: z.boolean(),
    latencyMs: z.number(),
    writers: z.array(z.string()),
    explorerUrl: z.string(),
    gateMode: z.enum(["on", "off"]),
  })
  .strict();
export type LedgerStatus = z.infer<typeof LedgerStatusSchema>;

export const MeResponseSchema = z
  .object({
    user: SessionUserSchema,
    csrfToken: z.string(),
  })
  .strict();
export type MeResponse = z.infer<typeof MeResponseSchema>;

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** POST /keys — public keys + proof-of-possession signature over the core. */
export const KeySetupRequestSchema = KeyRegistrationCoreSchema.extend({
  sig: b64,
}).strict();
export type KeySetupRequest = z.infer<typeof KeySetupRequestSchema>;

export const KeySetupResponseSchema = z
  .object({
    keyId: z.string().uuid(),
    kemFp: hex32,
    sigFp: hex32,
    entityKey: z.string(),
    ledger: LedgerStatusSchema,
  })
  .strict();
export type KeySetupResponse = z.infer<typeof KeySetupResponseSchema>;

export const PublicKeySchema = z
  .object({
    userId: z.string().uuid(),
    kemPk: b64,
    sigPk: b64,
    kemFp: hex32,
    sigFp: hex32,
    status: z.enum(["active", "revoked"]),
    ledgerEntityKey: z.string().nullable(),
  })
  .strict();
export type PublicKey = z.infer<typeof PublicKeySchema>;

export const OrgUserSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string(),
    role: z.enum(ROLES),
    hasKeys: z.boolean(),
  })
  .strict();
export type OrgUser = z.infer<typeof OrgUserSchema>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const CreateDocumentRequestSchema = z
  .object({
    viewMode: z.enum(["VIEW_ONLY", "DOWNLOAD"]),
    sizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
  })
  .strict();
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequestSchema>;

export const CreateDocumentResponseSchema = z
  .object({
    docId: z.string().uuid(),
    /** Absolute S3 URL for the presigned PUT (web proxies it via /s3). */
    uploadUrl: z.string(),
    /** API-relative proxy path the browser should PUT to. */
    uploadPath: z.string(),
    expiresAt: iso,
  })
  .strict();
export type CreateDocumentResponse = z.infer<typeof CreateDocumentResponseSchema>;

/** Per-recipient wrapped DEK as sent at finalize. */
export const GrantInputSchema = z
  .object({
    recipientId: z.string().uuid(),
    kemCt: b64, // ML-KEM-768 ciphertext
    encDekNonce: b64, // AES-GCM nonce of the wrapped DEK
    encDek: b64, // AES-GCM ct of the wrapped DEK
    ts: iso,
    sig: b64, // sender ML-DSA-65 over GrantEventCore
  })
  .strict();
export type GrantInput = z.infer<typeof GrantInputSchema>;

export const FinalizeDocumentRequestSchema = z
  .object({
    titleEnc: EncBlobSchema.nullable(),
    manifest: DocManifestCoreSchema,
    senderSig: b64,
    grants: z.array(GrantInputSchema).min(1).max(50),
  })
  .strict();
export type FinalizeDocumentRequest = z.infer<typeof FinalizeDocumentRequestSchema>;

export const OutboxStatusSchema = z
  .object({
    kind: z.string(),
    idempotencyKey: z.string(),
    status: z.enum(["pending", "committed", "failed"]),
    entityKey: z.string().nullable(),
    attempts: z.number().int(),
    lastError: z.string().nullable(),
  })
  .strict();
export type OutboxStatus = z.infer<typeof OutboxStatusSchema>;

export const GrantInfoSchema = z
  .object({
    recipientId: z.string().uuid(),
    recipientName: z.string().nullable(),
    kemCt: b64,
    encDekNonce: b64,
    encDek: b64,
    status: z.enum(["active", "revoked"]),
    ledgerEntityKey: z.string().nullable(),
  })
  .strict();
export type GrantInfo = z.infer<typeof GrantInfoSchema>;

export const DocumentSummarySchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int(),
    viewMode: z.enum(["VIEW_ONLY", "DOWNLOAD"]),
    status: z.enum(["created", "uploading", "ready", "failed"]),
    titleEnc: EncBlobSchema.nullable(),
    ciphertextSha256: z.string().nullable(),
    sizeBytes: z.number().int(),
    senderId: z.string().uuid(),
    senderName: z.string(),
    createdAt: iso,
    grantCount: z.number().int(),
    myGrant: z
      .object({
        kemCt: b64,
        encDekNonce: b64,
        encDek: b64,
        status: z.enum(["active", "revoked"]),
      })
      .nullable(),
  })
  .strict();
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

export const DocumentDetailSchema = DocumentSummarySchema.extend({
  ledger: z.array(OutboxStatusSchema),
  /** Present only for the sender (or admin). */
  grants: z.array(GrantInfoSchema).nullable(),
});
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;

export const FinalizeDocumentResponseSchema = z
  .object({
    document: DocumentDetailSchema,
  })
  .strict();
export type FinalizeDocumentResponse = z.infer<typeof FinalizeDocumentResponseSchema>;

// ---------------------------------------------------------------------------
// Open flow (spec.md section 6)
// ---------------------------------------------------------------------------

export const OpenBeginResponseSchema = z
  .object({
    sessionId: z.string(),
    wmCode: hexSchema(8),
    challenge: z.string(),
    seq: z.number().int().nonnegative(),
    prevRecordHash: hex32.nullable(),
    expiresAt: iso,
    docId: z.string().uuid(),
    docVersion: z.number().int().positive(),
    docCiphertextSha256: hex32,
    viewMode: z.enum(["VIEW_ONLY", "DOWNLOAD"]),
    recipientId: z.string().uuid(),
    grant: z
      .object({
        kemCt: b64,
        encDekNonce: b64,
        encDek: b64,
      })
      .strict(),
    /** Short-lived presigned GET for the ciphertext. */
    ciphertextUrl: z.string(),
    ciphertextPath: z.string(),
    sizeBytes: z.number().int(),
  })
  .strict();
export type OpenBeginResponse = z.infer<typeof OpenBeginResponseSchema>;

export const OpenCommitRequestSchema = SignedDecryptionRecordSchema;
export type OpenCommitRequest = z.infer<typeof OpenCommitRequestSchema>;

export const OpenCommitResponseSchema = z
  .object({
    entityKey: z.string(),
    txHash: z.string().nullable(),
    committedAt: iso,
    seq: z.number().int().nonnegative(),
    prevRecordHash: hex32.nullable(),
    /** Per-document watermark key; released only AFTER the commit lands. */
    keyWm: hex32,
    gateMode: z.enum(["on", "off"]),
    ledger: LedgerStatusSchema,
  })
  .strict();
export type OpenCommitResponse = z.infer<typeof OpenCommitResponseSchema>;

// ---------------------------------------------------------------------------
// Traces (investigator)
// ---------------------------------------------------------------------------

export const TraceExtractionSchema = z
  .object({
    ok: z.boolean(),
    wmCode: hexSchema(8).nullable(),
    confidence: z.number(),
    alignment: z.object({ dx: z.number(), dy: z.number(), scale: z.number() }),
    attempts: z.number().int(),
  })
  .strict();
export type TraceExtraction = z.infer<typeof TraceExtractionSchema>;

export const TraceChainSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    prevRecordHash: hex32.nullable(),
    prevEntityKey: z.string().nullable(),
    prevOk: z.boolean(),
    nextCount: z.number().int().nonnegative(),
    nextOk: z.boolean(),
  })
  .strict();
export type TraceChain = z.infer<typeof TraceChainSchema>;

export const TraceResultSchema = z
  .object({
    fileKind: z.enum(["png", "jpeg", "pdf", "txt"]),
    leakedSha256: hex32,
    extraction: TraceExtractionSchema,
    query: z.object({ expression: z.string(), hits: z.number().int() }),
    record: SignedDecryptionRecordSchema.nullable(),
    entityKey: z.string().nullable(),
    creator: z.string().nullable(),
    recordVerified: z.boolean(),
    recipient: z
      .object({ recipientId: z.string().uuid(), displayName: z.string().nullable() })
      .nullable(),
    chain: TraceChainSchema.nullable(),
    checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string() })),
  })
  .strict();
export type TraceResult = z.infer<typeof TraceResultSchema>;

export const TraceStatusResponseSchema = z
  .object({
    traceId: z.string().uuid(),
    status: z.enum(["pending", "processing", "done", "failed"]),
    error: z.string().nullable(),
    result: TraceResultSchema.nullable(),
    createdAt: iso,
    completedAt: iso.nullable(),
  })
  .strict();
export type TraceStatusResponse = z.infer<typeof TraceStatusResponseSchema>;

// ---------------------------------------------------------------------------
// Evidence bundle (spec.md section 8)
// ---------------------------------------------------------------------------

export const LedgerEntityProofSchema = z
  .object({
    key: z.string(),
    creator: z.string(),
    owner: z.string(),
    attributes: z.record(z.string(), z.union([z.string(), z.number()])),
    payloadB64: b64,
    createdAt: z.number(),
    expiresAt: z.number(),
    readOnly: z.boolean(),
  })
  .strict();
export type LedgerEntityProof = z.infer<typeof LedgerEntityProofSchema>;

export const BundleResponseSchema = z
  .object({
    core: z.record(z.string(), z.unknown()),
    proofs: z.object({
      keyRegistration: LedgerEntityProofSchema.nullable(),
      investigatorKeyRegistration: LedgerEntityProofSchema.nullable(),
      manifest: LedgerEntityProofSchema.nullable(),
      decryptionRecord: LedgerEntityProofSchema,
    }),
    report: z.object({
      title: z.string(),
      lines: z.array(z.object({ label: z.string(), value: z.string() })),
    }),
    verifyMd: z.string(),
  })
  .strict();
export type BundleResponse = z.infer<typeof BundleResponseSchema>;

// ---------------------------------------------------------------------------
// Ledger verify endpoint
// ---------------------------------------------------------------------------

export const LedgerVerifyResponseSchema = z
  .object({
    entityKey: z.string(),
    found: z.boolean(),
    creator: z.string().nullable(),
    trustedCreator: z.boolean(),
    kind: z.string().nullable(),
    checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string() })),
  })
  .strict();
export type LedgerVerifyResponse = z.infer<typeof LedgerVerifyResponseSchema>;

export const ReadyResponseSchema = z
  .object({
    ok: z.boolean(),
    checks: z.array(
      z.object({
        name: z.string(),
        ok: z.boolean(),
        detail: z.string(),
        latencyMs: z.number().nullable(),
      }),
    ),
  })
  .strict();
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
