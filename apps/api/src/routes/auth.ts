import type { RouteApp, ApiReply } from '../compat.js';
import { randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { getAddress, isAddress, verifyMessage } from 'viem';
import { z } from 'zod';
import {
  LoginRequestSchema,
  MeResponseSchema,
  RegisterRequestSchema,
  type MeResponse,
} from '@arctrace/shared';
import { orgs, users, walletChallenges } from '../db/schema.js';
import { assertSameOrigin, requireUser } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { badRequest, conflict, isUniqueViolation, unauthenticated } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  createSession,
  destroySession,
  SESSION_COOKIE,
} from '../lib/session.js';
import { validate } from '../lib/validate.js';
import { sessionUser } from './helpers.js';
import type { Ctx } from '../types.js';

const TIRAMISU_CHAIN_ID = 7738577;
const WalletNonceSchema = z.object({ address: z.string().min(1) }).strict();
const WalletVerifySchema = z.object({
  address: z.string().min(1),
  message: z.string().min(1).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  displayName: z.string().trim().min(1).max(80),
  role: z.enum(['sender', 'recipient', 'investigator']),
  createAccount: z.boolean(),
}).strict();

function parseSignInMessage(message: string) {
  const lines = message.split('\n');
  const field = (name: string) => lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2);
  const address = lines[1]?.trim();
  const domain = lines[0]?.match(/^(.+) wants you to sign in with your Ethereum account:$/)?.[1];
  return {
    address,
    domain,
    uri: field('URI'),
    version: field('Version'),
    nonce: field('Nonce'),
    issuedAt: field('Issued At'),
    expirationTime: field('Expiration Time'),
    chainId: Number(field('Chain ID')),
  };
}

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
      const ok = user?.pwHash ? await verifyPassword(body.password, user.pwHash) : false;
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

  app.post('/auth/wallet/nonce', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    assertSameOrigin(req, config);
    const body = validate(WalletNonceSchema, req.body);
    if (!isAddress(body.address)) throw badRequest('Invalid Ethereum wallet address');
    const address = getAddress(body.address).toLowerCase();
    const originHeader = req.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    if (!origin) throw badRequest('Wallet sign-in requires a browser origin');
    const originUrl = new URL(origin);
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
    await db.delete(walletChallenges).where(lt(walletChallenges.expiresAt, issuedAt));
    await db.insert(walletChallenges).values({ nonce, address, domain: originUrl.host, uri: origin, issuedAt, expiresAt });
    const message = [
      `${originUrl.host} wants you to sign in with your Ethereum account:`,
      getAddress(body.address),
      '',
      'Sign in to ArcTrace. This request will not send a transaction or spend GLM.',
      '',
      `URI: ${origin}`,
      'Version: 1',
      `Chain ID: ${TIRAMISU_CHAIN_ID}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt.toISOString()}`,
      `Expiration Time: ${expiresAt.toISOString()}`,
    ].join('\n');
    return { message, expiresAt: expiresAt.toISOString(), chainId: TIRAMISU_CHAIN_ID };
  });

  app.post('/auth/wallet/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    assertSameOrigin(req, config);
    const body = validate(WalletVerifySchema, req.body);
    if (!isAddress(body.address)) throw unauthenticated('Invalid wallet address');
    const address = getAddress(body.address);
    const parsed = parseSignInMessage(body.message);
    if (!parsed.nonce || parsed.address?.toLowerCase() !== address.toLowerCase()) throw unauthenticated('Wallet sign-in message does not match this account');
    const challenges = await db.select().from(walletChallenges).where(eq(walletChallenges.nonce, parsed.nonce)).limit(1);
    const challenge = challenges[0];
    if (!challenge || challenge.address !== address.toLowerCase() || challenge.expiresAt.getTime() < Date.now()) {
      throw unauthenticated('Wallet sign-in request expired. Please try again.');
    }
    const expectedMessage = [
      `${challenge.domain} wants you to sign in with your Ethereum account:`,
      address,
      '',
      'Sign in to ArcTrace. This request will not send a transaction or spend GLM.',
      '',
      `URI: ${challenge.uri}`,
      'Version: 1',
      `Chain ID: ${TIRAMISU_CHAIN_ID}`,
      `Nonce: ${challenge.nonce}`,
      `Issued At: ${challenge.issuedAt.toISOString()}`,
      `Expiration Time: ${challenge.expiresAt.toISOString()}`,
    ].join('\n');
    if (body.message !== expectedMessage) throw unauthenticated('Wallet sign-in message was changed');
    const originHeader = req.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    if (!origin || parsed.domain !== challenge.domain || parsed.uri !== challenge.uri || parsed.chainId !== TIRAMISU_CHAIN_ID || parsed.version !== '1') {
      throw unauthenticated('Wallet sign-in message has invalid site or network details');
    }
    const issuedMs = Date.parse(parsed.issuedAt ?? '');
    const expiryMs = Date.parse(parsed.expirationTime ?? '');
    if (issuedMs !== challenge.issuedAt.getTime() || expiryMs !== challenge.expiresAt.getTime() || origin !== challenge.uri) {
      throw unauthenticated('Wallet sign-in request is invalid or expired');
    }
    let signatureValid = false;
    try { signatureValid = await verifyMessage({ address, message: body.message, signature: body.signature as `0x${string}` }); }
    catch { signatureValid = false; }
    if (!signatureValid) throw unauthenticated('Wallet signature could not be verified');
    const consumed = await db.delete(walletChallenges).where(eq(walletChallenges.nonce, challenge.nonce)).returning({ nonce: walletChallenges.nonce });
    if (!consumed.length) throw unauthenticated('Wallet sign-in request has already been used');

    const normalizedAddress = address.toLowerCase();
    let rows = await db.select().from(users).where(eq(users.walletAddress, normalizedAddress)).limit(1);
    let user = rows[0];
    if (!user) {
      if (!body.createAccount) throw unauthenticated('This wallet has no ArcTrace account yet. Choose Create account to register it.');
      const orgId = await defaultOrgId();
      try {
        const inserted = await db.insert(users).values({
          orgId,
          email: null,
          pwHash: null,
          walletAddress: normalizedAddress,
          role: body.role,
          displayName: body.displayName.trim(),
        }).returning();
        user = inserted[0];
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        rows = await db.select().from(users).where(eq(users.walletAddress, normalizedAddress)).limit(1);
        user = rows[0];
        if (!user) throw conflict('Could not create the wallet account');
      }
      if (user) await writeAudit(db, user.id, 'user.wallet_register', { role: user.role });
    } else {
      await writeAudit(db, user.id, 'user.wallet_login', {});
    }
    if (!user) throw conflict('Could not resolve wallet account');
    const session = await createSession(db, user.id, config.sessionTtlHours);
    setSessionCookie(reply, ctx, session.token, session.expiresAt);
    const safeUser = await sessionUser(db, user);
    return MeResponseSchema.parse({ user: safeUser, csrfToken: session.csrfToken });
  });
}
