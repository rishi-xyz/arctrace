import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  BundleResponseSchema,
  TraceResultSchema,
  TraceStatusResponseSchema,
  type TraceStatusResponse,
} from '@arctrace/shared';
import { toBase64 } from '@arctrace/crypto';
import { traces } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { requireUser } from '../lib/auth.js';
import { badRequest, conflict, ledgerUnavailable, notFound } from '../lib/errors.js';
import { getLedger, trustedWriters } from '../lib/ledger.js';
import { putObject, sha256Hex } from '../lib/s3.js';
import { requireRole, toIso } from './helpers.js';
import type { Ctx } from '../types.js';
import type { LedgerEntity } from '@arctrace/ledger';

const EXT_BY_NAME: Record<string, {ext: string; kind: 'png' | 'jpeg' | 'pdf' | 'txt'}> = {
  png: { ext: 'png', kind: 'png' },
  jpg: { ext: 'jpg', kind: 'jpeg' },
  jpeg: { ext: 'jpeg', kind: 'jpeg' },
  pdf: { ext: 'pdf', kind: 'pdf' },
  txt: { ext: 'txt', kind: 'txt' },
};

function toProof(e: LedgerEntity) {
  return {
    key: e.key,
    creator: e.creator,
    owner: e.owner,
    attributes: e.attributes,
    payloadB64: toBase64(e.payload),
    createdAt: Number(e.createdAt),
    expiresAt: Number(e.expiresAt),
    readOnly: e.readOnly,
  };
}

export async function traceRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const { db, config } = ctx;

  async function loadTraceFor(id: string, user: { id: string; orgId?: string; role: string }) {
    const rows = await db.select().from(traces).where(eq(traces.id, id)).limit(1);
    const trace = rows[0];
    if (!trace) throw notFound('Trace not found');
    if (trace.orgId !== user.orgId) throw notFound('Trace not found');
    requireRole(user as { role: string }, 'investigator', 'admin');
    return trace;
  }

  /**
   * POST /traces — upload the leaked file (multipart), store ciphertext-side
   * in object storage, enqueue processing. Only a SHA-256 of the file is kept
   * in Postgres (spec §7 traces table).
   */
  app.post('/traces', { onRequest: app.authenticate }, async (req, reply): Promise<TraceStatusResponse> => {
    const user = requireUser(req);
    requireRole(user, 'investigator', 'admin');

    const part = await req.file();
    if (!part) throw badRequest('Missing multipart file field');
    const bytes = await part.toBuffer();
    if (bytes.length === 0) throw badRequest('Empty file');
    if (bytes.length > config.traceMaxBytes) {
      throw badRequest(`File exceeds ${config.traceMaxBytes} bytes`);
    }
    const name = (part.filename ?? '').toLowerCase();
    const extKey = Object.keys(EXT_BY_NAME).find((k) => name.endsWith(`.${k}`));
    if (!extKey) throw badRequest('Unsupported file type — use .png, .jpg/.jpeg, .pdf or .txt');
    const { ext, kind } = EXT_BY_NAME[extKey]!;

    const traceId = randomUUID();
    const fileKey = `traces/${user.orgId}/${traceId}/leaked.${ext}`;
    const leakedSha256 = sha256Hex(bytes);
    await putObject(config, fileKey, bytes);

    await db.insert(traces).values({
      id: traceId,
      orgId: user.orgId,
      investigatorId: user.id,
      fileKey,
      fileKind: kind,
      leakedSha256,
      status: 'pending',
    });
    await writeAudit(db, user.id, 'trace.create', {
      traceId,
      leakedSha256,
      fileKind: kind,
    });

    reply.status(201);
    return TraceStatusResponseSchema.parse({
      traceId,
      status: 'pending',
      error: null,
      result: null,
      createdAt: toIso(new Date()),
      completedAt: null,
    });
  });

  app.get<{ Params: { id: string } }>(
    '/traces/:id',
    { onRequest: app.authenticate },
    async (req): Promise<TraceStatusResponse> => {
      const user = requireUser(req);
      const trace = await loadTraceFor(req.params.id, user);
      return TraceStatusResponseSchema.parse({
        traceId: trace.id,
        status: trace.status,
        error: trace.error,
        result: trace.resultJson ?? null,
        createdAt: toIso(trace.createdAt),
        completedAt: trace.completedAt ? toIso(trace.completedAt) : null,
      });
    },
  );

  /**
   * GET /traces/:id/bundle — evidence bundle CORE as JSON (spec §8). The
   * browser signs `core` with the investigator's ML-DSA key (DOMAIN.bundle)
   * and assembles the zip with fflate + pdf-lib, so the private key never
   * reaches the server (decision D-0xx).
   */
  app.get<{ Params: { id: string } }>(
    '/traces/:id/bundle',
    { onRequest: app.authenticate },
    async (req): Promise<unknown> => {
      const user = requireUser(req);
      const trace = await loadTraceFor(req.params.id, user);
      if (trace.status !== 'done') throw conflict(`Trace is ${trace.status}`);
      if (!trace.resultJson) throw conflict('Trace has no result');
      const result = TraceResultSchema.parse(trace.resultJson);
      if (!result.record || !result.entityKey) {
        throw conflict('No ledger record found for this trace — no evidence bundle possible');
      }
      const record = result.record;
      const rec = record.record;
      const ledger = getLedger();
      const writers = trustedWriters();

      // --- proofs (spec §8 proofs/) ----------------------------------------
      let decryptionEntity;
      try {
        decryptionEntity = await ledger.getByKey(result.entityKey);
      } catch (err) {
        throw ledgerUnavailable(`Proof fetch failed: ${(err as Error).message}`);
      }
      if (!decryptionEntity) throw conflict('Decryption record no longer on the ledger');

      let keyRegEntity: LedgerEntity | null = null;
      let manifestEntity: LedgerEntity | null = null;
      try {
        const kr = await ledger.query(
          'key_registration',
          { key_fp: rec.recipientSigKeyFp },
          { creators: writers, limit: 5 },
        );
        keyRegEntity = kr.items[0] ?? null;
        const mf = await ledger.query(
          'doc_manifest',
          { doc_id: rec.docId },
          { creators: writers, limit: 5 },
        );
        manifestEntity = mf.items[0] ?? null;
      } catch (err) {
        throw ledgerUnavailable(`Proof fetch failed: ${(err as Error).message}`);
      }

      // --- bundle core (unsigned; investigatorSig is added client-side) -----
      const createdAt = new Date().toISOString();
      const core = {
        traceId: trace.id,
        leakedFileSha256: trace.leakedSha256,
        extraction: {
          wmCode: result.extraction.wmCode,
          confidence: result.extraction.confidence,
          alignment: result.extraction.alignment,
        },
        entityKey: result.entityKey,
        record,
        signature: record.sig,
        signerKeyFp: rec.recipientSigKeyFp,
        ledgerRef: {
          entityKey: result.entityKey,
          creator: decryptionEntity.creator,
          explorerUrl: `${config.explorerUrl.replace(/\/$/, '')}/entity/${result.entityKey}`,
        },
        anchorProof: null, // anchors land in a later phase
        chainCheck: result.chain,
        query: result.query,
        checks: result.checks,
        createdAt,
        investigatorSig: null,
      };

      const recipientName = result.recipient?.displayName ?? 'unknown';
      const report = {
        title: `ArcTrace evidence — trace ${trace.id.slice(0, 8)}`,
        lines: [
          { label: 'Leaked file SHA-256', value: trace.leakedSha256 },
          { label: 'Extracted watermark code', value: result.extraction.wmCode ?? '(not found)' },
          { label: 'Extraction confidence', value: result.extraction.confidence.toFixed(3) },
          { label: 'Identified recipient', value: recipientName },
          { label: 'Recipient ID', value: result.recipient?.recipientId ?? 'n/a' },
          { label: 'Ledger entity', value: result.entityKey },
          { label: 'Chain seq', value: String(result.chain?.seq ?? 'n/a') },
          { label: 'Chain verified', value: result.chain?.prevOk && result.chain?.nextOk ? 'yes' : 'partial' },
          { label: 'Record signature', value: result.recordVerified ? 'valid' : 'INVALID' },
          { label: 'Trusted creator', value: decryptionEntity.creator },
          { label: 'Created at', value: createdAt },
          { label: 'Checks passed', value: `${result.checks.filter((c) => c.ok).length}/${result.checks.length}` },
        ],
      };

      const verifyMd = [
        `# ArcTrace evidence bundle — trace ${trace.id}`,
        ``,
        `## Contents`,
        `- \`bundle.json\` — signed evidence core (record, proofs references, checks)`,
        `- \`bundle.pdf\` — human-readable summary`,
        `- \`proofs/decryption_record.json\`, \`proofs/key_registration.json\`, \`proofs/manifest.json\` — raw ledger entities`,
        `- \`VERIFY.md\` — this file`,
        ``,
        `## Verify`,
        `\`\`\`sh`,
        `npx arctrace-verify bundle.zip          # online: re-fetches entities from Arkiv`,
        `npx arctrace-verify bundle.zip --offline # no network; signature + chain only`,
        `\`\`\``,
        `Exit code 0 only if every check passes.`,
        ``,
        `Manual: \`bundle.json\` → \`record\` is canonicalized (RFC 8785), hashed with domain`,
        `\`ARCTRACE-DECRYPT-V1\`, and verified against the ML-DSA-65 public key in`,
        `\`proofs/key_registration.json\` (fingerprint must equal \`${rec.recipientSigKeyFp}\`).`,
        ``,
        `Entity key: \`${result.entityKey}\``,
      ].join('\n');

      await writeAudit(db, user.id, 'bundle.export', { traceId: trace.id });
      return BundleResponseSchema.parse({
        core,
        proofs: {
          keyRegistration: keyRegEntity ? toProof(keyRegEntity) : null,
          manifest: manifestEntity ? toProof(manifestEntity) : null,
          decryptionRecord: toProof(decryptionEntity),
        },
        report,
        verifyMd,
      });
    },
  );
}
