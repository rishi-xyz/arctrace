import { z } from 'zod';
import { strFromU8, unzipSync } from 'fflate';
import { createAdapterFromEnv, resolveTrustedWriters } from '@arctrace/ledger';
import { DOMAIN, EvidenceBundleSchema, KeyRegistrationSchema, SignedDecryptionRecordSchema } from '@arctrace/shared';
import { canonicalize, fingerprint, fromBase64, sha256Hex, verify } from '@arctrace/crypto';

type Check = { name: string; ok: boolean; detail: string };
export type VerificationResult = { valid: boolean; mode: 'offline' | 'online'; checks: Check[] };

function proofJson(proof: unknown, name: string): { key: string; creator: string; readOnly: boolean; attributes: Record<string, string | number>; payloadB64: string } {
  const schema = z.object({
    key: z.string(), creator: z.string(), readOnly: z.boolean(),
    attributes: z.record(z.string(), z.union([z.string(), z.number()])), payloadB64: z.string(),
  }).passthrough();
  try { return schema.parse(proof); }
  catch { throw new Error(`Invalid ${name} proof.`); }
}

function recordKeyRegistration(proof: unknown, name: string) {
  const entity = proofJson(proof, name);
  const payload = KeyRegistrationSchema.parse(JSON.parse(strFromU8(fromBase64(entity.payloadB64))));
  const { sig, signerKeyFp: _signerKeyFp, ...core } = payload;
  const pk = fromBase64(payload.sigPk);
  return {
    entity,
    payload,
    valid: fingerprint(pk) === payload.sigFp && verify(DOMAIN.keyreg, canonicalize(core), fromBase64(sig), pk),
  };
}

export async function verifyBundleZip(bytes: Uint8Array, options: { online?: boolean } = {}): Promise<VerificationResult> {
  const files = unzipSync(bytes);
  const bundleFile = files['bundle.json'];
  const proofsFile = files['proofs/decryption_record.json'];
  const investigatorProofFile = files['proofs/investigator_key_registration.json'];
  const recipientProofFile = files['proofs/key_registration.json'];
  if (!bundleFile || !proofsFile || !investigatorProofFile || !recipientProofFile) {
    throw new Error('Bundle is missing a required proof file.');
  }
  const bundle = EvidenceBundleSchema.parse(JSON.parse(strFromU8(bundleFile)));
  const { investigatorSig, ...core } = bundle;
  const proofs = {
    decryptionRecord: proofJson(JSON.parse(strFromU8(proofsFile)), 'decryption record'),
    investigatorKeyRegistration: JSON.parse(strFromU8(investigatorProofFile)),
    keyRegistration: JSON.parse(strFromU8(recipientProofFile)),
    manifest: files['proofs/manifest.json'] ? JSON.parse(strFromU8(files['proofs/manifest.json'])) : null,
  };
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); };

  const hashes = core.proofHashes as Record<string, string | null> | undefined;
  for (const [name, proof] of Object.entries(proofs)) {
    const expected = hashes?.[name];
    const actual = proof === null ? null : sha256Hex(canonicalize(proof));
    check(`proof hash: ${name}`, expected === actual, expected === actual ? 'matches signed bundle core' : 'proof hash mismatch');
  }

  const investigator = recordKeyRegistration(proofs.investigatorKeyRegistration, 'investigator key registration');
  check('investigator key registration', investigator.valid, investigator.valid ? 'registration signature and fingerprint valid' : 'invalid key registration');
  check('investigator registration creator', investigator.entity.creator === proofs.decryptionRecord.creator && investigator.entity.readOnly, 'key registration uses the decryption record writer and is read-only');
  const investigatorSigOk = investigatorSig.alg === 'ML-DSA-65'
    && investigatorSig.signerKeyFp === investigator.payload.sigFp
    && verify(DOMAIN.bundle, canonicalize(core), fromBase64(investigatorSig.sig), fromBase64(investigator.payload.sigPk));
  check('investigator signature', investigatorSigOk, investigatorSigOk ? 'bundle core signed by registered investigator key' : 'invalid investigator signature');

  const recipient = recordKeyRegistration(proofs.keyRegistration, 'recipient key registration');
  check('recipient key registration', recipient.valid, recipient.valid ? 'registration signature and fingerprint valid' : 'invalid key registration');
  check('recipient registration creator', recipient.entity.creator === proofs.decryptionRecord.creator && recipient.entity.readOnly, 'key registration uses the decryption record writer and is read-only');
  const signedRecord = SignedDecryptionRecordSchema.parse(core.record);
  const recordSigOk = recipient.payload.sigFp === signedRecord.record.recipientSigKeyFp
    && verify(DOMAIN.decryption, canonicalize(signedRecord.record), fromBase64(signedRecord.sig), fromBase64(recipient.payload.sigPk));
  check('recipient record signature', recordSigOk, recordSigOk ? 'ML-DSA-65 signature valid' : 'invalid recipient signature');

  const recordEntityPayload = JSON.parse(strFromU8(fromBase64(proofs.decryptionRecord.payloadB64)));
  const entityKey = String(core.entityKey ?? '');
  const proofMatches = new TextDecoder().decode(canonicalize(recordEntityPayload)) === new TextDecoder().decode(canonicalize(signedRecord));
  check('decryption record payload', proofs.decryptionRecord.key === entityKey && proofMatches, proofMatches ? 'proof payload matches signed record' : 'proof payload mismatch');
  const creatorMatches = proofs.decryptionRecord.creator === core.creator;
  check('ledger creator', creatorMatches, creatorMatches ? 'creator matches bundle record' : 'creator mismatch');
  check('record is read-only', proofs.decryptionRecord.readOnly, proofs.decryptionRecord.readOnly ? 'read-only flag is set' : 'record is mutable');

  let mode: 'offline' | 'online' = 'offline';
  if (options.online) {
    const choice = await createAdapterFromEnv({
      mode: process.env.LEDGER_MODE,
      mockFile: process.env.MOCK_LEDGER_FILE ?? `${process.cwd()}/.data/mock-ledger.json`,
    });
    mode = 'online';
    const live = await choice.adapter.getByKey(entityKey);
    const writers = resolveTrustedWriters(choice.adapter).map((writer) => writer.toLowerCase());
    const livePayload = live ? canonicalize(JSON.parse(strFromU8(live.payload))) : null;
    const expectedPayload = canonicalize(signedRecord);
    const liveMatches = Boolean(live && live.creator.toLowerCase() === proofs.decryptionRecord.creator.toLowerCase()
      && writers.includes(live.creator.toLowerCase())
      && live.readOnly && livePayload && Buffer.from(livePayload).equals(Buffer.from(expectedPayload)));
    check(`online ledger (${choice.mode})`, liveMatches, liveMatches ? 'entity exists with matching payload and trusted creator' : 'entity missing or does not match');
  }

  return { valid: checks.every((item) => item.ok), mode, checks };
}
