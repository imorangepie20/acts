/** Period and site/department scope of a report. The statements take only this. */
export type ReportScope = {
  from: string;
  to: string;
  siteId: number | null;
  departmentId: number | null;
};

/**
 * Filter of the ledgers (분개장, 계정별/거래처별 원장). `hidePayroll` leaves out `kind = 'payroll'` vouchers, for
 * users without `payroll:manage`; the statements and the dashboard keep their totals.
 */
export type ReportFilter = ReportScope & { hidePayroll: boolean };

export type AccountTotal = { accountId: number; debit: number; credit: number };

export type ReportMode = "period" | "asOf";
