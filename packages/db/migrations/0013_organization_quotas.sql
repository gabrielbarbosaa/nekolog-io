ALTER TABLE "organizations" ADD COLUMN "daily_event_quota" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "max_retention_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_daily_event_quota_is_positive" CHECK (daily_event_quota > 0);--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_max_retention_is_at_least_a_day" CHECK (max_retention_days >= 1);