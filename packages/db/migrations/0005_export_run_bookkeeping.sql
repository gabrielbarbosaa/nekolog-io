ALTER TABLE "exports" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "exports_waiting_to_run" ON "exports" USING btree ("created_at") WHERE status = 'pending';--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_running_means_it_started" CHECK (status <> 'running' or started_at is not null);