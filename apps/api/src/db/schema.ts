/**
 * Postgres schema — the tables from spec.md section 7 plus `sessions`
 * (server-side session state for the cookie auth, see docs/decisions.md
 * D-028). Postgres holds working state only; Arkiv is the source of truth
 * for audit records.
 */
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  retentionSeconds: integer("retention_seconds").notNull().default(90 * 24 * 3600),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    email: text("email").notNull(),
    pwHash: text("pw_hash").notNull(),
    role: text("role").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** sha256 hex of the cookie token — the raw token never hits the DB. */
    tokenHash: text("token_hash").notNull(),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_hash_unique").on(t.tokenHash)],
);

export const userKeys = pgTable(
  "user_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kemPk: text("kem_pk").notNull(),
    sigPk: text("sig_pk").notNull(),
    kemFp: text("kem_fp").notNull(),
    sigFp: text("sig_fp").notNull(),
    status: text("status").notNull().default("active"),
    ledgerEntityKey: text("ledger_entity_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("user_keys_user_unique").on(t.userId),
    index("user_keys_sig_fp_idx").on(t.sigFp),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id),
    /** AES-256-GCM(DEK, title) — the server never sees titles. */
    titleEnc: text("title_enc"),
    version: integer("version").notNull().default(1),
    ciphertextKey: text("ciphertext_key").notNull(),
    ciphertextSha256: text("ciphertext_sha256"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    viewMode: text("view_mode").notNull(),
    status: text("status").notNull().default("created"),
    manifestEntityKey: text("manifest_entity_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (t) => [index("documents_org_idx").on(t.orgId), index("documents_sender_idx").on(t.senderId)],
);

export const grants = pgTable(
  "grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docId: uuid("doc_id")
      .notNull()
      .references(() => documents.id),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id),
    kemCt: text("kem_ct").notNull(),
    wrappedDek: text("wrapped_dek").notNull(),
    wrapNonce: text("wrap_nonce").notNull(),
    status: text("status").notNull().default("active"),
    ledgerEntityKey: text("ledger_entity_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("grants_doc_recipient_unique").on(t.docId, t.recipientId),
    index("grants_recipient_idx").on(t.recipientId),
  ],
);

export const openSessions = pgTable(
  "open_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docId: uuid("doc_id")
      .notNull()
      .references(() => documents.id),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id),
    sessionId: text("session_id").notNull(),
    wmCode: text("wm_code").notNull(),
    challenge: text("challenge").notNull(),
    seq: integer("seq").notNull(),
    prevHash: text("prev_hash"),
    status: text("status").notNull().default("begun"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ledgerEntityKey: text("ledger_entity_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("open_sessions_session_id_unique").on(t.sessionId),
    uniqueIndex("open_sessions_wm_code_unique").on(t.wmCode),
    index("open_sessions_doc_seq_idx").on(t.docId, t.seq),
    index("open_sessions_recipient_idx").on(t.recipientId),
  ],
);

export const ledgerOutbox = pgTable(
  "ledger_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    attributes: jsonb("attributes").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    entityKey: text("entity_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ledger_outbox_idempotency_unique").on(t.idempotencyKey),
    index("ledger_outbox_status_idx").on(t.status),
  ],
);

export const traces = pgTable(
  "traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    investigatorId: uuid("investigator_id")
      .notNull()
      .references(() => users.id),
    fileKey: text("file_key").notNull(),
    fileKind: text("file_kind"),
    leakedSha256: text("leaked_sha256").notNull(),
    status: text("status").notNull().default("pending"),
    error: text("error"),
    resultJson: jsonb("result_json"),
    reportEntityKey: text("report_entity_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("traces_status_idx").on(t.status),
    index("traces_investigator_idx").on(t.investigatorId),
  ],
);

export const anchors = pgTable("anchors", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  fromSeq: integer("from_seq").notNull(),
  toSeq: integer("to_seq").notNull(),
  root: text("root").notNull(),
  leafCount: integer("leaf_count").notNull().default(0),
  entityKey: text("entity_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLocal = pgTable("audit_local", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Bigint helper re-export so worker code can type timestamps. */
export type LedgerTimestamp = bigint;
