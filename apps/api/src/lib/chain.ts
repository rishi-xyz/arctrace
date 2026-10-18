import { sha256Hex } from '@arctrace/crypto';
import { getLedger, trustedWriters } from './ledger.js';
import { ledgerUnavailable } from './errors.js';

export interface ChainHead {
  /** Next sequence number for this document's decryption chain. */
  seq: number;
  /** sha256 of the previous record's canonical payload bytes (null at head). */
  prevRecordHash: string | null;
  /** How many committed records were scanned. */
  length: number;
}

const PAGE = 100;
const MAX_PAGES = 50;

/**
 * The per-document hash-chain head, read from the LEDGER (authoritative, spec
 * §6 "seq and prevRecordHash current"). Pages through every decryption_event
 * for the doc under the trusted-creator filter — fail closed on any error.
 * Concurrent opens race by design: the loser gets 409 CHAIN_MOVED at commit
 * and must re-begin.
 */
export async function chainHead(docId: string): Promise<ChainHead> {
  const ledger = getLedger();
  const creators = trustedWriters();
  if (creators.length === 0) throw ledgerUnavailable('No trusted writers configured');

  let cursor: string | undefined;
  let best: { seq: number; payload: Uint8Array } | null = null;
  let total = 0;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await ledger.query(
        'decryption_event',
        { doc_id: docId },
        { creators, limit: PAGE, cursor },
      );
      for (const item of res.items) {
        total++;
        const seq = Number(item.attributes.seq ?? -1);
        if (best === null || seq > best.seq) best = { seq, payload: item.payload };
      }
      if (!res.next) break;
      cursor = res.next;
    }
  } catch (err) {
    throw ledgerUnavailable(`Chain head unavailable: ${(err as Error).message}`);
  }

  if (!best) return { seq: 0, prevRecordHash: null, length: 0 };
  return { seq: best.seq + 1, prevRecordHash: sha256Hex(best.payload), length: total };
}
