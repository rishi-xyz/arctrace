CREATE TABLE "anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"from_seq" integer NOT NULL,
	"to_seq" integer NOT NULL,
	"root" text NOT NULL,
	"leaf_count" integer DEFAULT 0 NOT NULL,
	"entity_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_local" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"title_enc" text,
	"version" integer DEFAULT 1 NOT NULL,
	"ciphertext_key" text NOT NULL,
	"ciphertext_sha256" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"view_mode" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"manifest_entity_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kem_ct" text NOT NULL,
	"wrapped_dek" text NOT NULL,
	"wrap_nonce" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ledger_entity_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" text NOT NULL,
	"attributes" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"entity_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "open_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"wm_code" text NOT NULL,
	"challenge" text NOT NULL,
	"seq" integer NOT NULL,
	"prev_hash" text,
	"status" text DEFAULT 'begun' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ledger_entity_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"retention_seconds" integer DEFAULT 7776000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"investigator_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"file_kind" text,
	"leaked_sha256" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"result_json" jsonb,
	"report_entity_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kem_pk" text NOT NULL,
	"sig_pk" text NOT NULL,
	"kem_fp" text NOT NULL,
	"sig_fp" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ledger_entity_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"pw_hash" text NOT NULL,
	"role" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anchors" ADD CONSTRAINT "anchors_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_sessions" ADD CONSTRAINT "open_sessions_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_sessions" ADD CONSTRAINT "open_sessions_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_investigator_id_users_id_fk" FOREIGN KEY ("investigator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_keys" ADD CONSTRAINT "user_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_org_idx" ON "documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "documents_sender_idx" ON "documents" USING btree ("sender_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grants_doc_recipient_unique" ON "grants" USING btree ("doc_id","recipient_id");--> statement-breakpoint
CREATE INDEX "grants_recipient_idx" ON "grants" USING btree ("recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_outbox_idempotency_unique" ON "ledger_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_outbox_status_idx" ON "ledger_outbox" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "open_sessions_session_id_unique" ON "open_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "open_sessions_wm_code_unique" ON "open_sessions" USING btree ("wm_code");--> statement-breakpoint
CREATE INDEX "open_sessions_doc_seq_idx" ON "open_sessions" USING btree ("doc_id","seq");--> statement-breakpoint
CREATE INDEX "open_sessions_recipient_idx" ON "open_sessions" USING btree ("recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "traces_status_idx" ON "traces" USING btree ("status");--> statement-breakpoint
CREATE INDEX "traces_investigator_idx" ON "traces" USING btree ("investigator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_keys_user_unique" ON "user_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_keys_sig_fp_idx" ON "user_keys" USING btree ("sig_fp");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");