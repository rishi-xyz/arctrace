import { DOMAIN, type DocumentDetail, type OpenBeginResponse, type SessionUser } from '@arctrace/shared';
import { aesGcmDecrypt, canonicalize, fromBase64, hexToBytes, kemDecapsulate, sign, toBase64, wrapKey, zeroGateShare } from '@arctrace/crypto';
import { embedText } from '@arctrace/watermark';
import { PDFDocument } from 'pdf-lib';
import { api } from './api';
import { unlockPrivateKeys } from './keys';
import { loadDocumentNames, saveDocumentName } from './document-names';

type OpenCommit = { keyWm: string; entityKey: string; gateMode: 'on' | 'off' };

function watermarkImage(image: ImageData, wmCode: string, keyWm: Uint8Array): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/watermark.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ ok: boolean; image?: { width: number; height: number; data: Uint8ClampedArray }; error?: string }>) => {
      worker.terminate();
      if (!event.data.ok || !event.data.image) {
        reject(new Error(event.data.error ?? 'Could not watermark the image'));
        return;
      }
      try {
        const { width, height, data } = event.data.image;
        resolve(new ImageData(new Uint8ClampedArray(data), width, height));
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Could not restore watermarked image pixels'));
      }
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('Watermark worker failed')); };
    worker.postMessage({ image, wmCode, keyWm }, [image.data.buffer]);
  });
}

export async function commitAndOpen(docId: string, user: SessionUser, passphrase: string) {
  const localKeys = await unlockPrivateKeys(user.id, passphrase);
  let dek: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  try {
  const detail = await api<DocumentDetail>(`/documents/${docId}`);
  if (!detail.titleEnc) throw new Error('This document has no encrypted file type metadata. Ask the sender to share it again.');
  const begin = await api<OpenBeginResponse>(`/documents/${docId}/open/begin`, { method: 'POST', body: '{}' });
  const aad = new TextEncoder().encode(docId);
  const ss = kemDecapsulate(fromBase64(begin.grant.kemCt), localKeys.kemSk);
  const wrappingKey = wrapKey(ss, zeroGateShare(), docId);
  const documentDek = aesGcmDecrypt(wrappingKey, fromBase64(begin.grant.encDekNonce), fromBase64(begin.grant.encDek), aad);
  dek = documentDek;
  const nameBytes = aesGcmDecrypt(documentDek, fromBase64(detail.titleEnc.nonce), fromBase64(detail.titleEnc.ct), new TextEncoder().encode(`title|${docId}`));
  const name = new TextDecoder().decode(nameBytes);
  nameBytes.fill(0);
  let cachedNames: Record<string, string> = {};
  try {
    await saveDocumentName(user.id, docId, name, localKeys.vaultKey);
    cachedNames = await loadDocumentNames(user.id, localKeys.vaultKey);
  } catch { /* local cache is optional; title remains encrypted on the server */ }
  const extension = name.split('.').pop()?.toLowerCase();
  if (!['png', 'jpg', 'jpeg', 'txt', 'pdf'].includes(extension ?? '')) throw new Error('This file type is not supported in the secure viewer.');

  const record = {
    schema: 'arctrace.decryption/1' as const,
    orgId: user.orgId,
    docId: begin.docId,
    docVersion: begin.docVersion,
    docCiphertextSha256: begin.docCiphertextSha256,
    recipientId: user.id,
    recipientSigKeyFp: localKeys.sigFp,
    sessionId: begin.sessionId,
    wmCode: begin.wmCode,
    challenge: begin.challenge,
    viewMode: begin.viewMode,
    clientTime: new Date().toISOString(),
    seq: begin.seq,
    prevRecordHash: begin.prevRecordHash,
  };
  const sig = toBase64(sign(DOMAIN.decryption, canonicalize(record), localKeys.sigSk));
  // No ciphertext is fetched and no plaintext is released until this succeeds.
  const committed = await api<OpenCommit>(`/documents/${docId}/open/commit`, {
    method: 'POST', body: JSON.stringify({ record, alg: 'ML-DSA-65', sig }),
  });
  const response = await fetch(begin.ciphertextPath);
  if (!response.ok) throw new Error('Could not retrieve the encrypted document.');
  const packed = new Uint8Array(await response.arrayBuffer());
  const openedBytes = aesGcmDecrypt(documentDek, packed.slice(0, 12), packed.slice(12), aad);
  plaintext = openedBytes;
  let blob: Blob;
  if (extension === 'txt') {
    const text = embedText(new TextDecoder().decode(openedBytes), begin.wmCode, hexToBytes(committed.keyWm));
    blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  } else if (extension === 'pdf') {
    blob = await watermarkPdf(plaintext, begin.wmCode, hexToBytes(committed.keyWm));
  } else {
    const source = await createImageBitmap(new Blob([openedBytes.slice().buffer as ArrayBuffer]));
    const canvas = document.createElement('canvas');
    canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the image viewer.');
    context.drawImage(source, 0, 0); source.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const marked = await watermarkImage(pixels, begin.wmCode, hexToBytes(committed.keyWm));
    context.putImageData(marked, 0, 0);
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not export the watermarked image.')), 'image/png'));
  }
  return { url: URL.createObjectURL(blob), name, names: cachedNames, entityKey: committed.entityKey, gateMode: committed.gateMode };
  } finally {
    // PDF.js may transfer the input buffer to its worker. Keep cleanup best-effort
    // so an already detached buffer cannot replace the real open result/error.
    zeroBytes(plaintext); zeroBytes(dek); zeroBytes(localKeys.kemSk); zeroBytes(localKeys.sigSk); zeroBytes(localKeys.vaultKey);
  }
}

function zeroBytes(bytes?: Uint8Array) {
  if (!bytes) return;
  try {
    if (bytes.byteLength > 0 && bytes.buffer.byteLength > 0) bytes.fill(0);
  } catch { /* buffers transferred to a worker are already inaccessible */ }
}

export async function watermarkPdf(bytes: Uint8Array, wmCode: string, keyWm: Uint8Array): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
  // pdf.js transfers typed-array inputs to its worker, which would detach the
  // plaintext buffer that commitAndOpen must wipe in its finally block.
  const source = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  if (source.numPages > 50) throw new Error('For this demo, PDF files are limited to 50 pages.');
  const output = await PDFDocument.create();
  for (let index = 1; index <= source.numPages; index++) {
    const page = await source.getPage(index);
    const viewport = page.getViewport({ scale: 1.25 });
    const baseViewport = page.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not render a PDF page.');
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const marked = await watermarkImage(context.getImageData(0, 0, canvas.width, canvas.height), wmCode, keyWm);
    context.putImageData(marked, 0, 0);
    const png = await new Promise<Uint8Array>((resolve, reject) => canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('Could not render a watermarked PDF page.')); return; }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png'));
    const embedded = await output.embedPng(png);
    const outputPage = output.addPage([baseViewport.width, baseViewport.height]);
    outputPage.drawImage(embedded, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
    page.cleanup();
  }
  source.cleanup();
  const result = await output.save();
  return new Blob([result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer], { type: 'application/pdf' });
}
