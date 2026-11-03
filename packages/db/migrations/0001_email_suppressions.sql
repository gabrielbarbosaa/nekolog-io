CREATE TYPE "public"."suppression_reason" AS ENUM('bounce', 'complaint', 'manual');--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_id_shape" CHECK (id ~ '^sup_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "email_suppressions_address_is_lowercase" CHECK (address = lower(address)),
	CONSTRAINT "email_suppressions_address_has_one_at" CHECK (address ~ '^[^@[:space:]]+@[^@[:space:]]+$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_address" ON "email_suppressions" USING btree ("address");