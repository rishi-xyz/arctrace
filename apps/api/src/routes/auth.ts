import type { RouteApp, ApiReply } from '../compat.js';
import { eq } from 'drizzle-orm';
import {
  LoginRequestSchema,
  MeResponseSchema,
  RegisterRequestSchema,
  type MeResponse,
} from '@arctrace/shared';
import { orgs, users } from '../db/schema.js';
import { assertSameOrigin, requireUser } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { conflict, isUniqueViolation, unauthenticated } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  createSession,
  destroySession,
  SESSION_COOKIE,
} from '../lib/session.js';
import { validate } from '../lib/validate.js';
import { sessionUser } from './helpers.js';
import type { Ctx } from '../types.js';

function setSessionCookie(
  reply: ApiReply,
  ctx: Ctx,
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

export async function authRoutes(app: RouteApp, ctx: Ctx): Promise<void> {
  const { db, config } = ctx;

  /**
   * Phase 2 org model: a single shared demo org (multi-org federation is
   * explicitly out of scope until later — checklist "Multi-org federation").
   * The first registration creates it; everyone after joins it, so the Share
   * page can list real members during manual testing.
   */
  async function defaultOrgId(): Promise<string> {
    const existing = await db.select({ id: orgs.id }).from(orgs).orderBy(orgs.createdAt).limit(1);
    if (existing[0]) return existing[0].id;
    try {
      const inserted = await db
        .insert(orgs)
        .values({ name: config.orgName, retentionSeconds: config.retentionSeconds })
        .returning({ id: orgs.id });
      return inserted[0]!.id;
    } catch {
      // concurrent first registration — someone else created it
      const again = await db.select({ id: orgs.id }).from(orgs).orderBy(orgs.createdAt).limit(1);
      if (again[0]) return again[0].id;
      throw new Error('failed to create default org');
    }
  }

  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply): Promise<MeResponse> => {
      assertSameOrigin(req, config);
      const body = validate(RegisterRequestSchema, req.body);
      const email = body.email.trim().toLowerCase();

      const orgId = await defaultOrgId();
      const pwHash = await hashPassword(body.password);
      const row: typeof users.$inferInsert = {
        orgId,
        email,
        pwHash,
        role: body.role,
        displayName: body.displayName.trim(),
      };
      let userId: string;
      let createdAt: Date;
      try {
        const inserted = await db.insert(users).values(row).returning({
          id: users.id,
          createdAt: users.createdAt,
        });
        userId = inserted[0]!.id;
        createdAt = inserted[0]!.createdAt;
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('Email already registered');
        throw err;
      }

      const session = await createSession(db, userId, config.sessionTtlHours);
      setSessionCookie(reply, ctx, session.token, session.expiresAt);
      await writeAudit(db, userId, 'user.register', { role: body.role });

      const user = await sessionUser(db, {
        id: userId,
        email,
        displayName: row.displayName,
        role: body.role,
        orgId,
        createdAt,
      });
      reply.status(201);
      return MeResponseSchema.parse({ user, csrfToken: session.csrfToken });
    },
  );

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply): Promise<MeResponse> => {
      assertSameOrigin(req, config);
      const body = validate(LoginRequestSchema, req.body);
      const email = body.email.trim().toLowerCase();

      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const user = rows[0];
      // Same error for unknown email and wrong password — no user enumeration.
      const ok = user ? await verifyPassword(body.password, user.pwHash) : false;
      if (!user || !ok) throw unauthenticated('Invalid email or password');

      const session = await createSession(db, user.id, config.sessionTtlHours);
      setSessionCookie(reply, ctx, session.token, session.expiresAt);
      await writeAudit(db, user.id, 'user.login', {});

      const su = await sessionUser(db, user);
      return MeResponseSchema.parse({ user: su, csrfToken: session.csrfToken });
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await destroySession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.status(204);
    return null;
  });

  app.get('/me', { onRequest: app.authenticate }, async (req): Promise<MeResponse> => {
    const auth = requireUser(req);
    const rows = await db.select().from(users).where(eq(users.id, auth.id)).limit(1);
    const user = rows[0];
    if (!user) throw unauthenticated();
    const su = await sessionUser(db, user);
    return MeResponseSchema.parse({ user: su, csrfToken: auth.csrfToken });
  });
}
