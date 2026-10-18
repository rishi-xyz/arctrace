import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { forbidden, unauthenticated } from './errors.js';

export const SESSION_COOKIE = 'arctrace_session';

const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  orgId: string;
  csrfToken: string;
  sessionId: string;
}

/**
 * Sessions are stored DB-side: only the SHA-256 of the bearer token is kept,
 * the raw token lives in an httpOnly cookie. CSRF defense = double submit:
 * mutating requests must echo the session's csrfToken in `x-csrf-token`.
 */
export async function createSession(
  db: Database,
  userId: string,
  ttlHours: number,
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  await db.insert(sessions).values({
    id: randomUUID(),
    userId,
    tokenHash: hashToken(token),
    csrfToken,
    expiresAt,
  });
  return { token, csrfToken, expiresAt };
}

export async function destroySession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export interface LoadSessionOpts {
  db: Database;
  token: string | undefined;
  csrfToken: string | undefined;
  /** Required for mutating methods (POST/PUT/PATCH/DELETE). */
  enforceCsrf: boolean;
}

export async function loadSession(opts: LoadSessionOpts): Promise<AuthedUser | null> {
  const { db, token, csrfToken, enforceCsrf } = opts;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await db
    .select({
      sessionId: sessions.id,
      csrfToken: sessions.csrfToken,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      orgId: users.orgId,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash)))
    .limit(1);
  const row = rows[0];
  if (!row) throw unauthenticated('Session not recognised');
  if (row.expiresAt.getTime() < Date.now()) throw unauthenticated('Session expired');

  if (enforceCsrf) {
    if (!csrfToken) throw forbidden('Missing CSRF token');
    const a = Buffer.from(row.csrfToken);
    const b = Buffer.from(csrfToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw forbidden('CSRF token mismatch');
    }
  }

  return {
    id: row.userId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    orgId: row.orgId,
    csrfToken: row.csrfToken,
    sessionId: row.sessionId,
  };
}
