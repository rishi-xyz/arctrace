import type { FastifyInstance } from 'fastify';
import {
  DOMAIN,
  DocManifestSchema,
  GrantEventSchema,
  KeyRegistrationSchema,
  SignedDecryptionRecordSchema,
} from '@arctrace/shared';
import { canonicalize, fingerprint, fromBase64, sha256Hex, verify } from '@arctrace/crypto';
import { requireUser } from '../lib/auth.js';
import { ledgerUnavailable } from '../lib/errors.js';
import { getLedger, trustedWriters } from '../lib/ledger.js';
import { ledgerStatus } from '../lib/status.js';
import type { LedgerEntity } from '@arctrace/ledger';
import type { Ctx } from '../types.js';

type Check = { name: string; ok: boolean; detail: string };

const KIND_BY_SCHEMA: Record<string, string> = {
  'arctrace.decryption/1': 'decryption_event',
  'arctrace.keyreg/1': 'key_registration',
  'arctrace.manifest/1': 'doc_manifest',
  'arctrace.grant/1': 'grant_event',
};

function utf8(payload: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
}

export async function ledgerRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const { config } = ctx;

  /** Ledger panel data for the UI (spec §6 status surface). */
  app.get('/ledger/status', { onRequest: app.authenticate }, async () =>
    ledgerStatus(config),
  );

  /**
   * GET /ledger/verify/:entityKey — re-fetch an entity and verify creator
   * trust + record signature against the registered key (spec §6).
   */
  app.get<{ Params: { entityKey: string } }>(
    '/ledger/verify/:entityKey',
    { onRequest: app.authenticate },
    async (req) => {
      requireUser(req);
      const key = req.params.entityKey;
      const ledger = getLedger();
      const writers = trustedWriters().map((w) => w.toLowerCase());
      const checks: Check[] = [];

      let entity: LedgerEntity | null = null;
      try {
        entity = await ledger.getByKey(key);
      } catch (err) {
        throw ledgerUnavailable(`Ledger read failed: ${(err as Error).message}`);
      }
      if (!entity) {
        checks.push({ name: 'entity found', ok: false, detail: 'no entity with this key' });
        return {
          entityKey: key,
          found: false,
          creator: null,
          trustedCreator: false,
          kind: null,
          checks,
        };
      }
      checks.push({ name: 'entity found', ok: true, detail: `creator ${entity.creator}` });

      const trustedCreator = writers.includes(entity.creator.toLowerCase());
      checks.push({
        name: 'creator in trusted set',
        ok: trustedCreator,
        detail: trustedCreator ? entity.creator : `${entity.creator} is not a trusted writer`,
      });

      const schema = String(entity.attributes.schema ?? '');
      const kind = KIND_BY_SCHEMA[schema] ?? null;
      checks.push({
        name: 'record kind recognised',
        ok: kind !== null,
        detail: kind ?? `unknown schema "${schema}"`,
      });
      checks.push({
        name: 'payload sha256',
        ok: true,
        detail: sha256Hex(entity.payload),
      });

      const json = utf8(entity.payload);
      let sigOk = false;
      let signerFp: string | null = null;
      let domain: string | null = null;
      let coreBytes: Uint8Array | null = null;
      let sigB64: string | null = null;

      const signed = SignedDecryptionRecordSchema.safeParse(json);
      const keyreg = KeyRegistrationSchema.safeParse(json);
      const manifest = DocManifestSchema.safeParse(json);
      const grant = GrantEventSchema.safeParse(json);
      const parsed =
        signed.success || keyreg.success || manifest.success || grant.success;
      checks.push({
        name: 'payload parses under a record schema',
        ok: parsed,
        detail: parsed ? 'schema OK' : 'payload does not match any ArcTrace record schema',
      });

      if (parsed) {
        if (signed.success) {
          domain = DOMAIN.decryption;
          coreBytes = canonicalize(signed.data.record);
          sigB64 = signed.data.sig;
          signerFp = signed.data.record.recipientSigKeyFp;
        } else if (keyreg.success) {
          domain = DOMAIN.keyreg;
          const { sig, signerKeyFp: _skf, ...core } = keyreg.data;
          coreBytes = canonicalize(core);
          sigB64 = sig;
          signerFp = keyreg.data.sigFp;
        } else if (manifest.success) {
          domain = DOMAIN.manifest;
          const { sig, ...core } = manifest.data;
          coreBytes = canonicalize(core);
          sigB64 = sig;
          signerFp = manifest.data.signerKeyFp;
        } else if (grant.success) {
          domain = DOMAIN.grant;
          const { sig, ...core } = grant.data;
          coreBytes = canonicalize(core);
          sigB64 = grant.data.sig;
          signerFp = grant.data.signerKeyFp;
        }
      }

      let pkFound = false;
      if (signerFp) {
        try {
          const kr = await ledger.query(
            'key_registration',
            { key_fp: signerFp },
            { creators: writers, limit: 5 },
          );
          const krJson = kr.items[0] ? utf8(kr.items[0].payload) : null;
          const krParsed = KeyRegistrationSchema.safeParse(krJson);
          if (krParsed.success) {
            const pk = fromBase64(krParsed.data.sigPk);
            pkFound = fingerprint(pk) === signerFp;
            checks.push({
              name: 'signer key found via key_registration',
              ok: pkFound,
              detail: pkFound ? `key_fp ${signerFp.slice(0, 16)}…` : 'fingerprint mismatch',
            });
            if (pkFound && domain && coreBytes && sigB64) {
              sigOk = verify(domain, coreBytes, fromBase64(sigB64), pk);
            }
          }
        } catch {
          pkFound = false;
        }
        if (!checks.some((c) => c.name === 'signer key found via key_registration')) {
          checks.push({
            name: 'signer key found via key_registration',
            ok: false,
            detail: 'no key_registration for this fingerprint',
          });
        }
      }
      checks.push({
        name: 'ML-DSA-65 signature verifies',
        ok: sigOk,
        detail: sigOk ? 'signature valid over JCS(core)' : 'signature verification failed',
      });

      return {
        entityKey: key,
        found: true,
        creator: entity.creator,
        trustedCreator,
        kind,
        checks,
      };
    },
  );
}
