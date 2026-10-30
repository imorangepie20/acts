import { sql } from "drizzle-orm";
import type { VoucherSnapshot } from "@/lib/vouchers/types";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", [
  "staff",
  "manager",
  "executive",
  "admin",
]);

export const company = pgTable(
  "company",
  {
    id: integer("id").primaryKey().default(1),
    name: text("name").notNull(),
    businessNumber: text("business_number"),
    representative: text("representative"),
    fiscalYearStartMonth: integer("fiscal_year_start_month")
      .notNull()
      .default(1),
    approvalRequired: boolean("approval_required").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("company_single_row", sql`${t.id} = 1`),
    check(
      "company_fiscal_month",
      sql`${t.fiscalYearStartMonth} between 1 and 12`,
    ),
  ],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRole("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accountGroup = pgEnum("account_group", [
  "current_asset",
  "noncurrent_asset",
  "current_liability",
  "noncurrent_liability",
  "equity",
  "revenue",
  "cost_of_sales",
  "sga",
  "non_operating_income",
  "non_operating_expense",
  "income_tax",
]);

export const dashboardRole = pgEnum("dashboard_role", ["cash", "receivable", "payable"]);

export const accounts = pgTable("accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  group: accountGroup("account_group").notNull(),
  requiresPartner: boolean("requires_partner").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  isSystem: boolean("is_system").notNull().default(false),
  dashboardRole: dashboardRole("dashboard_role"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const partners = pgTable(
  "partners",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    businessNumber: text("business_number"),
    representative: text("representative"),
    phone: text("phone"),
    email: text("email"),
    memo: text("memo"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("partners_business_number_uq")
      .on(t.businessNumber)
      .where(sql`${t.businessNumber} is not null`),
  ],
);

export const sites = pgTable("sites", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  businessNumber: text("business_number"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const departments = pgTable("departments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voucherKind = pgEnum("voucher_kind", ["general", "closing"]);
export const voucherStatus = pgEnum("voucher_status", ["pending", "approved", "rejected"]);
export const entryType = pgEnum("entry_type", ["purchase", "sale", "transfer", "general"]);
export const evidenceType = pgEnum("evidence_type", [
  "tax_invoice",
  "invoice",
  "card",
  "cash_receipt",
  "simple_receipt",
  "none",
]);
export const vatType = pgEnum("vat_type", ["taxable", "zero_rated", "exempt"]);
export const lineSide = pgEnum("line_side", ["debit", "credit"]);
export const voucherAction = pgEnum("voucher_action", [
  "created",
  "updated",
  "deleted",
  "approved",
  "rejected",
  "attached",
  "detached",
]);

export const vouchers = pgTable(
  "vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date", { mode: "string" }).notNull(),
    no: integer("no").notNull(),
    kind: voucherKind("kind").notNull().default("general"),
    entryType: entryType("entry_type").notNull(),
    description: text("description").notNull().default(""),
    partnerId: integer("partner_id").references(() => partners.id),
    evidenceType: evidenceType("evidence_type").notNull().default("none"),
    vatType: vatType("vat_type"),
    vatDeductible: boolean("vat_deductible"),
    supplyAmount: bigint("supply_amount", { mode: "number" }),
    vatAmount: bigint("vat_amount", { mode: "number" }),
    status: voucherStatus("status").notNull(),
    rejectReason: text("reject_reason"),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("vouchers_date_no_uq").on(t.date, t.no),
    index("vouchers_date_idx").on(t.date),
    index("vouchers_status_date_idx").on(t.status, t.date),
  ],
);

export const voucherLines = pgTable(
  "voucher_lines",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    side: lineSide("side").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    partnerId: integer("partner_id").references(() => partners.id),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id),
    departmentId: integer("department_id").references(() => departments.id),
    description: text("description").notNull().default(""),
  },
  (t) => [
    check("voucher_lines_amount_positive", sql`${t.amount} > 0`),
    index("voucher_lines_voucher_id_idx").on(t.voucherId),
    index("voucher_lines_account_id_idx").on(t.accountId),
    index("voucher_lines_partner_id_idx").on(t.partnerId),
  ],
);

// No FK to vouchers: history outlives a deleted voucher.
export const voucherHistory = pgTable(
  "voucher_history",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    voucherId: uuid("voucher_id").notNull(),
    action: voucherAction("action").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    snapshot: jsonb("snapshot").$type<VoucherSnapshot>().notNull(),
    note: text("note"),
  },
  (t) => [index("voucher_history_voucher_id_idx").on(t.voucherId)],
);

export const voucherAttachments = pgTable(
  "voucher_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "cascade" }),
    /** Original name, for display only; never part of the filesystem path. */
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    /** Relative to the upload root: `yyyy/mm/<uuid>.<ext>`. */
    storagePath: text("storage_path").notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("voucher_attachments_voucher_id_idx").on(t.voucherId)],
);
