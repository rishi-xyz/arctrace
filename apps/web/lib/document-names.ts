import { randomBytes } from '@arctrace/crypto';

type StoredName = { id: string; userId: string; docId: string; nonce: Uint8Array; encrypted: ArrayBuffer };
const cacheInfo = new TextEncoder().encode('ArcTrace document-name cache v1');

async function cacheKey(userId: string, vaultKey: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = vaultKey.buffer.slice(vaultKey.byteOffset, vaultKey.byteOffset + vaultKey.byteLength) as ArrayBuffer;
  const master = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(userId), info: cacheInfo },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

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

export async function saveDocumentName(userId: string, docId: string, name: string, vaultKey: Uint8Array): Promise<void> {
  const nonce = randomBytes(12);
  const key = await cacheKey(userId, vaultKey, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(name));
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('documentNames', 'readwrite');
    tx.objectStore('documentNames').put({ id: `${userId}:${docId}`, userId, docId, nonce, encrypted } satisfies StoredName);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadDocumentNames(userId: string, vaultKey: Uint8Array): Promise<Record<string, string>> {
  const db = await openDb();
  const records = await new Promise<StoredName[]>((resolve, reject) => {
    const request = db.transaction('documentNames', 'readonly').objectStore('documentNames').getAll();
    request.onsuccess = () => resolve((request.result as StoredName[]).filter((row) => row.userId === userId));
    request.onerror = () => reject(request.error);
  });
  db.close();
  const names: Record<string, string> = {};
  const key = await cacheKey(userId, vaultKey, ['decrypt']);
  for (const record of records) {
    try {
      const iv = record.nonce.buffer.slice(record.nonce.byteOffset, record.nonce.byteOffset + record.nonce.byteLength) as ArrayBuffer;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, record.encrypted);
      names[record.docId] = new TextDecoder().decode(plain);
    } catch { /* stale entries are ignored */ }
  }
  return names;
}
