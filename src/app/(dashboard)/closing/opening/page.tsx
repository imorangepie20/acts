import { OpeningForm } from "@/components/closing/opening-form";
import { YearClose } from "@/components/closing/year-close";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addDays, fiscalYearStart, shiftYear } from "@/lib/reports/fiscal";
import { isIsoDate, todayInSeoul } from "@/lib/vouchers/dates";
import { listAccounts } from "@/server/accounts/service";
import { requirePermission } from "@/server/auth/dal";
import { getOpening } from "@/server/closing/opening";
import { getYearEnd } from "@/server/closing/year";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";
import { listPartnersByIds } from "@/server/partners/service";

export default async function Page({ searchParams }: { searchParams: Promise<{ fy?: string | string[] }> }) {
  await requirePermission("period:close");
  const { fy } = await searchParams;
  const [opening, allAccounts, company] = await Promise.all([getOpening(db), listAccounts(db), getCompany(db)]);
  const partners = await listPartnersByIds(
    db,
    opening.lines.flatMap((l) => (l.partnerId === null ? [] : [l.partnerId])),
  );
  // Active accounts, plus any deactivated one already holding an opening balance (so a re-save keeps it).
  const used = new Set(opening.lines.map((l) => l.accountId));
  const accounts = allAccounts
    .filter((a) => a.isActive || used.has(a.id))
    .map(({ id, code, name, group, requiresPartner }) => ({ id, code, name, group, requiresPartner }));
  // Any date picks the fiscal year that contains it; anything else falls back to the current one.
  const base = typeof fy === "string" && isIsoDate(fy) ? fy : todayInSeoul();
  const fiscalStart = fiscalYearStart(base, company.fiscalYearStartMonth);
  const year = await getYearEnd(db, fiscalStart);
  const date = opening.date ?? addDays(fiscalYearStart(todayInSeoul(), company.fiscalYearStartMonth), -1);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">기초잔액·이월</h1>
      <Tabs defaultValue={typeof fy === "string" ? "carry" : "opening"} className="gap-4">
        <TabsList>
          <TabsTrigger value="opening" className="px-3">
            기초잔액
          </TabsTrigger>
          <TabsTrigger value="carry" className="px-3">
            연도 이월
          </TabsTrigger>
        </TabsList>
        <TabsContent value="opening">
          <OpeningForm
            // remount on every save so the form shows the stored voucher and its new version
            key={opening.version ?? 0}
            accounts={accounts}
            version={opening.version}
            date={date}
            lines={opening.lines}
            partnerNames={Object.fromEntries(partners.map((p) => [p.id, p.name]))}
          />
        </TabsContent>
        <TabsContent value="carry">
          <YearClose
            key={`${fiscalStart}-${year.closed}-${JSON.stringify(year.tax)}`}
            fiscalStart={year.fiscalStart}
            fiscalEnd={year.fiscalEnd}
            system={year.system}
            tax={year.tax}
            closed={year.closed}
            closedAt={year.closedAt?.toISOString() ?? null}
            allMonthsClosed={year.allMonthsClosed}
            prevHref={`/closing/opening?fy=${shiftYear(fiscalStart, -1)}`}
            nextHref={`/closing/opening?fy=${shiftYear(fiscalStart, 1)}`}
            monthsHref={`/closing?fy=${fiscalStart}`}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
