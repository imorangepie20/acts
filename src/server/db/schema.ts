import { sql } from "drizzle-orm";
import type { VoucherSnapshot } from "@/lib/vouchers/types";
import type { ImportMeta } from "@/lib/imports/types";
import type { TemplateBody } from "@/lib/vouchers/templates";
import type { WithholdingTable } from "@/lib/payroll/types";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
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
    /** Second factor passed in this session (only meaningful when the user is enrolled). */
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** TOTP enrolment: one row per user; `enabled_at` null until the first code is confirmed. */
export const userTotp = pgTable("user_totp", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** base32 secret, encrypted with encryptSecret */
  secret: text("secret").notNull(),
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  /** keyed HMAC (hex) of each unused recovery code, see keyedHash("totp-recovery") */
  recoveryCodes: text("recovery_codes").array().notNull().default(sql`'{}'::text[]`),
  /** 30-second step of the last accepted code; a code at or before it is a replay */
  lastUsedStep: bigint("last_used_step", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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

export const voucherKind = pgEnum("voucher_kind", ["general", "closing", "opening", "payroll"]);
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
    // At most one 기초 (opening) voucher: the pre-adoption balances as of the cut-off.
    uniqueIndex("vouchers_single_opening_uq").on(t.kind).where(sql`${t.kind} = 'opening'`),
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

/** A closed month (`YYYY-MM`): its vouchers can no longer be added, changed or deleted. */
export const periodCloses = pgTable(
  "period_closes",
  {
    month: text("month").primaryKey(),
    closedBy: uuid("closed_by")
      .notNull()
      .references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("period_closes_month_format", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)],
);

/**
 * A fiscal year's 세무사 reconciliation. `taxFigures` (what the 세무사 filed) may be saved while the
 * year is open; `closedAt` / `closedBy` are set once the year is closed (all 12 months closed).
 */
export const fiscalYearCloses = pgTable("fiscal_year_closes", {
  fiscalStart: date("fiscal_start").primaryKey(),
  closedBy: uuid("closed_by").references(() => users.id),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  taxFigures: jsonb("tax_figures").$type<{
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    netIncome: number;
  }>(),
});

/** A reusable entry pre-fill. Date, site and department are never stored; body is a TemplateBody. */
export const voucherTemplates = pgTable("voucher_templates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  entryType: entryType("entry_type").notNull(),
  body: jsonb("body").$type<TemplateBody>().notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importSource = pgEnum("import_source", ["tax_invoice", "card"]);

/** One row per imported voucher; deleting the voucher frees the key for re-import. */
export const voucherImports = pgTable("voucher_imports", {
  importKey: text("import_key").primaryKey(),
  voucherId: uuid("voucher_id")
    .notNull()
    .unique()
    .references(() => vouchers.id, { onDelete: "cascade" }),
  source: importSource("source").notNull(),
  meta: jsonb("meta").$type<ImportMeta>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- Phase 2: payroll ----

export const payrollItemKind = pgEnum("payroll_item_kind", ["earning"]);
export const payrollRateKind = pgEnum("payroll_rate_kind", [
  "pension_employee",
  "pension_company",
  "pension_cap",
  "pension_floor",
  "health_employee",
  "health_company",
  "ltc_employee",
  "ltc_company",
  "employment_employee",
  "employment_company",
]);
export const payrollRunType = pgEnum("payroll_run_type", ["regular", "bonus"]);
export const payrollRunStatus = pgEnum("payroll_run_status", ["draft", "confirmed"]);
export const payrollAuditField = pgEnum("payroll_audit_field", ["rrn", "account"]);

export const employees = pgTable(
  "employees",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    employeeNo: text("employee_no").notNull().unique(),
    name: text("name").notNull(),
    rrnEnc: text("rrn_enc").notNull(),
    rrnHmac: text("rrn_hmac").notNull().unique(),
    hiredOn: date("hired_on", { mode: "string" }).notNull(),
    leftOn: date("left_on", { mode: "string" }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id),
    departmentId: integer("department_id").references(() => departments.id),
    isExecutive: boolean("is_executive").notNull().default(false),
    /** 공제대상가족 count, including the employee. */
    dependents: integer("dependents").notNull().default(1),
    /** Children aged 8 to 20. */
    children: integer("children").notNull().default(0),
    withholdingRate: smallint("withholding_rate").notNull().default(100),
    bank: text("bank"),
    accountEnc: text("account_enc"),
    accountLast4: text("account_last4"),
    insPension: boolean("ins_pension").notNull().default(true),
    insHealth: boolean("ins_health").notNull().default(true),
    insEmployment: boolean("ins_employment").notNull().default(true),
    /** 기준소득월액 */
    pensionBase: bigint("pension_base", { mode: "number" }).notNull().default(0),
    /** 보수월액 */
    healthBase: bigint("health_base", { mode: "number" }).notNull().default(0),
    defaultAmounts: jsonb("default_amounts").$type<Record<string, number>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("employees_dependents_min", sql`${t.dependents} >= 1`),
    check("employees_children_min", sql`${t.children} >= 0`),
    check("employees_withholding_rate", sql`${t.withholdingRate} in (80, 100, 120)`),
  ],
);

export const payrollItems = pgTable("payroll_items", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  kind: payrollItemKind("kind").notNull().default("earning"),
  taxable: boolean("taxable").notNull().default(true),
  nontaxLimit: bigint("nontax_limit", { mode: "number" }),
  inEmploymentBase: boolean("in_employment_base").notNull().default(true),
  /** null = 801/802 by 임원 여부. */
  debitAccountCode: text("debit_account_code"),
  sort: integer("sort").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const payrollSettings = pgTable(
  "payroll_settings",
  {
    id: integer("id").primaryKey().default(1),
    pensionCompanyCode: text("pension_company_code").notNull().default("817"),
    insuranceCompanyCode: text("insurance_company_code").notNull().default("811"),
    withholdingCode: text("withholding_code").notNull().default("254"),
    companyPayableCode: text("company_payable_code").notNull().default("262"),
    netPayCode: text("net_pay_code").notNull().default("103"),
    executiveCode: text("executive_code").notNull().default("801"),
    staffCode: text("staff_code").notNull().default("802"),
    pensionPartnerId: integer("pension_partner_id").references(() => partners.id),
    healthPartnerId: integer("health_partner_id").references(() => partners.id),
    employmentPartnerId: integer("employment_partner_id").references(() => partners.id),
    taxPartnerId: integer("tax_partner_id").references(() => partners.id),
    localTaxPartnerId: integer("local_tax_partner_id").references(() => partners.id),
  },
  (t) => [check("payroll_settings_single", sql`${t.id} = 1`)],
);

export const payrollRates = pgTable(
  "payroll_rates",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    kind: payrollRateKind("kind").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    /** Percent rates are stored as percent (4.75); caps and floors in won. */
    value: numeric("value", { precision: 15, scale: 6 }).notNull(),
  },
  (t) => [uniqueIndex("payroll_rates_kind_from").on(t.kind, t.effectiveFrom)],
);

export const withholdingTables = pgTable("withholding_tables", {
  effectiveFrom: date("effective_from", { mode: "string" }).primaryKey(),
  data: jsonb("data").$type<WithholdingTable>().notNull(),
});

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: payrollRunType("type").notNull(),
    yearMonth: text("year_month").notNull(),
    payDate: date("pay_date", { mode: "string" }).notNull(),
    bonusFrom: text("bonus_from"),
    bonusTo: text("bonus_to"),
    status: payrollRunStatus("status").notNull().default("draft"),
    voucherId: uuid("voucher_id").references(() => vouchers.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payroll_runs_regular_month")
      .on(t.yearMonth)
      .where(sql`${t.type} = 'regular'`),
  ],
);

export const payrollRunLines = pgTable(
  "payroll_run_lines",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id),
    amounts: jsonb("amounts").$type<Record<string, number>>().notNull().default({}),
    /** Partial<Record<DeductionKey, number>> */
    overrides: jsonb("overrides").$type<Record<string, number>>().notNull().default({}),
    /** LineResult: the last computed values with overrides applied. */
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    /** Employee facts at compute time, so payslips stay stable after edits. */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.runId, t.employeeId] })],
);

export const payrollAudit = pgTable("payroll_audit", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id),
  field: payrollAuditField("field").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
