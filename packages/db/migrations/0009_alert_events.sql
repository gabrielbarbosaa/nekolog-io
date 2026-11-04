CREATE TYPE "public"."alert_suppression" AS ENUM('cooldown', 'no_channel');--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"state" "alert_state" NOT NULL,
	"measured" double precision NOT NULL,
	"threshold" double precision,
	"at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	"suppressed" "alert_suppression",
	"channels_sent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_events_id_shape" CHECK (id ~ '^ale_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "alert_events_channels_sent_is_not_negative" CHECK (channels_sent >= 0),
	CONSTRAINT "alert_events_a_notice_reached_a_channel" CHECK (notified_at is null or channels_sent > 0),
	CONSTRAINT "alert_events_a_suppressed_event_sent_nothing" CHECK (suppressed is null or (notified_at is null and channels_sent = 0))
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_environment_belongs_to_the_project" FOREIGN KEY ("environment_id","project_id") REFERENCES "public"."environments"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_events_one_per_change" ON "alert_events" USING btree ("rule_id","at");--> statement-breakpoint
CREATE INDEX "alert_events_by_environment_and_time" ON "alert_events" USING btree ("environment_id","at");--> statement-breakpoint
CREATE INDEX "alert_events_cooldown" ON "alert_events" USING btree ("rule_id","at") WHERE state = 'firing' and notified_at is not null;