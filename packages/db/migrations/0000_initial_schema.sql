CREATE TYPE "public"."api_key_kind" AS ENUM('public', 'secret');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"kind" "api_key_kind" NOT NULL,
	"hash" text NOT NULL,
	"hint" text NOT NULL,
	"scopes" text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_id_shape" CHECK (id ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "api_keys_hash_is_sha256_hex" CHECK (hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_keys_scopes_are_known" CHECK (scopes <@ array['logs:write', 'logs:read']::text[] and array_length(scopes, 1) >= 1),
	CONSTRAINT "api_keys_public_only_writes" CHECK (kind <> 'public' or scopes = array['logs:write']::text[])
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"metadata" jsonb,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_id_shape" CHECK (id ~ '^aud_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "audit_log_country_is_a_code" CHECK (country is null or country ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"retention_days" integer DEFAULT 7 NOT NULL,
	"daily_event_quota" integer,
	"origin_allowlist" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_id_shape" CHECK (id ~ '^env_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "environments_name_shape" CHECK (name ~ '^[a-z][a-z0-9-]{0,30}$'),
	CONSTRAINT "environments_retention_is_at_least_a_day" CHECK (retention_days >= 1),
	CONSTRAINT "environments_quota_is_positive_when_set" CHECK (daily_event_quota is null or daily_event_quota > 0)
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_id_shape" CHECK (id ~ '^inv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "invites_email_is_lowercase" CHECK (email = lower(email)),
	CONSTRAINT "invites_role_is_not_owner" CHECK (role <> 'owner'),
	CONSTRAINT "invites_expire_after_they_are_created" CHECK (expires_at > created_at)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_id_shape" CHECK (id ~ '^mem_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_id_shape" CHECK (id ~ '^org_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "organizations_name_is_not_blank" CHECK (length(btrim(name)) > 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_id_shape" CHECK (id ~ '^prj_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "projects_name_is_not_blank" CHECK (length(btrim(name)) > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"is_operator" boolean DEFAULT false NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_id_shape" CHECK (id ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "users_email_is_lowercase" CHECK (email = lower(email)),
	CONSTRAINT "users_email_has_an_at" CHECK (email like '%@%'),
	CONSTRAINT "users_locale_is_supported" CHECK (locale in ('en', 'pt-BR', 'es'))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_key" ON "api_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "api_keys_by_environment" ON "api_keys" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "audit_log_by_organization_and_time" ON "audit_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_one_name_per_project" ON "environments" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_one_open_per_email_and_organization" ON "invites" USING btree ("organization_id","email") WHERE accepted_at is null and revoked_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_per_user_and_organization" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_by_user" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_by_organization" ON "projects" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");