CREATE TYPE "public"."export_cadence" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."export_format" AS ENUM('json', 'xml', 'csv');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('pending', 'running', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE UNIQUE INDEX "environments_id_and_project" ON "environments" USING btree ("id","project_id");