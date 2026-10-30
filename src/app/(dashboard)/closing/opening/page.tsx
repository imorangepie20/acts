import { Construction } from "lucide-react";
import { OpeningForm } from "@/components/closing/opening-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addDays, fiscalYearStart } from "@/lib/reports/fiscal";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { listAccounts } from "@/server/accounts/service";
import { requirePermission } from "@/server/auth/dal";
import { getOpening } from "@/server/closing/opening";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";
import { listPartnersByIds } from "@/server/partners/service";

export default async function Page() {
  await requirePermission("period:close");
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
  const date = opening.date ?? addDays(fiscalYearStart(todayInSeoul(), company.fiscalYearStartMonth), -1);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">기초잔액·이월</h1>
      <Tabs defaultValue="opening" className="gap-4">
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
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-24 text-center">
            <Construction className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">이후 단계에서 구현됩니다.</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
