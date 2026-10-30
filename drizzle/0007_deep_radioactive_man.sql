CREATE TYPE "public"."dashboard_role" AS ENUM('cash', 'receivable', 'payable');--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "dashboard_role" "dashboard_role";