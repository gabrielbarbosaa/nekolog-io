CREATE TABLE "dashboards" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboards_id_shape" CHECK (id ~ '^dsh_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "dashboards_name_is_not_blank" CHECK (length(btrim(name)) > 0),
	CONSTRAINT "dashboards_widgets_are_a_list" CHECK (jsonb_typeof(widgets) = 'array'),
	CONSTRAINT "dashboards_widget_count_is_bounded" CHECK (jsonb_typeof(widgets) <> 'array' or jsonb_array_length(widgets) <= 50)
);
--> statement-breakpoint
CREATE TABLE "export_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"cadence" "export_cadence" NOT NULL,
	"format" "export_format" NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"created_by" text,
	"last_run_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_schedules_id_shape" CHECK (id ~ '^exs_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "export_schedules_query_is_bounded" CHECK (length(query) <= 2000)
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"schedule_id" text,
	"requested_by" text,
	"format" "export_format" NOT NULL,
	"status" "export_status" DEFAULT 'pending' NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"range_from" timestamp with time zone NOT NULL,
	"range_to" timestamp with time zone NOT NULL,
	"object_key" text,
	"byte_size" bigint,
	"row_count" bigint,
	"failure" text,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exports_id_shape" CHECK (id ~ '^exp_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "exports_query_is_bounded" CHECK (length(query) <= 2000),
	CONSTRAINT "exports_range_moves_forward" CHECK (range_to > range_from),
	CONSTRAINT "exports_expire_after_they_are_asked_for" CHECK (expires_at > created_at),
	CONSTRAINT "exports_ready_means_there_is_an_object" CHECK (status <> 'ready' or object_key is not null),
	CONSTRAINT "exports_failed_means_there_is_a_reason" CHECK (status <> 'failed' or failure is not null),
	CONSTRAINT "exports_size_is_not_negative" CHECK (byte_size is null or byte_size >= 0),
	CONSTRAINT "exports_row_count_is_not_negative" CHECK (row_count is null or row_count >= 0),
	CONSTRAINT "exports_object_key_stays_inside_the_prefix" CHECK (object_key is null or object_key ~ '^exports/[A-Za-z0-9._/-]+$'),
	CONSTRAINT "exports_object_key_has_no_dot_dot" CHECK (object_key is null or object_key not like '%..%')
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"version" text NOT NULL,
	"commit" text,
	"sourcemap_count" integer DEFAULT 0 NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "releases_id_shape" CHECK (id ~ '^rel_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "releases_version_shape" CHECK (version = btrim(version) and length(version) between 1 and 200),
	CONSTRAINT "releases_commit_is_hex_when_set" CHECK ("commit" is null or "commit" ~ '^[0-9a-f]{7,40}$'),
	CONSTRAINT "releases_sourcemap_count_is_not_negative" CHECK (sourcemap_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text,
	"name" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"time_range" text,
	"shared" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_id_shape" CHECK (id ~ '^viw_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "saved_views_name_is_not_blank" CHECK (length(btrim(name)) > 0),
	CONSTRAINT "saved_views_query_is_bounded" CHECK (length(query) <= 2000),
	CONSTRAINT "saved_views_time_range_shape" CHECK (time_range is null or time_range ~ '^[0-9]{1,4}[mhd]$')
);
--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_schedules" ADD CONSTRAINT "export_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_schedules" ADD CONSTRAINT "export_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_schedules" ADD CONSTRAINT "export_schedules_environment_belongs_to_the_project" FOREIGN KEY ("environment_id","project_id") REFERENCES "public"."environments"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_schedule_id_export_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."export_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_environment_belongs_to_the_project" FOREIGN KEY ("environment_id","project_id") REFERENCES "public"."environments"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_environment_belongs_to_the_project" FOREIGN KEY ("environment_id","project_id") REFERENCES "public"."environments"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_environment_belongs_to_the_project" FOREIGN KEY ("environment_id","project_id") REFERENCES "public"."environments"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboards_by_project" ON "dashboards" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_one_shared_name_per_project" ON "dashboards" USING btree ("project_id","name") WHERE shared;--> statement-breakpoint
CREATE UNIQUE INDEX "export_schedules_one_live_cadence_per_environment" ON "export_schedules" USING btree ("environment_id","cadence") WHERE disabled_at is null;--> statement-breakpoint
CREATE INDEX "exports_by_environment_and_time" ON "exports" USING btree ("environment_id","created_at");--> statement-breakpoint
CREATE INDEX "exports_waiting_to_expire" ON "exports" USING btree ("expires_at") WHERE status = 'ready';--> statement-breakpoint
CREATE UNIQUE INDEX "releases_one_version_per_environment" ON "releases" USING btree ("environment_id","version");--> statement-breakpoint
CREATE INDEX "releases_by_project_and_time" ON "releases" USING btree ("project_id","released_at");--> statement-breakpoint
CREATE INDEX "saved_views_by_project" ON "saved_views" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_one_shared_name_per_project" ON "saved_views" USING btree ("project_id","name") WHERE shared;