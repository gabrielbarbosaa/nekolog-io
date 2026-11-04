CREATE TYPE "public"."alert_state" AS ENUM('ok', 'firing');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('threshold', 'error_rate', 'new_issue', 'issue_regression', 'absence');--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "alert_type" NOT NULL,
	"condition" jsonb NOT NULL,
	"state" "alert_state" DEFAULT 'ok' NOT NULL,
	"state_changed_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone,
	"created_by" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rules_id_shape" CHECK (id ~ '^alr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "alert_rules_name_is_not_blank" CHECK (length(btrim(name)) > 0),
	CONSTRAINT "alert_rules_name_is_bounded" CHECK (length(name) <= 120),
	CONSTRAINT "alert_rules_condition_is_an_object" CHECK (jsonb_typeof(condition) = 'object'),
	CONSTRAINT "alert_rules_condition_names_the_same_type" CHECK (condition ->> 'type' = type::text),
	CONSTRAINT "alert_rules_condition_carries_no_environment" CHECK (condition ? 'environment' is not true),
	CONSTRAINT "alert_rules_condition_has_channels" CHECK (jsonb_typeof(condition -> 'channels') = 'array'
        and jsonb_array_length(condition -> 'channels') between 1 and 10),
	CONSTRAINT "alert_rules_firing_means_there_is_a_moment" CHECK (state <> 'firing' or state_changed_at is not null)
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_environment_belongs_to_the_project" FOREIGN KEY ("environment_id","project_id") REFERENCES "public"."environments"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_rules_to_evaluate" ON "alert_rules" USING btree ("type","environment_id") WHERE disabled_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_one_name_per_environment" ON "alert_rules" USING btree ("environment_id","name") WHERE disabled_at is null;