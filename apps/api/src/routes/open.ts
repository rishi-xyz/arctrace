import type { RouteApp } from '../compat.js';
import { eq } from 'drizzle-orm';
import {
  DOMAIN,
  OpenCommitRequestSchema,
  type OpenBeginResponse,
  type OpenCommitResponse,
} from '@arctrace/shared';
import {
  bytesToHex,
  canonicalize,
  fromBase64,
  randomBytes,
  sha256Hex,
  verify,
  wmKeyFor,
} from '@arctrace/crypto';
import { openSessions, userKeys } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { requireUser } from '../lib/auth.js';
import { chainHead } from '../lib/chain.js';
import {
  badRequest,
  badSignature,
  challengeMismatch,
  chainMoved,
  conflict,
  grantInactive,
  keyRevoked,
  ledgerUnavailable,
  notFound,
  sessionExpired,
  sessionUsed,
} from '../lib/errors.js';
import { getLedger } from '../lib/ledger.js';
import { presignGet, signedPaths } from '../lib/s3.js';
import { ledgerStatus } from '../lib/status.js';
import { validate } from '../lib/validate.js';
import { activeKeys, loadDoc, myGrant, toIso } from './helpers.js';
import type { Ctx } from '../types.js';

const CLOCK_SKEW_MS = 10 * 60 * 1000; // spec §6: clientTime ±10 minutes

export async function openRoutes(app: RouteApp, ctx: Ctx): Promise<void> {
  const { db, config } = ctx;

  /**
   * POST /documents/:id/open/begin — issue a one-time open session. Returns
   * everything the browser needs EXCEPT the watermark key: keyWm is released
   * only by a successful commit (commit-before-release, spec §6).
   */
  app.post<{ Params: { id: string } }>(
    '/documents/:id/open/begin',
    { onRequest: app.authenticate },
    async (req): Promise<OpenBeginResponse> => {
      const user = requireUser(req);
      const doc = await loadDoc(db, req.params.id);
      if (doc.orgId !== user.orgId) throw notFound('Document not found');
      if (doc.status !== 'ready') throw conflict(`Document is ${doc.status}`);
      if (!doc.ciphertextSha256) throw conflict('Document ciphertext not sealed');

      const grant = await myGrant(db, doc.id, user.id);
      // 404-style silence: don't confirm a document exists to non-recipients.
      if (!grant) throw notFound('Document not found');
      if (grant.status !== 'active') throw grantInactive();

      const keys = await activeKeys(db, user.id);
      if (!keys) throw badRequest('No active keys — generate your key pair first');

      // Chain head from the ledger (fail closed) — spec §6 "current".
      const head = await chainHead(doc.id);

      const sessionId = bytesToHex(randomBytes(16));
      const wmCode = bytesToHex(randomBytes(8));
      const challenge = bytesToHex(randomBytes(16));
      const expiresAt = new Date(Date.now() + config.openSessionTtlSeconds * 1000);

      await db.insert(openSessions).values({
        docId: doc.id,
        recipientId: user.id,
        sessionId,
        wmCode,
        challenge,
        seq: head.seq,
        prevHash: head.prevRecordHash,
        status: 'begun',
        expiresAt,
      });
      await writeAudit(db, user.id, 'open.begin', {
        documentId: doc.id,
        sessionId,
        seq: head.seq,
      });

      const presigned = await presignGet(config, doc.ciphertextKey, config.presignGetSeconds);
      const { url, path } = signedPaths(presigned);

      return {
        sessionId,
        wmCode,
        challenge,
        seq: head.seq,
        prevRecordHash: head.prevRecordHash,
        expiresAt: toIso(expiresAt),
        docId: doc.id,
        docVersion: doc.version,
        docCiphertextSha256: doc.ciphertextSha256,
        viewMode: doc.viewMode as 'VIEW_ONLY' | 'DOWNLOAD',
        recipientId: user.id,
        grant: {
          kemCt: grant.kemCt,
          encDekNonce: grant.wrapNonce,
          encDek: grant.wrappedDek,
        },
        ciphertextUrl: url,
        ciphertextPath: path,
        sizeBytes: doc.sizeBytes,
      };
    },
  );

  /**
   * POST /documents/:id/open/commit — verify the signed record against the
   * spec §6 order, commit to the ledger, and only then release keyWm.
   *
   *  session exists / not expired / not used
   *  → challenge + wmCode match
   *  → user owns the recipient key
   *  → key not revoked
   *  → grant active
   *  → seq + prevRecordHash current (else 409 CHAIN_MOVED)
   *  → ML-DSA signature over domain || JCS(record)
   *  → clientTime within ±10 minutes
   *  → commit with idempotencyKey = sessionId
   */
  app.post<{ Params: { id: string } }>(
    '/documents/:id/open/commit',
    { onRequest: app.authenticate },
    async (req): Promise<OpenCommitResponse> => {
      const user = requireUser(req);
      const doc = await loadDoc(db, req.params.id);
      if (doc.orgId !== user.orgId) throw notFound('Document not found');
      const body = validate(OpenCommitRequestSchema, req.body);
      const record = body.record;

      // Record must be about this document and this viewer's org/view mode.
      if (record.docId !== doc.id) throw badRequest('record.docId mismatch');
      if (record.orgId !== doc.orgId) throw badRequest('record.orgId mismatch');
      if (record.docVersion !== doc.version) throw badRequest('record.docVersion mismatch');
      if (record.viewMode !== doc.viewMode) throw badRequest('record.viewMode mismatch');
      if (doc.ciphertextSha256 && record.docCiphertextSha256 !== doc.ciphertextSha256) {
        throw badRequest('record.docCiphertextSha256 mismatch');
      }

      // 1. session exists, belongs to this doc + this user, not expired, unused
      const sRows = await db
        .select()
        .from(openSessions)
        .where(eq(openSessions.sessionId, record.sessionId))
        .limit(1);
      const session = sRows[0];
      if (!session || session.docId !== doc.id || session.recipientId !== user.id) {
        throw notFound('Open session not found');
      }
      if (session.status === 'committed') throw sessionUsed();
      if (session.status !== 'begun') throw sessionUsed(`Session is ${session.status}`);
      if (session.expiresAt.getTime() < Date.now()) throw sessionExpired();

      // 2. challenge + wmCode match the session we issued
      if (record.challenge !== session.challenge || record.wmCode !== session.wmCode) {
        throw challengeMismatch();
      }
      if (record.recipientId !== user.id || record.recipientId !== session.recipientId) {
        throw badRequest('record.recipientId is not the session owner');
      }

      // 3+4. user owns the recipient key; 4. key not revoked
      const anyKeyRows = await db
        .select()
        .from(userKeys)
        .where(eq(userKeys.userId, user.id))
        .limit(1);
      const keyRow = anyKeyRows[0];
      if (!keyRow) throw badRequest('No signing key registered');
      if (keyRow.status !== 'active') throw keyRevoked();
      if (keyRow.sigFp !== record.recipientSigKeyFp) {
        throw badSignature('record.recipientSigKeyFp does not match your registered key');
      }

      // 5. grant active
      const grant = await myGrant(db, doc.id, user.id);
      if (!grant || grant.status !== 'active') throw grantInactive();

      // 6. seq + prevRecordHash current against the ledger (fail closed)
      const head = await chainHead(doc.id);
      if (record.seq !== head.seq || record.prevRecordHash !== head.prevRecordHash) {
        throw chainMoved(
          `Record chain is stale: record seq=${record.seq} prev=${record.prevRecordHash?.slice(0, 12) ?? 'null'}, ` +
            `ledger head seq=${head.seq} prev=${head.prevRecordHash?.slice(0, 12) ?? 'null'}`,
        );
      }

      // 7. ML-DSA-65 signature over domain || JCS(record)
      let sigOk = false;
      try {
        sigOk = verify(DOMAIN.decryption, canonicalize(record), fromBase64(body.sig), fromBase64(keyRow.sigPk));
      } catch {
        sigOk = false;
      }
      if (!sigOk) throw badSignature();

      // 8. clientTime within ±10 minutes of server time
      const clientMs = Date.parse(record.clientTime);
      if (!Number.isFinite(clientMs)) throw badRequest('record.clientTime is not ISO-8601');
      if (Math.abs(clientMs - Date.now()) > CLOCK_SKEW_MS) {
        throw badRequest('record.clientTime is outside the ±10 minute window');
      }

      // Commit FIRST — fail closed — then release the watermark key.
      const payload = canonicalize({ record, alg: 'ML-DSA-65', sig: body.sig });
      const ledger = getLedger();
      let ref;
      try {
        ref = await ledger.commit({
          kind: 'decryption_event',
          attributes: {
            schema: record.schema,
            org_id: record.orgId,
            doc_id: record.docId,
            doc_hash: record.docCiphertextSha256,
            recipient_id: record.recipientId,
            wm_code: record.wmCode,
            session_id: record.sessionId,
            seq: record.seq,
            ts: Date.now(),
          },
          payload,
          retentionSeconds: config.retentionSeconds,
          readOnly: true,
          payloadMode: 'plain',
          idempotencyKey: record.sessionId,
        });
      } catch (err) {
        throw ledgerUnavailable(`Ledger commit failed: ${(err as Error).message}`);
      }

      await db
        .update(openSessions)
        .set({ status: 'committed', ledgerEntityKey: ref.entityKey, committedAt: new Date() })
        .where(eq(openSessions.id, session.id));
      await writeAudit(db, user.id, 'open.commit', {
        documentId: doc.id,
        sessionId: record.sessionId,
        entityKey: ref.entityKey,
      });

      // Release: per-document watermark key, derived never stored on chain.
      const keyWm = bytesToHex(wmKeyFor(doc.id, config.wmMaster));
      return {
        entityKey: ref.entityKey,
        txHash: ref.txHash ?? null,
        committedAt: ref.committedAt,
        seq: record.seq,
        prevRecordHash: record.prevRecordHash,
        keyWm,
        gateMode: config.gateMode,
        ledger: await ledgerStatus(config),
      };
    },
  );
}
