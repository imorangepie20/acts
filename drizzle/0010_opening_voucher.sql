-- The drizzle migrator runs every pending migration in ONE transaction, and Postgres refuses to use
-- an enum value added by ALTER TYPE ... ADD VALUE before that transaction commits ("unsafe use of
-- new value"). The partial index below needs 'opening', so the type is recreated instead: values of
-- a type created in the same transaction are usable at once. End state = ADD VALUE 'opening'.
ALTER TYPE "public"."voucher_kind" RENAME TO "voucher_kind_old";--> statement-breakpoint
CREATE TYPE "public"."voucher_kind" AS ENUM('general', 'closing', 'opening');--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "kind" SET DATA TYPE "public"."voucher_kind" USING "kind"::text::"public"."voucher_kind";--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "kind" SET DEFAULT 'general';--> statement-breakpoint
DROP TYPE "public"."voucher_kind_old";--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_single_opening_uq" ON "vouchers" USING btree ("kind") WHERE "vouchers"."kind" = 'opening';
