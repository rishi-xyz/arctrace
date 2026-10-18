import { and, count, eq } from 'drizzle-orm';
import type {
  DocumentDetail,
  DocumentSummary,
  GrantInfo,
  OrgUser,
  Role,
  SessionUser,
} from '@arctrace/shared';
import { documents, grants, orgs, userKeys, users } from '../db/schema.js';
import type { Database } from '../db/index.js';
import { forbidden, notFound } from '../lib/errors.js';
import { outboxStatuses } from '../lib/outbox-status.js';

export const toIso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : d);

export function requireRole(user: { role: string }, ...roles: Role[]): void {
  if (!roles.includes(user.role as Role)) {
    throw forbidden(`Requires role: ${roles.join(' | ')}`);
  }
}

export async function activeKeys(db: Database, userId: string) {
  const rows = await db
    .select()
    .from(userKeys)
    .where(and(eq(userKeys.userId, userId), eq(userKeys.status, 'active')))
    .limit(1);
  return rows[0] ?? null;
}

export async function sessionUser(
  db: Database,
  user: { id: string; email: string; displayName: string; role: string; orgId: string; createdAt: Date },
): Promise<SessionUser> {
  const keys = await activeKeys(db, user.id);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role as Role,
    orgId: user.orgId,
    hasKeys: keys !== null,
    createdAt: toIso(user.createdAt),
  };
}

export async function orgMembers(db: Database, orgId: string): Promise<OrgUser[]> {
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      role: users.role,
      keyStatus: userKeys.status,
    })
    .from(users)
    .leftJoin(userKeys, eq(userKeys.userId, users.id))
    .where(eq(users.orgId, orgId))
    .orderBy(users.createdAt);
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    role: r.role as Role,
    hasKeys: r.keyStatus === 'active',
  }));
}

export type DocRow = typeof documents.$inferSelect;
export type GrantRow = typeof grants.$inferSelect;

export async function loadDoc(db: Database, docId: string): Promise<DocRow> {
  const rows = await db.select().from(documents).where(eq(documents.id, docId)).limit(1);
  const doc = rows[0];
  if (!doc) throw notFound('Document not found');
  return doc;
}

export async function orgOf(db: Database, orgId: string) {
  const rows = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
  return rows[0] ?? null;
}

export async function myGrant(db: Database, docId: string, userId: string): Promise<GrantRow | null> {
  const rows = await db
    .select()
    .from(grants)
    .where(and(eq(grants.docId, docId), eq(grants.recipientId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

async function grantCount(db: Database, docId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(grants)
    .where(eq(grants.docId, docId));
  return rows[0]?.n ?? 0;
}

/**
 * Document metadata for the wire. `titleEnc` is only disclosed to the sender
 * and to holders of an active grant (they hold the DEK material needed to
 * decrypt it); everyone else gets null.
 */
export async function documentSummary(
  db: Database,
  doc: DocRow,
  viewer: { id: string },
): Promise<DocumentSummary> {
  const [sender, g, n] = await Promise.all([
    db.select().from(users).where(eq(users.id, doc.senderId)).limit(1),
    myGrant(db, doc.id, viewer.id),
    grantCount(db, doc.id),
  ]);
  const isSender = doc.senderId === viewer.id;
  const titleEnc =
    isSender || (g && g.status === 'active')
      ? doc.titleEnc
        ? (JSON.parse(doc.titleEnc) as DocumentSummary['titleEnc'])
        : null
      : null;
  return {
    id: doc.id,
    version: doc.version,
    viewMode: doc.viewMode as 'VIEW_ONLY' | 'DOWNLOAD',
    status: doc.status as DocumentSummary['status'],
    titleEnc,
    ciphertextSha256: doc.ciphertextSha256,
    sizeBytes: doc.sizeBytes,
    senderId: doc.senderId,
    senderName: sender?.[0]?.displayName ?? 'unknown',
    createdAt: toIso(doc.createdAt),
    grantCount: n,
    myGrant: g
      ? {
          kemCt: g.kemCt,
          encDekNonce: g.wrapNonce,
          encDek: g.wrappedDek,
          status: g.status as 'active' | 'revoked',
        }
      : null,
  };
}

export async function documentDetail(
  db: Database,
  doc: DocRow,
  viewer: { id: string; role: string },
): Promise<DocumentDetail> {
  const summary = await documentSummary(db, doc, viewer);
  const ledger = await outboxStatuses(db, doc.id);
  const canSeeGrants = doc.senderId === viewer.id || viewer.role === 'admin';
  let grantInfo: GrantInfo[] | null = null;
  if (canSeeGrants) {
    const rows = await db
      .select({
        recipientId: grants.recipientId,
        recipientName: users.displayName,
        kemCt: grants.kemCt,
        wrapNonce: grants.wrapNonce,
        wrappedDek: grants.wrappedDek,
        status: grants.status,
        ledgerEntityKey: grants.ledgerEntityKey,
      })
      .from(grants)
      .leftJoin(users, eq(users.id, grants.recipientId))
      .where(eq(grants.docId, doc.id));
    grantInfo = rows.map((r) => ({
      recipientId: r.recipientId,
      recipientName: r.recipientName,
      kemCt: r.kemCt,
      encDekNonce: r.wrapNonce,
      encDek: r.wrappedDek,
      status: r.status as 'active' | 'revoked',
      ledgerEntityKey: r.ledgerEntityKey,
    }));
  }
  return { ...summary, ledger, grants: grantInfo };
}

