CREATE TABLE "wallet_challenges" (
	"nonce" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"domain" text NOT NULL,
	"uri" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "pw_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_address" text;--> statement-breakpoint
CREATE INDEX "wallet_challenges_address_idx" ON "wallet_challenges" USING btree ("address");--> statement-breakpoint
CREATE INDEX "wallet_challenges_expiry_idx" ON "wallet_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_wallet_address_unique" ON "users" USING btree ("wallet_address");