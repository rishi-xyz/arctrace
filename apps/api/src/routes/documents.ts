import type { RouteApp } from '../compat.js';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import {
  DOMAIN,
  EncBlobSchema,
  FinalizeDocumentRequestSchema,
  CreateDocumentRequestSchema,
  GrantInputSchema,
  type DocumentDetail,
  type DocumentSummary,
  type FinalizeDocumentResponse,
} from '@arctrace/shared';
import { z } from 'zod';
import { canonicalize, fromBase64, sha256Hex, verify } from '@arctrace/crypto';
import { documents, grants, ledgerOutbox, openSessions, userKeys, users } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { requireUser } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { outboxRow } from '../lib/outbox.js';
import { getObject, presignPut, signedPaths } from '../lib/s3.js';
import { validate } from '../lib/validate.js';
import { documentDetail, documentSummary, loadDoc, requireRole } from './helpers.js';
import type { Ctx } from '../types.js';

/** Revocation body: a signed grant_event with action="revoke". */
const RevokeGrantRequestSchema = z
  .object({ ts: z.string(), sig: z.string().min(1) })
  .strict();
export type RevokeGrantRequest = z.infer<typeof RevokeGrantRequestSchema>;

const GRANT_SCHEMA = 'arctrace.grant/1';

export async function documentRoutes(app: RouteApp, ctx: Ctx): Promise<void> {
  const { db, config } = ctx;

  async function senderKeys(senderId: string) {
    const rows = await db
      .select()
      .from(userKeys)
      .where(and(eq(userKeys.userId, senderId), eq(userKeys.status, 'active')))
      .limit(1);
    if (!rows[0]) throw badRequest('Sender has no active signing key');
    return rows[0];
  }

  /**
   * POST /documents — allocate a doc id and a presigned upload URL (spec §6).
   * The ciphertext goes straight from the browser to object storage; the API
   * only ever sees ciphertext.
   */
  app.post('/documents', { onRequest: app.authenticate }, async (req, reply): Promise<{
    docId: string;
    uploadUrl: string;
    uploadPath: string;
    expiresAt: string;
  }> => {
    const user = requireUser(req);
    requireRole(user, 'sender', 'admin');
    const body = validate(CreateDocumentRequestSchema, req.body);

    const docId = randomUUID();
    const ciphertextKey = `docs/${user.orgId}/${docId}/ct.bin`;
    await db.insert(documents).values({
      id: docId,
      orgId: user.orgId,
      senderId: user.id,
      version: 1,
      ciphertextKey,
      sizeBytes: body.sizeBytes,
      viewMode: body.viewMode,
      status: 'uploading',
    });
    await writeAudit(db, user.id, 'document.upload', { documentId: docId });

    const presigned = await presignPut(config, ciphertextKey, config.presignPutSeconds);
    const { url, path } = signedPaths(presigned);
    reply.status(201);
    return {
      docId,
      uploadUrl: url,
      uploadPath: path,
      expiresAt: new Date(Date.now() + config.presignPutSeconds * 1000).toISOString(),
    };
  });

  /** GET /documents — my documents (as sender or recipient), same org. */
  app.get('/documents', { onRequest: app.authenticate }, async (req): Promise<DocumentSummary[]> => {
    const user = requireUser(req);
    const rows = await db
      .select({ doc: documents })
      .from(documents)
      .leftJoin(
        grants,
        and(eq(grants.docId, documents.id), eq(grants.recipientId, user.id)),
      )
      .where(
        and(
          eq(documents.orgId, user.orgId),
          or(eq(documents.senderId, user.id), isNotNull(grants.id)),
        ),
      )
      .orderBy(desc(documents.createdAt));
    return Promise.all(rows.map((r) => documentSummary(db, r.doc, user)));
  });

  /** Committed opens visible to the sender, org admins, and each recipient's own history. */
  app.get('/activity', { onRequest: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const scope = user.role === 'admin'
      ? eq(documents.orgId, user.orgId)
      : and(
          eq(documents.orgId, user.orgId),
          or(eq(documents.senderId, user.id), eq(openSessions.recipientId, user.id)),
        );
    const rows = await db
      .select({
        id: openSessions.id,
        documentId: openSessions.docId,
        recipientId: openSessions.recipientId,
        recipientName: users.displayName,
        committedAt: openSessions.committedAt,
        entityKey: openSessions.ledgerEntityKey,
        senderId: documents.senderId,
      })
      .from(openSessions)
      .innerJoin(documents, eq(documents.id, openSessions.docId))
      .innerJoin(users, eq(users.id, openSessions.recipientId))
      .where(and(scope, eq(openSessions.status, 'committed'), isNotNull(openSessions.committedAt)))
      .orderBy(desc(openSessions.committedAt))
      .limit(200);
    return rows.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      recipientId: row.recipientId,
      recipientName: row.recipientName,
      openedAt: row.committedAt!.toISOString(),
      entityKey: row.entityKey,
      openedByMe: row.recipientId === user.id,
    }));
  });

  app.get<{ Params: { id: string } }>(
    '/documents/:id',
    { onRequest: app.authenticate },
    async (req): Promise<DocumentDetail> => {
      const user = requireUser(req);
      const doc = await loadDoc(db, req.params.id);
      if (doc.orgId !== user.orgId) throw notFound('Document not found');
      const isSender = doc.senderId === user.id;
      const g = await db
        .select({ id: grants.id })
        .from(grants)
        .where(and(eq(grants.docId, doc.id), eq(grants.recipientId, user.id)))
        .limit(1);
      if (!isSender && !g[0] && user.role !== 'admin') {
        throw forbidden('No access to this document');
      }
      return documentDetail(db, doc, user);
    },
  );

  /**
   * POST /documents/:id/finalize — verify manifest + grants, hash the stored
   * ciphertext, persist state and enqueue ledger intents in ONE transaction
   * (spec §6; ledger relay is the worker's outbox drain).
   */
  app.post<{ Params: { id: string } }>(
    '/documents/:id/finalize',
    { onRequest: app.authenticate },
    async (req, reply): Promise<FinalizeDocumentResponse> => {
      const user = requireUser(req);
      const doc = await loadDoc(db, req.params.id);
      if (doc.senderId !== user.id) throw forbidden('Only the sender can finalize');
      if (doc.status === 'ready') throw conflict('Document already finalized');
      if (doc.status !== 'uploading') throw conflict(`Document is ${doc.status}`);
      const body = validate(FinalizeDocumentRequestSchema, req.body);
      const { manifest, senderSig, grants: grantInputs, titleEnc } = body;

      // --- manifest field consistency with server-side state -----------------
      if (manifest.docId !== doc.id) throw badRequest('manifest.docId mismatch');
      if (manifest.orgId !== doc.orgId) throw badRequest('manifest.orgId mismatch');
      if (manifest.senderId !== doc.senderId) throw badRequest('manifest.senderId mismatch');
      if (manifest.version !== doc.version) throw badRequest('manifest.version mismatch');
      if (manifest.viewMode !== doc.viewMode) throw badRequest('manifest.viewMode mismatch');
      if (titleEnc !== null) validate(EncBlobSchema, titleEnc, 'titleEnc');

      // --- ciphertext really is what the manifest claims (fail closed) -------
      const ct = await getObject(config, doc.ciphertextKey);
      if (!ct || ct.length === 0) throw badRequest('Ciphertext not uploaded yet');
      if (ct.length > doc.sizeBytes) {
        throw badRequest(`Ciphertext ${ct.length} B exceeds declared ${doc.sizeBytes} B`);
      }
      const actualSha = sha256Hex(ct);
      if (actualSha !== manifest.ciphertextSha256) {
        throw badRequest('manifest.ciphertextSha256 does not match uploaded ciphertext');
      }

      // --- manifest signature (sender's ML-DSA key) --------------------------
      const keys = await senderKeys(doc.senderId);
      if (manifest.signerKeyFp !== keys.sigFp) throw badRequest('manifest.signerKeyFp mismatch');
      let manifestOk = false;
      try {
        manifestOk = verify(
          DOMAIN.manifest,
          canonicalize(manifest),
          fromBase64(senderSig),
          fromBase64(keys.sigPk),
        );
      } catch {
        manifestOk = false;
      }
      if (!manifestOk) throw badRequest('Invalid manifest signature');

      // --- recipient set matches the manifest commitment --------------------
      const recipientIds = grantInputs.map((g) => g.recipientId);
      if (new Set(recipientIds).size !== recipientIds.length) {
        throw badRequest('Duplicate recipients in grants');
      }
      const expectedSetHash = sha256Hex(new TextEncoder().encode([...recipientIds].sort().join('|')));
      if (manifest.recipientSetHash !== expectedSetHash) {
        throw badRequest('manifest.recipientSetHash does not match grants');
      }

      // --- every recipient exists in-org with active keys; sigs verify ------
      const recipientRows = await db
        .select({ id: users.id, orgId: users.orgId })
        .from(users)
        .where(inArray(users.id, recipientIds));
      const keyRows = await db
        .select({ userId: userKeys.userId, status: userKeys.status })
        .from(userKeys)
        .where(inArray(userKeys.userId, recipientIds));
      const orgSet = new Set(recipientRows.filter((u) => u.orgId === doc.orgId).map((u) => u.id));
      const activeSet = new Set(keyRows.filter((r) => r.status === 'active').map((r) => r.userId));
      for (const id of recipientIds) {
        if (!orgSet.has(id)) throw badRequest(`Recipient ${id} not found in this organisation`);
        if (!activeSet.has(id)) throw badRequest(`Recipient ${id} has no active keys`);
      }
      for (const g of grantInputs) {
        await verifyGrantSigFor(doc.id, doc.orgId, keys, g, 'grant');
      }

      // --- persist + enqueue intents atomically -----------------------------
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(documents)
          .set({
            status: 'ready',
            titleEnc: titleEnc ? JSON.stringify(titleEnc) : null,
            ciphertextSha256: actualSha,
            finalizedAt: new Date(),
          })
          .where(and(eq(documents.id, doc.id), eq(documents.status, 'uploading')))
          .returning({ id: documents.id });
        if (updated.length !== 1) throw conflict('Document already finalized');

        await tx.insert(grants).values(
          grantInputs.map((g) => ({
            docId: doc.id,
            recipientId: g.recipientId,
            kemCt: g.kemCt,
            wrappedDek: g.encDek,
            wrapNonce: g.encDekNonce,
            status: 'active',
          })),
        );

        await tx.insert(ledgerOutbox).values([
          outboxRow(
            'doc_manifest',
            `manifest-${doc.id}`,
            { ...manifest, sig: senderSig },
            {
              schema: manifest.schema,
              org_id: doc.orgId,
              doc_id: doc.id,
              doc_hash: actualSha,
              ts: Date.now(),
            },
          ),
          ...grantInputs.map((g) =>
            outboxRow(
              'grant_event',
              `grant-${doc.id}-${g.recipientId}-${g.ts}`,
              { ...rebuildGrantCore(doc.id, doc.orgId, keys.sigFp, g, 'grant'), sig: g.sig },
              {
                schema: GRANT_SCHEMA,
                org_id: doc.orgId,
                doc_id: doc.id,
                recipient_id: g.recipientId,
                action: 'grant',
                ts: Date.now(),
              },
            ),
          ),
        ]);
      });
      await writeAudit(db, user.id, 'document.finalize', {
        documentId: doc.id,
        recipients: recipientIds.length,
      });

      const fresh = await loadDoc(db, doc.id);
      reply.status(201);
      return { document: await documentDetail(db, fresh, user) };
    },
  );

  /** POST /documents/:id/grants — add recipients to a ready document. */
  app.post<{ Params: { id: string } }>(
    '/documents/:id/grants',
    { onRequest: app.authenticate },
    async (req, reply): Promise<DocumentDetail> => {
      const user = requireUser(req);
      const doc = await loadDoc(db, req.params.id);
      if (doc.senderId !== user.id) throw forbidden('Only the sender can share');
      if (doc.status !== 'ready') throw conflict('Document is not ready to share');
      const body = validate(z.object({ grants: z.array(GrantInputSchema).min(1).max(50) }).strict(), req.body);
      const keys = await senderKeys(doc.senderId);

      for (const g of body.grants) {
        const targetUser = await db
          .select({ id: users.id, orgId: users.orgId })
          .from(users)
          .where(eq(users.id, g.recipientId))
          .limit(1);
        if (!targetUser[0] || targetUser[0].orgId !== doc.orgId) {
          throw badRequest(`Recipient ${g.recipientId} not found in this organisation`);
        }
        const target = await db
          .select({ id: userKeys.userId, status: userKeys.status })
          .from(userKeys)
          .where(eq(userKeys.userId, g.recipientId))
          .limit(1);
        if (!target[0] || target[0].status !== 'active') {
          throw badRequest(`Recipient ${g.recipientId} has no active keys`);
        }
        await verifyGrantSigFor(doc.id, doc.orgId, keys, g, 'grant');
        const existing = await db
          .select({ id: grants.id, status: grants.status })
          .from(grants)
          .where(and(eq(grants.docId, doc.id), eq(grants.recipientId, g.recipientId)))
          .limit(1);
        if (existing[0]?.status === 'active') throw conflict(`Already shared with ${g.recipientId}`);
      }

      await db.transaction(async (tx) => {
        for (const g of body.grants) {
          await tx
            .insert(grants)
            .values({
              docId: doc.id,
              recipientId: g.recipientId,
              kemCt: g.kemCt,
              wrappedDek: g.encDek,
              wrapNonce: g.encDekNonce,
              status: 'active',
              revokedAt: null,
            })
            .onConflictDoUpdate({
              target: [grants.docId, grants.recipientId],
              set: {
                kemCt: g.kemCt,
                wrappedDek: g.encDek,
                wrapNonce: g.encDekNonce,
                status: 'active',
                revokedAt: null,
                ledgerEntityKey: null,
              },
            });
          await tx.insert(ledgerOutbox).values(
            outboxRow(
              'grant_event',
              `grant-${doc.id}-${g.recipientId}-${g.ts}`,
              { ...rebuildGrantCore(doc.id, doc.orgId, keys.sigFp, g, 'grant'), sig: g.sig },
              {
                schema: GRANT_SCHEMA,
                org_id: doc.orgId,
                doc_id: doc.id,
                recipient_id: g.recipientId,
                action: 'grant',
                ts: Date.now(),
              },
            ),
          );
        }
      });
      await writeAudit(db, user.id, 'document.share', {
        documentId: doc.id,
        recipients: body.grants.map((g) => g.recipientId),
      });
      const fresh = await loadDoc(db, doc.id);
      return documentDetail(db, fresh, user);
    },
  );

  /** DELETE /documents/:id/grants/:recipientId — signed revoke event. */
  app.delete<{ Params: { id: string; recipientId: string } }>(
    '/documents/:id/grants/:recipientId',
    { onRequest: app.authenticate },
    async (req): Promise<DocumentDetail> => {
      const user = requireUser(req);
      const doc = await loadDoc(db, req.params.id);
      if (doc.senderId !== user.id) throw forbidden('Only the sender can revoke');
      const body = validate(RevokeGrantRequestSchema, req.body);
      const keys = await senderKeys(doc.senderId);

      const rows = await db
        .select()
        .from(grants)
        .where(and(eq(grants.docId, doc.id), eq(grants.recipientId, req.params.recipientId)))
        .limit(1);
      const grant = rows[0];
      if (!grant) throw notFound('Grant not found');
      if (grant.status === 'revoked') throw conflict('Grant already revoked');

      const core = rebuildGrantCore(
        doc.id,
        doc.orgId,
        keys.sigFp,
        { recipientId: req.params.recipientId, ts: body.ts, sig: body.sig },
        'revoke',
      );
      let ok = false;
      try {
        ok = verify(DOMAIN.grant, canonicalize(core), fromBase64(body.sig), fromBase64(keys.sigPk));
      } catch {
        ok = false;
      }
      if (!ok) throw badRequest('Invalid revoke signature');

      await db.transaction(async (tx) => {
        await tx
          .update(grants)
          .set({ status: 'revoked', revokedAt: new Date() })
          .where(and(eq(grants.docId, doc.id), eq(grants.recipientId, req.params.recipientId)));
        await tx.insert(ledgerOutbox).values(
          outboxRow(
            'grant_event',
            `revoke-${doc.id}-${req.params.recipientId}-${body.ts}`,
            { ...core, sig: body.sig },
            {
              schema: GRANT_SCHEMA,
              org_id: doc.orgId,
              doc_id: doc.id,
              recipient_id: req.params.recipientId,
              action: 'revoke',
              ts: Date.now(),
            },
          ),
        );
      });
      await writeAudit(db, user.id, 'document.revoke_grant', {
        documentId: doc.id,
        recipientId: req.params.recipientId,
      });
      const fresh = await loadDoc(db, doc.id);
      return documentDetail(db, fresh, user);
    },
  );
}

/** Exact GrantEventCore object the client signs (action-dependent). */
function rebuildGrantCore(
  docId: string,
  orgId: string,
  signerKeyFp: string,
  g: { recipientId: string; ts: string; sig?: string },
  action: 'grant' | 'revoke',
) {
  return {
    schema: GRANT_SCHEMA,
    orgId,
    ts: g.ts,
    docId,
    recipientId: g.recipientId,
    action,
    signerKeyFp,
  } as const;
}

async function verifyGrantSigFor(
  docId: string,
  orgId: string,
  keys: { sigFp: string; sigPk: string },
  g: { recipientId: string; ts: string; sig: string },
  action: 'grant' | 'revoke',
): Promise<void> {
  const core = rebuildGrantCore(docId, orgId, keys.sigFp, g, action);
  let ok = false;
  try {
    ok = verify(DOMAIN.grant, canonicalize(core), fromBase64(g.sig), fromBase64(keys.sigPk));
  } catch {
    ok = false;
  }
  if (!ok) throw badRequest(`Invalid grant signature for ${action} of ${g.recipientId}`);
}
