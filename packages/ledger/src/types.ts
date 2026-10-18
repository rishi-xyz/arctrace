/**
 * LedgerAdapter contract (spec.md section 4.1). Everything above the adapter
 * (API, gate, worker, verifier) speaks only this interface, with a mock for
 * tests and Arkiv for real deployments.
 */
import type { LedgerKind } from "@arctrace/shared";

export interface LedgerEntityInput {
  kind: LedgerKind;
  /** Indexed attributes; names must be snake_case and on the allow-list. */
  attributes: Record<string, string | number>;
  /** Canonical JSON bytes (the signed record). */
  payload: Uint8Array;
  retentionSeconds: number;
  readOnly: boolean; // default true (spec 4.4)
  payloadMode: "plain" | "sealed";
  /** Idempotency key, e.g. the sessionId. */
  idempotencyKey: string;
}

export interface LedgerRef {
  entityKey: string;
  txHash?: string;
  blockNumber?: number;
  committedAt: string;
}

export interface LedgerEntity {
  key: string;
  creator: string; // checksummed address; never changes
  owner: string; // checksummed address; changes on transfer
  attributes: Record<string, string | number>;
  payload: Uint8Array;
  contentType: string;
  createdAt: bigint;
  updatedAt: bigint;
  expiresAt: bigint;
  readOnly: boolean;
  payloadMode: "plain" | "sealed";
}

export interface QueryOptions {
  /** Trusted writer set. Every query MUST pass it; results from other
   *  creators are dropped by the adapter. */
  creators: string[];
  limit?: number;
  cursor?: string;
}

export interface QueryPage {
  items: LedgerEntity[];
  next?: string;
}

export interface LedgerAdapter {
  readonly name: string;
  commit(e: LedgerEntityInput): Promise<LedgerRef>;
  getByKey(entityKey: string): Promise<LedgerEntity | null>;
  query(
    kind: LedgerKind,
    where: Record<string, string | number>,
    opts: QueryOptions,
  ): Promise<QueryPage>;
  extendRetention(entityKey: string, extraSeconds: number): Promise<void>;
  transferOwnership(entityKey: string, newOwner: string): Promise<void>;
  health(): Promise<{ ok: boolean; latencyMs: number }>;
  /** Writer addresses this adapter signs with (the trusted set). */
  trustedWriters(): string[];
}

export class LedgerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

export const LEDGER_ERROR = {
  readOnly: "READ_ONLY",
  notFound: "NOT_FOUND",
  notOwner: "NOT_OWNER",
  untrustedCreator: "UNTRUSTED_CREATOR",
  invalidAttribute: "INVALID_ATTRIBUTE",
  unavailable: "UNAVAILABLE",
} as const;
