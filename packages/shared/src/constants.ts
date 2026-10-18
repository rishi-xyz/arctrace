/**
 * ArcTrace shared constants: hex helpers, domain strings, ledger kinds, the
 * public attribute allow-list and error codes (spec.md sections 3 and 4.3).
 */
import { z } from "zod";

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

/** Zod check for lowercase hex of exactly `bytes` bytes. */
export const hexSchema = (bytes: number) => z.string().refine(hexOfBytes(bytes));

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
// Roles (RBAC, spec.md section 6 / PRD FR-7)
// ---------------------------------------------------------------------------

export const ROLES = ["sender", "recipient", "investigator", "auditor", "admin"] as const;
export type Role = (typeof ROLES)[number];

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
  validation: "VALIDATION",
  unauthorized: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
  notFound: "NOT_FOUND",
  conflict: "CONFLICT",
  badPassphrase: "BAD_PASSPHRASE",
  payloadTooLarge: "PAYLOAD_TOO_LARGE",
  internal: "INTERNAL",
} as const;
