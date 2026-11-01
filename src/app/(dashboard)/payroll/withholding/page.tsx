import { PrintButton } from "@/components/payroll/print-button";
import { EMPTY_MONTHLY_NOTICE, EMPTY_SEMIANNUAL_NOTICE } from "@/lib/withholding/notices";
import { PeriodPicker } from "@/components/payroll/withholding/period-picker";
import { ReturnForm } from "@/components/payroll/withholding/return-form";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { loadReturnView, type SearchParams } from "@/server/withholding/return-view";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("payroll:manage");
  const view = await loadReturnView(db, await searchParams);
  // The Excel link carries the resolved selection, so it matches the page even when defaults applied.
  const s = view.selection;
  const qs = new URLSearchParams({ mode: s.mode, refund: String(s.refund) });
  if (s.mode === "monthly") {
    qs.set("pay", s.pay);
    if (s.attr) qs.set("attr", s.attr);
  } else {
    qs.set("year", String(s.year));
    qs.set("half", String(s.half));
  }

  return (
    <div className="flex flex-col gap-4" data-print-root>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-2xl font-semibold">원천세 신고</h1>
        <div className="flex gap-2">
          {view.forms.length > 0 && (
            <Button variant="outline" nativeButton={false} render={<a href={`/api/exports/withholding-return?${qs}`} />}>
              Excel
            </Button>
          )}
          <PrintButton />
        </div>
      </div>
      <PeriodPicker selection={s} />
      <p className="text-sm text-muted-foreground print:hidden">
        확정된 급여 대장만 집계합니다. 홈택스 입력을 돕는 참고 화면이며, 신고서는 홈택스에서 제출합니다.
      </p>
      {view.forms.length === 0 && (
        <p className="py-8 text-center text-muted-foreground print:hidden">{s.mode === "semiannual" ? EMPTY_SEMIANNUAL_NOTICE : EMPTY_MONTHLY_NOTICE}</p>
      )}
      {view.forms.map((f) => (
        <ReturnForm
          key={`${f.paymentMonth}|${f.attributionMonth}`}
          figures={f}
          company={view.company}
          semiannual={s.mode === "semiannual"}
        />
      ))}
    </div>
  );
}
