CREATE TYPE "public"."payroll_audit_field" AS ENUM('rrn', 'account');--> statement-breakpoint
CREATE TYPE "public"."payroll_item_kind" AS ENUM('earning');--> statement-breakpoint
CREATE TYPE "public"."payroll_rate_kind" AS ENUM('pension_employee', 'pension_company', 'pension_cap', 'pension_floor', 'health_employee', 'health_company', 'ltc_employee', 'ltc_company', 'employment_employee', 'employment_company');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_type" AS ENUM('regular', 'bonus');--> statement-breakpoint
ALTER TYPE "public"."voucher_kind" ADD VALUE 'payroll';--> statement-breakpoint
CREATE TABLE "employees" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "employees_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"employee_no" text NOT NULL,
	"name" text NOT NULL,
	"rrn_enc" text NOT NULL,
	"rrn_hmac" text NOT NULL,
	"hired_on" date NOT NULL,
	"left_on" date,
	"site_id" integer NOT NULL,
	"department_id" integer,
	"is_executive" boolean DEFAULT false NOT NULL,
	"dependents" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"withholding_rate" smallint DEFAULT 100 NOT NULL,
	"bank" text,
	"account_enc" text,
	"account_last4" text,
	"ins_pension" boolean DEFAULT true NOT NULL,
	"ins_health" boolean DEFAULT true NOT NULL,
	"ins_employment" boolean DEFAULT true NOT NULL,
	"pension_base" bigint DEFAULT 0 NOT NULL,
	"health_base" bigint DEFAULT 0 NOT NULL,
	"default_amounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_employee_no_unique" UNIQUE("employee_no"),
	CONSTRAINT "employees_rrn_hmac_unique" UNIQUE("rrn_hmac"),
	CONSTRAINT "employees_dependents_min" CHECK ("employees"."dependents" >= 1),
	CONSTRAINT "employees_children_min" CHECK ("employees"."children" >= 0),
	CONSTRAINT "employees_withholding_rate" CHECK ("employees"."withholding_rate" in (80, 100, 120))
);
--> statement-breakpoint
CREATE TABLE "payroll_audit" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payroll_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"employee_id" integer NOT NULL,
	"field" "payroll_audit_field" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_items" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "payroll_item_kind" DEFAULT 'earning' NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"nontax_limit" bigint,
	"in_employment_base" boolean DEFAULT true NOT NULL,
	"debit_account_code" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_rates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payroll_rates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" "payroll_rate_kind" NOT NULL,
	"effective_from" date NOT NULL,
	"value" numeric(12, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run_lines" (
	"run_id" uuid NOT NULL,
	"employee_id" integer NOT NULL,
	"amounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "payroll_run_lines_run_id_employee_id_pk" PRIMARY KEY("run_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "payroll_run_type" NOT NULL,
	"year_month" text NOT NULL,
	"pay_date" date NOT NULL,
	"bonus_from" text,
	"bonus_to" text,
	"status" "payroll_run_status" DEFAULT 'draft' NOT NULL,
	"voucher_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"pension_company_code" text DEFAULT '817' NOT NULL,
	"insurance_company_code" text DEFAULT '811' NOT NULL,
	"withholding_code" text DEFAULT '254' NOT NULL,
	"company_payable_code" text DEFAULT '262' NOT NULL,
	"net_pay_code" text DEFAULT '103' NOT NULL,
	"executive_code" text DEFAULT '801' NOT NULL,
	"staff_code" text DEFAULT '802' NOT NULL,
	"pension_partner_id" integer,
	"health_partner_id" integer,
	"employment_partner_id" integer,
	"tax_partner_id" integer,
	"local_tax_partner_id" integer,
	CONSTRAINT "payroll_settings_single" CHECK ("payroll_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "withholding_tables" (
	"effective_from" date PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_audit" ADD CONSTRAINT "payroll_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_audit" ADD CONSTRAINT "payroll_audit_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_pension_partner_id_partners_id_fk" FOREIGN KEY ("pension_partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_health_partner_id_partners_id_fk" FOREIGN KEY ("health_partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_employment_partner_id_partners_id_fk" FOREIGN KEY ("employment_partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_tax_partner_id_partners_id_fk" FOREIGN KEY ("tax_partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_local_tax_partner_id_partners_id_fk" FOREIGN KEY ("local_tax_partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_rates_kind_from" ON "payroll_rates" USING btree ("kind","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_regular_month" ON "payroll_runs" USING btree ("year_month") WHERE "payroll_runs"."type" = 'regular';