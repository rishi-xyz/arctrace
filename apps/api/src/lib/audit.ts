import { randomUUID } from 'node:crypto';
import type { Database } from '../db/index.js';
import { auditLocal } from '../db/schema.js';

export type AuditAction =
  | 'user.register'
  | 'user.login'
  | 'user.wallet_register'
  | 'user.wallet_login'
  | 'user.logout'
  | 'key.generate'
  | 'key.revoke'
  | 'document.upload'
  | 'document.finalize'
  | 'document.share'
  | 'document.revoke_grant'
  | 'open.begin'
  | 'open.commit'
  | 'trace.create'
  | 'bundle.export';

/**
 * Audit log = who / did what / which document (spec §7, table `audit_local` —
 * convenience only, never authoritative). Deliberately stores no request
 * bodies, no ciphertext and no keys — only stable identifiers and
 * non-sensitive flags.
 */
export async function writeAudit(
  db: Database,
  actorUserId: string | null,
  action: AuditAction,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const row: typeof auditLocal.$inferInsert = {
    id: randomUUID(),
    actorId: actorUserId,
    action,
    meta: Object.keys(meta).length ? meta : null,
  };
  await db.insert(auditLocal).values(row);
}
