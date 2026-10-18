import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * Account password hashing (spec §6: "Password hashed with argon2id").
 * PHC-format encoded strings are stored; verification is constant-time inside
 * hash-wasm. Parameters match the vault KDF (see docs/decisions.md).
 */
const PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536,
  hashLength: 32,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: crypto.getRandomValues(new Uint8Array(16)),
    ...PARAMS,
    outputType: 'encoded',
  });
}

export async function verifyPassword(password: string, phcHash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: phcHash });
  } catch {
    return false;
  }
}
