/**
 * Evidence bundle format (spec.md section 8).
 *
 * bundle.json = EvidenceBundleCore + investigatorSig. The investigator's
 * ML-DSA-65 signature covers JCS(canonicalize(core)) under DOMAIN.bundle and
 * is produced in the browser (private keys never leave it), so `arctrace-verify`
 * can check it against the key_registration entity included in proofs/.
 */
import { z } from "zod";
import { hexSchema } from "./constants.js";
import { SignedDecryptionRecordSchema } from "./records.js";

export const BundleExtractionSchema = z
  .object({
    wmCode: hexSchema(8),
    confidence: z.number(),
    alignment: z.object({ dx: z.number(), dy: z.number(), scale: z.number() }),
  })
  .strict();
export type BundleExtraction = z.infer<typeof BundleExtractionSchema>;

export const BundleChainSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    prevRecordHash: hexSchema(32).nullable(),
    prevEntityKey: z.string().nullable(),
    prevOk: z.boolean(),
    nextCount: z.number().int().nonnegative(),
    nextOk: z.boolean(),
  })
  .strict();
export type BundleChain = z.infer<typeof BundleChainSchema>;

export const EvidenceBundleCoreSchema = z
  .object({
    schema: z.literal("arctrace.bundle/1"),
    traceId: z.string().uuid(),
    orgId: z.string().uuid(),
    createdAt: z.string(),
    fileKind: z.enum(["png", "jpeg", "pdf", "txt"]),
    leakedFileSha256: hexSchema(32),
    extraction: BundleExtractionSchema,
    query: z.object({ expression: z.string(), hits: z.number().int().nonnegative() }),
    entityKey: z.string(),
    creator: z.string(),
    record: SignedDecryptionRecordSchema,
    signerKeyFp: hexSchema(32),
    ledgerRef: z.object({
      committedAt: z.string(),
      txHash: z.string().nullable().optional(),
    }),
    chain: BundleChainSchema.nullable(),
    trustedWriters: z.array(z.string()).min(1),
    recipientId: z.string().uuid(),
  })
  .strict();
export type EvidenceBundleCore = z.infer<typeof EvidenceBundleCoreSchema>;

export const EvidenceBundleSchema = EvidenceBundleCoreSchema.extend({
  investigatorSig: z
    .object({
      alg: z.literal("ML-DSA-65"),
      sig: z.string(),
      signerKeyFp: hexSchema(32),
    })
    .strict(),
}).strict();
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

export const BUNDLE_SCHEMA = "arctrace.bundle/1";
