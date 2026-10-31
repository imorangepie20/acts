import { TaxExport } from "@/components/exports/tax-export";
import { lastMonth, lastQuarter, yearToDate } from "@/components/exports/periods";
import { isIsoDate, todayInSeoul } from "@/lib/vouchers/dates";
import { requirePermission } from "@/server/auth/dal";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";
import { getPackageSummary } from "@/server/exports/package";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("export:tax");
  const sp = await searchParams;
  const today = todayInSeoul();
  const company = await getCompany(db);
  const presets = [
    { label: "지난달", period: lastMonth(today) },
    { label: "지난 분기", period: lastQuarter(today) },
    { label: "올해", period: yearToDate(today, company.fiscalYearStartMonth) },
  ];
  const from = one(sp.from);
  const to = one(sp.to);
  const period = isIsoDate(from) && isIsoDate(to) && from <= to ? { from, to } : presets[1].period;
  const summary = await getPackageSummary(db, period.from, period.to);
  return <TaxExport period={period} presets={presets} summary={summary} />;
}
