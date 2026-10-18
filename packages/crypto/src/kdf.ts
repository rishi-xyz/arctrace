/**
 * Password / passphrase KDFs (spec.md section 2.1): Argon2id via hash-wasm —
 * a pure-WASM build that runs identically in Node and in browser workers, so
 * the server hashes login passwords and the browser derives the private-key
 * vault key with the same primitive (decision D-025).
 *
 *   Server password hash: argon2id m=64 MiB, t=3, p=1, encoded PHC string.
 *   Vault key:            argon2id with the same parameters -> 32 raw bytes.
 */
import { argon2id, argon2Verify } from "hash-wasm";
import { randomBytes } from "@noble/hashes/utils.js";

export const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // KiB = 64 MiB (spec minimum)
  hashLength: 32,
} as const;

export const SALT_BYTES = 16;

export function newSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

/** Hash a login password to a PHC-encoded argon2id string. */
export async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
  return argon2id({
    password,
    salt: salt ?? newSalt(),
    ...ARGON2_PARAMS,
    outputType: "encoded",
  });
}

/** Constant-shape verification; returns false on any malformed stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    return await argon2Verify({ hash: stored, password });
  } catch {
    return false;
  }
}

/**
 * Derive the 32-byte AES key that encrypts the private-key vault from the
 * user's passphrase. `context` binds the key to its purpose (domain sep).
 */
export async function deriveVaultKey(
  passphrase: string,
  salt: Uint8Array,
  context = "arctrace-vault-v1",
): Promise<Uint8Array> {
  const raw = await argon2id({
    password: `${context}\x00${passphrase}`,
    salt,
    ...ARGON2_PARAMS,
    outputType: "binary",
  });
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
}

/**
 * Argon2id is intentionally slow; tests must not pay 64 MiB per case.
 * Only for test fixtures — never for real credentials.
 */
export async function hashPasswordFast(password: string): Promise<string> {
  return argon2id({
    password,
    salt: newSalt(),
    parallelism: 1,
    iterations: 1,
    memorySize: 8192,
    hashLength: 32,
    outputType: "encoded",
  });
}

/** HKDF-free constant-time-ish compare of two byte arrays. */
export function ctEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
