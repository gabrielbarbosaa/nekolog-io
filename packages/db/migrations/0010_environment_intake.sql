ALTER TABLE "environments" ADD COLUMN "min_level" text DEFAULT 'trace' NOT NULL;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "sample_rate" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_min_level_is_a_level" CHECK (min_level in ('trace', 'debug', 'info', 'warn', 'error', 'fatal'));--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_sample_rate_is_a_share" CHECK (sample_rate > 0 and sample_rate <= 1);