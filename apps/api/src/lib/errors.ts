/**
 * API error surface — always `{ error: { code, message } }` on the wire.
 * Codes are the SCREAMING_SNAKE set from the shared API contract.
 */

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'CHAIN_MOVED'
  | 'SESSION_EXPIRED'
  | 'SESSION_USED'
  | 'CHALLENGE_MISMATCH'
  | 'GRANT_INACTIVE'
  | 'KEY_REVOKED'
  | 'BAD_SIGNATURE'
  | 'LEDGER_UNAVAILABLE'
  | 'STORAGE_UNAVAILABLE'
  | 'INTERNAL';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (message: string, code: ErrorCode = 'VALIDATION_FAILED') =>
  new ApiError(400, code, message);
export const unauthenticated = (message = 'Authentication required') =>
  new ApiError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'Not permitted') => new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);
export const chainMoved = (message: string) => new ApiError(409, 'CHAIN_MOVED', message);
export const sessionExpired = (message = 'Open session expired') =>
  new ApiError(410, 'SESSION_EXPIRED', message);
export const sessionUsed = (message = 'Open session already used') =>
  new ApiError(409, 'SESSION_USED', message);
export const challengeMismatch = (message = 'Challenge or wmCode mismatch') =>
  new ApiError(400, 'CHALLENGE_MISMATCH', message);
export const grantInactive = (message = 'Grant is not active') =>
  new ApiError(403, 'GRANT_INACTIVE', message);
export const keyRevoked = (message = 'Signing key is revoked') =>
  new ApiError(403, 'KEY_REVOKED', message);
export const badSignature = (message = 'Signature verification failed') =>
  new ApiError(400, 'BAD_SIGNATURE', message);
export const rateLimited = (message = 'Too many requests') =>
  new ApiError(429, 'RATE_LIMITED', message);
export const internal = (message = 'Internal error') => new ApiError(500, 'INTERNAL', message);
export const ledgerUnavailable = (message = 'Ledger unavailable') =>
  new ApiError(503, 'LEDGER_UNAVAILABLE', message);
export const storageUnavailable = (message = 'Object storage unavailable') =>
  new ApiError(503, 'STORAGE_UNAVAILABLE', message);

/** True for a Postgres unique-constraint violation (23505), through any
 *  wrapping Drizzle adds (DrizzleQueryError → cause chain). */
export function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 6 && cur; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (code === '23505') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
