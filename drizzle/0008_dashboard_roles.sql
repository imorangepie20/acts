-- Fill dashboard roles on existing standard (system) accounts; the seed's ON CONFLICT DO NOTHING leaves them alone.
UPDATE "accounts" SET "dashboard_role" = 'cash' WHERE "is_system" AND "code" IN ('101','102','103','104','105','106');--> statement-breakpoint
UPDATE "accounts" SET "dashboard_role" = 'receivable' WHERE "is_system" AND "code" IN ('108','110','120');--> statement-breakpoint
UPDATE "accounts" SET "dashboard_role" = 'payable' WHERE "is_system" AND "code" IN ('251','252','253');
