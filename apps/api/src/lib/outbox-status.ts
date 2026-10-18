import { eq, sql } from 'drizzle-orm';
import { ledgerOutbox } from '../db/schema.js';
import type { Database } from '../db/index.js';

export type OutboxRow = {
  kind: string;
  idempotencyKey: string;
  status: 'pending' | 'committed' | 'failed';
  entityKey: string | null;
  attempts: number;
  lastError: string | null;
};

/**
 * Outbox rows for one document (matched via the `doc_id` index attribute),
 * shaped as the wire's OutboxStatus.
 */
export async function outboxStatuses(db: Database, docId: string): Promise<OutboxRow[]> {
  const rows = await db
    .select()
    .from(ledgerOutbox)
    .where(sql`${ledgerOutbox.attributes} @> ${JSON.stringify({ doc_id: docId })}::jsonb`)
    .orderBy(ledgerOutbox.createdAt);
  return rows.map((r) => ({
    kind: r.kind,
    idempotencyKey: r.idempotencyKey,
    status: r.status as OutboxRow['status'],
    entityKey: r.entityKey,
    attempts: r.attempts,
    lastError: r.lastError,
  }));
}

/** A single outbox row by idempotency key (used by status checks in tests). */
export async function outboxByKey(db: Database, key: string): Promise<OutboxRow | null> {
  const rows = await db
    .select()
    .from(ledgerOutbox)
    .where(eq(ledgerOutbox.idempotencyKey, key))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    kind: r.kind,
    idempotencyKey: r.idempotencyKey,
    status: r.status as OutboxRow['status'],
    entityKey: r.entityKey,
    attempts: r.attempts,
    lastError: r.lastError,
  };
}
