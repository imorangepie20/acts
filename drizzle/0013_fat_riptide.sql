CREATE TYPE "public"."import_source" AS ENUM('tax_invoice', 'card');--> statement-breakpoint
CREATE TABLE "voucher_imports" (
	"import_key" text PRIMARY KEY NOT NULL,
	"voucher_id" uuid NOT NULL,
	"source" "import_source" NOT NULL,
	"meta" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voucher_imports_voucher_id_unique" UNIQUE("voucher_id")
);
--> statement-breakpoint
ALTER TABLE "voucher_imports" ADD CONSTRAINT "voucher_imports_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;