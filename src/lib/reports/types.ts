export type ReportFilter = {
  from: string;
  to: string;
  siteId: number | null;
  departmentId: number | null;
};

export type AccountTotal = { accountId: number; debit: number; credit: number };

export type ReportMode = "period" | "asOf";
