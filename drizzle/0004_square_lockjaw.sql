CREATE TYPE "public"."entry_type" AS ENUM('purchase', 'sale', 'transfer', 'general');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('tax_invoice', 'invoice', 'card', 'cash_receipt', 'simple_receipt', 'none');--> statement-breakpoint
CREATE TYPE "public"."line_side" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."vat_type" AS ENUM('taxable', 'zero_rated', 'exempt');--> statement-breakpoint
CREATE TYPE "public"."voucher_action" AS ENUM('created', 'updated', 'deleted', 'approved', 'rejected', 'attached', 'detached');--> statement-breakpoint
CREATE TYPE "public"."voucher_kind" AS ENUM('general', 'closing');--> statement-breakpoint
CREATE TYPE "public"."voucher_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "voucher_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "voucher_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"voucher_id" uuid NOT NULL,
	"action" "voucher_action" NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot" jsonb NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "voucher_lines" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "voucher_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"voucher_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" integer NOT NULL,
	"side" "line_side" NOT NULL,
	"amount" bigint NOT NULL,
	"partner_id" integer,
	"site_id" integer NOT NULL,
	"department_id" integer,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "voucher_lines_amount_positive" CHECK ("voucher_lines"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"no" integer NOT NULL,
	"kind" "voucher_kind" DEFAULT 'general' NOT NULL,
	"entry_type" "entry_type" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"partner_id" integer,
	"evidence_type" "evidence_type" DEFAULT 'none' NOT NULL,
	"vat_type" "vat_type",
	"vat_deductible" boolean,
	"supply_amount" bigint,
	"vat_amount" bigint,
	"status" "voucher_status" NOT NULL,
	"reject_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voucher_history" ADD CONSTRAINT "voucher_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voucher_history_voucher_id_idx" ON "voucher_history" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "voucher_lines_voucher_id_idx" ON "voucher_lines" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "voucher_lines_account_id_idx" ON "voucher_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "voucher_lines_partner_id_idx" ON "voucher_lines" USING btree ("partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_date_no_uq" ON "vouchers" USING btree ("date","no");--> statement-breakpoint
CREATE INDEX "vouchers_date_idx" ON "vouchers" USING btree ("date");