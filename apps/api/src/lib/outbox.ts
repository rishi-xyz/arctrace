import { canonicalize } from '@arctrace/crypto';

import type { ledgerOutbox } from '../db/schema.js';

type OutboxRow = typeof ledgerOutbox.$inferInsert;

/**
 * Build a `ledger_outbox` row for `tx.insert(ledgerOutbox).values(...)`.
 *
 * `payload` is the strict ledger payload object (packages/shared schemas); it
 * is JCS-canonicalized to deterministic JSON *text* here, so every producer
 * gets byte-identical payloads for identical inputs and the worker can
 * re-verify signatures against exactly what was committed.
 */
export function outboxRow(
  kind: 'doc_manifest' | 'grant_event',
  idempotencyKey: string,
  payload: Record<string, unknown>,
  attributes: Record<string, unknown>,
): OutboxRow {
  return {
    kind,
    idempotencyKey,
    payload: new TextDecoder().decode(canonicalize(payload)),
    attributes,
    status: 'pending',
  };
}
