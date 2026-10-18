import { DOMAIN, type SessionUser, type PublicKey } from '@arctrace/shared';
import { aesGcmEncrypt, canonicalize, fromBase64, kemEncapsulate, randomBytes, sha256Hex, sign, toBase64, wrapKey, zeroGateShare } from '@arctrace/crypto';
import { api } from './api';
import { unlockPrivateKeys } from './keys';
import { loadDocumentNames, saveDocumentName } from './document-names';

export async function shareDocument(file: File, documentName: string, recipientIds: string[], passphrase: string, user: SessionUser) {
  if (recipientIds.length === 0) throw new Error('Choose at least one recipient.');
  if (!user.hasKeys) throw new Error('Set up your post-quantum keys before sharing.');
  const privateKeys = await unlockPrivateKeys(user.id, passphrase);
  let dek: Uint8Array | undefined;
  try {
  if (file.size + 28 > 100 * 1024 * 1024) throw new Error('Encrypted file exceeds the 100 MB upload limit.');

  const keys = await api<PublicKey[]>('/keys');
  const recipientKeys = recipientIds.map((id) => {
    const key = keys.find((item) => item.userId === id && item.status === 'active');
    if (!key) throw new Error('A selected recipient does not have an active key.');
    return key;
  });

  const slot = await api<{ docId: string; uploadPath: string }>('/documents', {
    method: 'POST',
    body: JSON.stringify({ viewMode: 'VIEW_ONLY', sizeBytes: file.size + 28 }),
  });
  const docId = slot.docId;
  const aad = new TextEncoder().encode(docId);
  const documentDek = randomBytes(32);
  dek = documentDek;
  const plain = new Uint8Array(await file.arrayBuffer());
  const encryptedFile = aesGcmEncrypt(documentDek, plain, aad);
  const ciphertext = new Uint8Array(encryptedFile.nonce.length + encryptedFile.ct.length);
  ciphertext.set(encryptedFile.nonce);
  ciphertext.set(encryptedFile.ct, encryptedFile.nonce.length);
  plain.fill(0);
  const titleText = documentName.trim() || file.name;
  const title = aesGcmEncrypt(documentDek, new TextEncoder().encode(titleText), new TextEncoder().encode(`title|${docId}`));

  const upload = await fetch(slot.uploadPath, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: ciphertext,
  });
  if (!upload.ok) throw new Error('Encrypted upload failed. Check MinIO and retry.');

  const ts = new Date().toISOString();
  const grants = recipientKeys.map((recipient) => {
    const { cipherText, sharedSecret } = kemEncapsulate(fromBase64(recipient.kemPk));
    const key = wrapKey(sharedSecret, zeroGateShare(), docId);
    const wrapped = aesGcmEncrypt(key, documentDek, aad);
    const core = {
      schema: 'arctrace.grant/1' as const,
      orgId: user.orgId,
      ts,
      docId,
      recipientId: recipient.userId,
      action: 'grant' as const,
      signerKeyFp: privateKeys.sigFp,
    };
    return {
      recipientId: recipient.userId,
      kemCt: toBase64(cipherText),
      encDekNonce: toBase64(wrapped.nonce),
      encDek: toBase64(wrapped.ct),
      ts,
      sig: toBase64(sign(DOMAIN.grant, canonicalize(core), privateKeys.sigSk)),
    };
  });

  const manifest = {
    schema: 'arctrace.manifest/1' as const,
    orgId: user.orgId,
    ts,
    docId,
    version: 1,
    senderId: user.id,
    ciphertextSha256: sha256Hex(ciphertext),
    recipientSetHash: sha256Hex(new TextEncoder().encode([...recipientIds].sort().join('|'))),
    viewMode: 'VIEW_ONLY' as const,
    signerKeyFp: privateKeys.sigFp,
  };
  const senderSig = toBase64(sign(DOMAIN.manifest, canonicalize(manifest), privateKeys.sigSk));
    await api(`/documents/${docId}/finalize`, {
      method: 'POST',
      body: JSON.stringify({ titleEnc: { alg: 'AES-256-GCM', nonce: toBase64(title.nonce), ct: toBase64(title.ct) }, manifest, senderSig, grants }),
    });
    let names: Record<string, string> = {};
    try {
      await saveDocumentName(user.id, docId, titleText, privateKeys.vaultKey);
      names = await loadDocumentNames(user.id, privateKeys.vaultKey);
    } catch { /* local cache is optional; the encrypted server title remains available */ }
    return { docId, title: titleText, names };
  } finally {
    dek?.fill(0);
    privateKeys.kemSk.fill(0);
    privateKeys.sigSk.fill(0);
    privateKeys.vaultKey.fill(0);
  }
}
