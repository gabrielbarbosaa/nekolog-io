CREATE TYPE "public"."alert_channel_kind" AS ENUM('email', 'slack', 'discord', 'webhook');--> statement-breakpoint
CREATE TABLE "alert_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "alert_channel_kind" NOT NULL,
	"target" text NOT NULL,
	"sealed_secret" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_by" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_channels_id_shape" CHECK (id ~ '^ch_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "alert_channels_name_is_not_blank" CHECK (length(btrim(name)) > 0),
	CONSTRAINT "alert_channels_locale_is_supported" CHECK (locale in ('en', 'pt-BR', 'es')),
	CONSTRAINT "alert_channels_name_is_bounded" CHECK (length(name) <= 120),
	CONSTRAINT "alert_channels_an_address_is_https_or_an_email" CHECK (case kind
        when 'email' then target = lower(target) and target like '%@%' and target not like '% %'
        else target like 'https://%'
      end),
	CONSTRAINT "alert_channels_a_webhook_carries_a_sealed_secret" CHECK (kind <> 'webhook' or sealed_secret is not null),
	CONSTRAINT "alert_channels_a_secret_is_never_stored_in_the_clear" CHECK (sealed_secret is null or sealed_secret ~ '^v[0-9]+\.[0-9a-f]+\.[0-9a-f]+$')
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "last_measured" double precision;--> statement-breakpoint
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_channels_by_project" ON "alert_channels" USING btree ("project_id") WHERE disabled_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_one_name_per_project" ON "alert_channels" USING btree ("project_id","name") WHERE disabled_at is null;--> statement-breakpoint
CREATE INDEX "alert_rules_waiting_for_a_notice" ON "alert_rules" USING btree ("state_changed_at") WHERE disabled_at is null and state_changed_at is not null;