import { DOMAIN, type SessionUser } from '@arctrace/shared';
import { canonicalize, deriveVaultKey, fingerprint, generateKemKeyPair, generateSigKeyPair, randomBytes, sign, toBase64, SIZE } from '@arctrace/crypto';
import { api } from './api';

type StoredKey = { userId: string; salt: Uint8Array; nonce: Uint8Array; encrypted: ArrayBuffer; kemFp: string; sigFp: string; createdAt: string };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('arctrace-v1', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('keys')) request.result.createObjectStore('keys', { keyPath: 'userId' });
      if (!request.result.objectStoreNames.contains('documentNames')) request.result.createObjectStore('documentNames', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveKey(record: StoredKey) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function createAndRegisterKeys(user: SessionUser, passphrase: string) {
  const kem = generateKemKeyPair();
  const sig = generateSigKeyPair();
  const keyId = crypto.randomUUID();
  const ts = new Date().toISOString();
  const kemFp = fingerprint(kem.publicKey);
  const sigFp = fingerprint(sig.publicKey);
  const core = {
    schema: 'arctrace.keyreg/1' as const,
    orgId: user.orgId,
    ts,
    userId: user.id,
    keyId,
    kemPk: toBase64(kem.publicKey),
    sigPk: toBase64(sig.publicKey),
    kemFp,
    sigFp,
    alg: 'ML-KEM-768+ML-DSA-65',
  };
  const signature = toBase64(sign(DOMAIN.keyreg, canonicalize(core), sig.secretKey));

  // Argon2id derives a non-exportable AES-GCM key. Only encrypted private-key
  // bytes and the random salt/nonce are persisted in this browser profile.
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const derived = await deriveVaultKey(passphrase, salt);
  const privateBundle = new Uint8Array(kem.secretKey.length + sig.secretKey.length);
  privateBundle.set(kem.secretKey); privateBundle.set(sig.secretKey, kem.secretKey.length);
  try {
    const derivedBuffer = derived.buffer.slice(derived.byteOffset, derived.byteOffset + derived.byteLength) as ArrayBuffer;
    const aesKey = await crypto.subtle.importKey('raw', derivedBuffer, 'AES-GCM', false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, privateBundle);
    await saveKey({ userId: user.id, salt, nonce, encrypted, kemFp, sigFp, createdAt: ts });
    await api('/keys', { method: 'POST', body: JSON.stringify({ ...core, sig: signature }) });
  } finally {
    derived.fill(0); privateBundle.fill(0); kem.secretKey.fill(0); sig.secretKey.fill(0);
  }
}

export async function unlockPrivateKeys(userId: string, passphrase: string) {
  const db = await openDb();
  const record = await new Promise<StoredKey | undefined>((resolve, reject) => {
    const request = db.transaction('keys', 'readonly').objectStore('keys').get(userId);
    request.onsuccess = () => resolve(request.result as StoredKey | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!record) throw new Error('No private key is saved in this browser. Register keys first.');
  const derived = await deriveVaultKey(passphrase, record.salt);
  const rawKey = derived.buffer.slice(derived.byteOffset, derived.byteOffset + derived.byteLength) as ArrayBuffer;
  const aesKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  let plaintext: ArrayBuffer;
  const nonceBuffer = record.nonce.buffer.slice(record.nonce.byteOffset, record.nonce.byteOffset + record.nonce.byteLength) as ArrayBuffer;
  try { plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonceBuffer }, aesKey, record.encrypted); }
  catch { derived.fill(0); throw new Error('That passphrase did not unlock your private key.'); }
  const bytes = new Uint8Array(plaintext);
  const kemSk = bytes.slice(0, SIZE.kemSk);
  const sigSk = bytes.slice(SIZE.kemSk, SIZE.kemSk + SIZE.dsaSk);
  const vaultKey = derived.slice();
  bytes.fill(0); derived.fill(0);
  return { kemSk, sigSk, kemFp: record.kemFp, sigFp: record.sigFp, vaultKey };
}
