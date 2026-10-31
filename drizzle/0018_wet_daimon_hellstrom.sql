ALTER TYPE "public"."payroll_audit_field" ADD VALUE 'simplified_statement';--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "tax_office_code" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "business_type" text DEFAULT 'corporation' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "corporate_number" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "withholding_semiannual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "hometax_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "filing_contact_dept" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "filing_contact_name" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "filing_contact_phone" text;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD COLUMN "exclude_from_total_paid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_business_type" CHECK ("company"."business_type" in ('corporation', 'individual'));--> statement-breakpoint
UPDATE "payroll_items" SET "exclude_from_total_paid" = true WHERE "code" = 'car';
