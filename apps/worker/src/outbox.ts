/**
 * Outbox drain: the durable ledger relay (spec §3). Rows are written by the
 * API in the same transaction as the state they describe; this loop is the
 * only writer to the ledger besides synchronous fail-closed routes. Failures
 * retry with exponential backoff; after MAX_ATTEMPTS the row is parked as
 * 'failed' (surfaced by /v1/ledger/status) — never silently dropped.
 */
import { and, asc, eq, lte } from "drizzle-orm";
import type { Db } from "arctrace-api/db";
import type { ApiConfig } from "arctrace-api/config";
import { ledgerOutbox, documents, grants } from "arctrace-api/schema";
import { getLedger, trustedWriters } from "arctrace-api/ledger";
import type { LedgerKind } from "@arctrace/shared";

const BATCH = 20;
const MAX_ATTEMPTS = 8;

export interface DrainStats {
  committed: number;
  failed: number;
  parked: number;
}

function backoffMs(attempts: number): number {
  return Math.min(30_000, 500 * 2 ** attempts);
}

export async function drainOutboxOnce(db: Db, config: ApiConfig): Promise<DrainStats | null> {
  const ledger = getLedger();
  if (trustedWriters().length === 0) throw new Error("No trusted writers configured");

  const now = new Date();
  const rows = await db
    .select()
    .from(ledgerOutbox)
    .where(and(eq(ledgerOutbox.status, "pending"), lte(ledgerOutbox.updatedAt, now)))
    .orderBy(asc(ledgerOutbox.createdAt))
    .limit(BATCH);
  if (rows.length === 0) return null;

  const stats: DrainStats = { committed: 0, failed: 0, parked: 0 };

  for (const row of rows) {
    try {
      const ref = await ledger.commit({
        kind: row.kind as LedgerKind,
        attributes: row.attributes as Record<string, string | number>,
        payload: new TextEncoder().encode(row.payload),
        retentionSeconds: config.retentionSeconds,
        readOnly: true,
        payloadMode: "plain",
        idempotencyKey: row.idempotencyKey,
      });
      await db
        .update(ledgerOutbox)
        .set({ status: "done", entityKey: ref.entityKey, lastError: null, updatedAt: new Date() })
        .where(eq(ledgerOutbox.id, row.id));
      await backfillEntityKey(db, row.kind, row.payload, ref.entityKey);
      stats.committed++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const message = (err as Error).message.slice(0, 500);
      if (attempts >= MAX_ATTEMPTS) {
        await db
          .update(ledgerOutbox)
          .set({ status: "failed", attempts, lastError: message, updatedAt: new Date() })
          .where(eq(ledgerOutbox.id, row.id));
        stats.parked++;
      } else {
        // Push updatedAt forward so the next drain pass (after backoff) retries.
        await db
          .update(ledgerOutbox)
          .set({
            attempts,
            lastError: message,
            updatedAt: new Date(Date.now() + backoffMs(attempts)),
          })
          .where(eq(ledgerOutbox.id, row.id));
        stats.failed++;
      }
    }
  }
  return stats;
}

/**
 * Mirror the committed entity key onto the row it describes so /documents
 * can show "on ledger" without a ledger round-trip.
 */
async function backfillEntityKey(
  db: Db,
  kind: string,
  payloadText: string,
  entityKey: string,
): Promise<void> {
  try {
    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    if (kind === "doc_manifest" && typeof payload.docId === "string") {
      await db
        .update(documents)
        .set({ manifestEntityKey: entityKey })
        .where(eq(documents.id, payload.docId));
    } else if (kind === "grant_event" && typeof payload.docId === "string" && typeof payload.recipientId === "string") {
      await db
        .update(grants)
        .set({ ledgerEntityKey: entityKey })
        .where(and(eq(grants.docId, payload.docId), eq(grants.recipientId, payload.recipientId)));
    }
  } catch {
    /* backfill is best-effort; the outbox row itself is the source of truth */
  }
}

/** Drain until the queue is empty (test hook); returns aggregate stats. */
export async function drainOutboxAll(db: Db, config: ApiConfig): Promise<DrainStats> {
  const total: DrainStats = { committed: 0, failed: 0, parked: 0 };
  for (let i = 0; i < 50; i++) {
    const s = await drainOutboxOnce(db, config);
    if (!s) break;
    total.committed += s.committed;
    total.failed += s.failed;
    total.parked += s.parked;
    if (s.failed > 0) break; // backing off — don't hot-loop retries
  }
  return total;
}
