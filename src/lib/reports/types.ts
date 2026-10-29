export type ReportFilter = {
  from: string;
  to: string;
  siteId: number | null;
  departmentId: number | null;
};

export type ReportMode = "period" | "asOf";
