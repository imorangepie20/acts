import { PrintButton } from "@/components/payroll/print-button";
import { Button } from "@/components/ui/button";
import { CardStatement } from "@/components/vat/card-statement";
import { InvoiceSummary } from "@/components/vat/invoice-summary";
import { VatPeriodPicker } from "@/components/vat/vat-period-picker";
import { VatReturnForm } from "@/components/vat/vat-return-form";
import { formatBusinessNumber } from "@/lib/business-number";
import { formatWon } from "@/lib/money";
import { EMPTY_VAT_NOTICE, VAT_SOURCE_NOTICE } from "@/lib/vat/notices";
import { PAGE1_GROUPS, PAGE4_GROUPS } from "@/lib/vat/rows";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { loadVatView } from "@/server/vat/view";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("export:tax");
  const view = await loadVatView(db, await searchParams);
  // The Excel link carries the resolved selection, so it matches the page even when defaults applied.
  const s = view.selection;
  const qs = new URLSearchParams({ year: String(s.year), term: String(s.term), kind: s.kind, efile: s.efile ? "1" : "0" });
  if (s.kind === "final") {
    qs.set("prelim", s.prelimFiled ? "1" : "0");
    qs.set("prelimRefund", String(s.prelimRefund));
    qs.set("notice", String(s.notice));
  }
  const kindLabel = s.kind === "prelim" ? "예정" : "확정";
  const { result, company } = view;

  return (
    <div className="flex flex-col gap-4" data-print-root>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-2xl font-semibold">부가세 신고 자료</h1>
        <div className="flex gap-2">
          <Button variant="outline" nativeButton={false} render={<a href={`/api/exports/vat-return?${qs}`} />}>
            Excel
          </Button>
          <PrintButton />
        </div>
      </div>
      <VatPeriodPicker selection={s} />
      <div className="flex flex-col gap-1 text-sm print:hidden">
        <p className="text-muted-foreground">{VAT_SOURCE_NOTICE}</p>
        <p>
          {s.year}년 제{s.term}기 {kindLabel}신고 · {view.period.from} ~ {view.period.to} · 대상 전표{" "}
          {formatWon(result.entryCount)}건
        </p>
        {result.entryCount === 0 && <p className="font-medium">{EMPTY_VAT_NOTICE}</p>}
      </div>

      <div className="overflow-x-auto print:overflow-visible">
        <section
          className="mx-auto flex w-full min-w-[640px] max-w-[200mm] flex-col gap-5 rounded-md border bg-white p-6 text-xs text-neutral-900 print:min-w-0 print:max-w-none print:rounded-none print:border-0 print:p-0"
          aria-label="부가가치세 신고서"
        >
          <header className="flex flex-col gap-1">
            <h2 className="text-center text-lg font-semibold">일반과세자 부가가치세 {kindLabel}신고서</h2>
            <p className="text-center text-neutral-600">[별지 제21호서식] (2026. 3. 20. 개정)</p>
            <p className="text-center">
              {company.name}
              {company.businessNumber ? ` · ${formatBusinessNumber(company.businessNumber)}` : ""} · {view.period.from} ~ {view.period.to}
            </p>
            <p className="hidden text-center text-neutral-600 print:block">{VAT_SOURCE_NOTICE}</p>
          </header>
          <VatReturnForm title="제1쪽 ① 신고내용 · 과세표준명세" groups={PAGE1_GROUPS} result={result} />
          <VatReturnForm title="제4쪽 명세" groups={PAGE4_GROUPS} result={result} />
          <InvoiceSummary side="매출처" summary={result.sales} />
          <InvoiceSummary side="매입처" summary={result.purchases} withoutBusinessNumber={result.purchasesWithoutBusinessNumber} />
          <CardStatement card={result.card} />
        </section>
      </div>
    </div>
  );
}
