import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  DOMAIN,
  KeySetupRequestSchema,
  type KeySetupResponse,
  type PublicKey,
} from '@arctrace/shared';
import { canonicalize, fingerprint, fromBase64, verify } from '@arctrace/crypto';
import { userKeys, users } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, isUniqueViolation, ledgerUnavailable, notFound } from '../lib/errors.js';
import { getLedger } from '../lib/ledger.js';
import { ledgerStatus } from '../lib/status.js';
import { validate } from '../lib/validate.js';
import { activeKeys, requireRole } from './helpers.js';
import { requireUser } from '../lib/auth.js';
import type { Ctx } from '../types.js';

function toPublicKey(row: typeof userKeys.$inferSelect): PublicKey {
  return {
    userId: row.userId,
    kemPk: row.kemPk,
    sigPk: row.sigPk,
    kemFp: row.kemFp,
    sigFp: row.sigFp,
    status: row.status as 'active' | 'revoked',
    ledgerEntityKey: row.ledgerEntityKey,
  };
}

export async function keysRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const { db, config } = ctx;

  /**
   * POST /keys — register public keys with a proof-of-possession signature
   * over the canonical core. The ledger commit happens FIRST and is
   * fail-closed: no DB key row exists unless the chain accepted the
   * registration (decision D-0xx, spec §6).
   */
  app.post('/keys', { onRequest: app.authenticate }, async (req, reply): Promise<KeySetupResponse> => {
    const user = requireUser(req);
    const body = validate(KeySetupRequestSchema, req.body);

    if (body.userId !== user.id) throw forbidden('Keys must be registered for the session user');
    if (body.orgId !== user.orgId) throw forbidden('Key org mismatch');

    const existing = await activeKeys(db, user.id);
    if (existing) throw conflict('Keys already registered for this user');

    // Fingerprints must be the hash of the public keys they claim to cover.
    let kemPkBytes: Uint8Array;
    let sigPkBytes: Uint8Array;
    try {
      kemPkBytes = fromBase64(body.kemPk);
      sigPkBytes = fromBase64(body.sigPk);
    } catch {
      throw badRequest('Public keys must be base64');
    }
    if (fingerprint(kemPkBytes) !== body.kemFp) {
      throw badRequest('kemFp does not match kemPk');
    }
    if (fingerprint(sigPkBytes) !== body.sigFp) {
      throw badRequest('sigFp does not match sigPk');
    }
    if (body.alg !== 'ML-KEM-768+ML-DSA-65') {
      throw badRequest(`Unsupported alg "${body.alg}"`);
    }

    // Proof of possession: the requester signed the exact core they sent.
    const { sig, ...core } = body;
    let sigOk = false;
    try {
      sigOk = verify(DOMAIN.keyreg, canonicalize(core), fromBase64(sig), sigPkBytes);
    } catch {
      sigOk = false;
    }
    if (!sigOk) throw badRequest('Invalid proof-of-possession signature');

    // Fail-closed synchronous ledger commit (spec §6 commit order).
    const payload = canonicalize({ ...core, sig, signerKeyFp: body.sigFp });
    let ref;
    try {
      ref = await getLedger().commit({
        kind: 'key_registration',
        attributes: {
          schema: core.schema,
          org_id: core.orgId,
          key_fp: core.sigFp,
          ts: Date.now(),
        },
        payload,
        retentionSeconds: config.retentionSeconds,
        readOnly: true,
        payloadMode: 'plain',
        idempotencyKey: `keyreg-${core.sigFp}`,
      });
    } catch (err) {
      throw ledgerUnavailable(`Ledger commit failed: ${(err as Error).message}`);
    }

    const keyId = body.keyId;
    try {
      await db.insert(userKeys).values({
        id: keyId,
        userId: user.id,
        kemPk: body.kemPk,
        sigPk: body.sigPk,
        kemFp: body.kemFp,
        sigFp: body.sigFp,
        status: 'active',
        ledgerEntityKey: ref.entityKey,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Keys already registered for this user');
      throw err;
    }
    await writeAudit(db, user.id, 'key.generate', { keyId, entityKey: ref.entityKey });

    reply.status(201);
    return {
      keyId,
      kemFp: body.kemFp,
      sigFp: body.sigFp,
      entityKey: ref.entityKey,
      ledger: await ledgerStatus(config),
    };
  });

  /** Org-wide public keys — what the Share page wraps DEKs against. */
  app.get('/keys', { onRequest: app.authenticate }, async (req): Promise<PublicKey[]> => {
    const user = requireUser(req);
    const rows = await db
      .select()
      .from(userKeys)
      .innerJoin(users, eq(users.id, userKeys.userId))
      .where(eq(users.orgId, user.orgId));
    return rows.map((r) => toPublicKey(r.user_keys));
  });

  app.get<{ Params: { userId: string } }>(
    '/keys/:userId',
    { onRequest: app.authenticate },
    async (req): Promise<PublicKey> => {
      const user = requireUser(req);
      const target = await db
        .select()
        .from(users)
        .where(eq(users.id, req.params.userId))
        .limit(1);
      if (!target[0]) throw notFound('User not found');
      if (target[0].orgId !== user.orgId && target[0].id !== user.id) {
        throw forbidden('Cannot read keys outside your organisation');
      }
      const rows = await db
        .select()
        .from(userKeys)
        .where(eq(userKeys.userId, req.params.userId))
        .limit(1);
      if (!rows[0]) throw notFound('No keys registered for this user');
      return toPublicKey(rows[0]);
    },
  );

  /**
   * POST /keys/:keyId/revoke — owner or admin (spec §6). Phase 2 revokes
   * DB-side only: the on-ledger revoke event is deferred to Phase 3 (the
   * grant revoke events ARE committed, see documents routes).
   */
  app.post<{ Params: { keyId: string } }>(
    '/keys/:keyId/revoke',
    { onRequest: app.authenticate },
    async (req): Promise<{ ok: boolean; keyId: string; status: string }> => {
      const user = requireUser(req);
      const rows = await db.select().from(userKeys).where(eq(userKeys.id, req.params.keyId)).limit(1);
      const key = rows[0];
      if (!key) throw notFound('Key not found');
      if (key.userId !== user.id) requireRole(user, 'admin');
      if (key.status === 'revoked') throw conflict('Key already revoked');

      await db
        .update(userKeys)
        .set({ status: 'revoked', revokedAt: new Date() })
        .where(eq(userKeys.id, key.id));
      await writeAudit(db, user.id, 'key.revoke', {
        keyId: key.id,
        subjectUserId: key.userId,
      });
      return { ok: true, keyId: key.id, status: 'revoked' };
    },
  );
}
