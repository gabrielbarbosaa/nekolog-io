CREATE TYPE "public"."issue_status" AS ENUM('open', 'resolved', 'ignored');--> statement-breakpoint
CREATE TABLE "issue_environments" (
	"issue_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"events" bigint DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "issue_environments_issue_id_environment_id_pk" PRIMARY KEY("issue_id","environment_id"),
	CONSTRAINT "issue_environments_events_is_not_negative" CHECK (events >= 0),
	CONSTRAINT "issue_environments_last_seen_is_not_before_first_seen" CHECK (last_seen_at >= first_seen_at)
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" "issue_status" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"error_type" text DEFAULT '' NOT NULL,
	"service" text DEFAULT '' NOT NULL,
	"assignee_id" text,
	"events" bigint DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"regressed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issues_id_shape" CHECK (id ~ '^iss_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "issues_fingerprint_is_an_unsigned_number" CHECK (fingerprint ~ '^[0-9]{1,20}$'),
	CONSTRAINT "issues_fingerprint_is_not_the_unresolved_one" CHECK (fingerprint <> '0'),
	CONSTRAINT "issues_title_is_not_blank" CHECK (length(btrim(title)) > 0),
	CONSTRAINT "issues_events_is_not_negative" CHECK (events >= 0),
	CONSTRAINT "issues_last_seen_is_not_before_first_seen" CHECK (last_seen_at >= first_seen_at),
	CONSTRAINT "issues_resolved_means_there_is_a_moment" CHECK (status <> 'resolved' or resolved_at is not null)
);
--> statement-breakpoint
ALTER TABLE "issue_environments" ADD CONSTRAINT "issue_environments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_environments" ADD CONSTRAINT "issue_environments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_environments_by_environment" ON "issue_environments" USING btree ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_one_per_project_and_fingerprint" ON "issues" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "issues_by_project_and_last_seen" ON "issues" USING btree ("project_id","last_seen_at");