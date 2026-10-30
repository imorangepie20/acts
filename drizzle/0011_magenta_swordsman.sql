CREATE TABLE "fiscal_year_closes" (
	"fiscal_start" date PRIMARY KEY NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"tax_figures" jsonb
);
--> statement-breakpoint
ALTER TABLE "fiscal_year_closes" ADD CONSTRAINT "fiscal_year_closes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;