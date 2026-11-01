import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AGING_BUCKETS, type AgingBucket } from "@/lib/dashboard/aging";
import type { CostComposition } from "@/lib/dashboard/costs";
import type { ScheduleItem } from "@/lib/dashboard/schedule";
import type { CurrentVatPeriod, VatEstimate } from "@/lib/dashboard/vat";
import { formatKoreanShort, formatWon } from "@/lib/money";
import { cn } from "@/lib/utils";

const won = (n: number) => (
  <span className="tabular-nums" title={`${formatWon(n)}원`}>
    {formatKoreanShort(n)}
  </span>
);
const linkClass = "underline-offset-4 hover:underline";
const pctText = (p: number | null) => (p === null ? "-" : `${p.toLocaleString("ko-KR")}%`);

const SCHEDULE_ROWS = 8;

const KIND_LABEL: Record<CurrentVatPeriod["kind"], string> = { prelim: "예정", final: "확정" };

/** 납부·지급 일정 from book balances; each row links to the account (or partner) ledger. */
export function ScheduleCard({
  items,
  asOf,
  ledgerHref,
}: {
  items: ScheduleItem[];
  asOf: string;
  ledgerHref: (item: ScheduleItem) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>납부·지급 일정</CardTitle>
        <CardDescription>{asOf} 장부 잔액 기준 · 기한이 주말이면 다음 월요일 (공휴일 미반영)</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">다가오는 납부·지급 건이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">기한</th>
                <th className="py-1 font-medium">항목</th>
                <th className="py-1 text-right font-medium">금액</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, SCHEDULE_ROWS).map((i, n) => (
                <tr key={`${i.kind}-${n}`} className="border-t align-top">
                  <td className="py-1.5 tabular-nums whitespace-nowrap">{i.due ?? "날짜 미정"}</td>
                  <td className="py-1.5">
                    <Link href={ledgerHref(i)} className={linkClass}>
                      {i.label}
                    </Link>
                    <p className="text-xs text-muted-foreground">{i.basis}</p>
                  </td>
                  <td className="py-1.5 text-right font-medium">{won(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {items.length > SCHEDULE_ROWS && (
          <p className="mt-2 text-xs text-muted-foreground">
            외 {items.length - SCHEDULE_ROWS}건 (합계 {formatKoreanShort(items.slice(SCHEDULE_ROWS).reduce((s, i) => s + i.amount, 0))})
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** 부가세 예상액 for the 과세기간 containing asOf, from approved 매입·매출 vouchers so far. */
export function VatEstimateCard({
  period,
  estimate,
  asOf,
  href,
}: {
  period: CurrentVatPeriod;
  estimate: VatEstimate;
  asOf: string;
  href: string;
}) {
  const refund = estimate.payable < 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>부가세 예상액</CardTitle>
        <CardDescription>
          {period.year}년 {period.term}기 {KIND_LABEL[period.kind]} ({period.from} ~ {period.to}) · {asOf}까지 승인된 매입·매출 전표 기준
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">매출세액 ({estimate.saleCount}건)</dt>
          <dd className="text-right font-medium">{won(estimate.outputTax)}</dd>
          <dt className="text-muted-foreground">공제 매입세액 ({estimate.purchaseCount}건 중 공제분)</dt>
          <dd className="text-right font-medium">{won(estimate.inputTax)}</dd>
          <dt className="font-medium">{refund ? "예상 환급세액" : "예상 납부세액"}</dt>
          <dd className={cn("text-right text-lg font-semibold", refund && "text-emerald-600 dark:text-emerald-400")}>
            {won(Math.abs(estimate.payable))}
          </dd>
          <dt className="text-muted-foreground">신고·납부 기한</dt>
          <dd className="text-right tabular-nums">{period.due}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">대손세액, 예정고지세액, 전자신고 세액공제 등 기타 가감은 반영하지 않았습니다.</p>
        <Link href={href} className={cn("text-sm", linkClass)}>
          부가세 신고 자료 보기
        </Link>
      </CardContent>
    </Card>
  );
}

export type PartnerLink = { name: string; amount: number; href: string };

/** 채권·채무 분석: top partners on each side and the 외상매출금 aging. */
export function PartnersCard({
  receivables,
  payables,
  aging,
  agingHref,
}: {
  receivables: PartnerLink[];
  payables: PartnerLink[];
  aging: Record<AgingBucket, number>;
  agingHref: string | null;
}) {
  const agingTotal = AGING_BUCKETS.reduce((s, b) => s + aging[b], 0);
  const list = (title: string, rows: PartnerLink[]) => (
    <div className="space-y-1">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">잔액이 있는 거래처가 없습니다.</p>
      ) : (
        <ol className="space-y-1 text-sm">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex min-w-0 justify-between gap-3">
              <Link href={r.href} className={cn("truncate", linkClass)}>
                {i + 1}. {r.name}
              </Link>
              <span className="shrink-0 font-medium whitespace-nowrap">{won(r.amount)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>채권·채무 분석</CardTitle>
        <CardDescription>거래처별 잔액 상위 5곳 · 받을 돈 108·110·120, 줄 돈 251·252·253</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {list("받을 돈 상위 거래처", receivables)}
          {list("줄 돈 상위 거래처", payables)}
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            {agingHref ? (
              <Link href={agingHref} className={linkClass}>
                외상매출금 연령 분석
              </Link>
            ) : (
              "외상매출금 연령 분석"
            )}
          </h3>
          <table className="w-full text-sm" aria-label="외상매출금 연령 분석">
            <tbody>
              {AGING_BUCKETS.map((b) => {
                const share = agingTotal === 0 ? 0 : (aging[b] / agingTotal) * 100;
                return (
                  <tr key={b}>
                    <th scope="row" className="w-24 py-1 text-left font-normal text-muted-foreground">
                      {b}
                    </th>
                    <td className="py-1">
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className={cn("h-2 rounded-full", b === "90일 초과" ? "bg-destructive" : "bg-[#2a78d6] dark:bg-[#3987e5]")}
                          style={{ width: `${share}%` }}
                        />
                      </div>
                    </td>
                    <td className="w-28 py-1 text-right font-medium">{won(aging[b])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">입금은 오래된 외상부터 갚은 것으로 보고(선입선출) 남은 금액을 발생일 기준으로 나눴습니다.</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** 비용 구성: 판관비 YTD by account with share and prior-year change, plus 인건비. */
export function CostCard({
  costs,
  rowHref,
  hasPrior,
}: {
  costs: CostComposition;
  rowHref: (accountId: number) => string;
  hasPrior: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>비용 구성</CardTitle>
        <CardDescription>
          판매비와관리비 누적 {won(costs.total)} · 상위 7개 계정{hasPrior ? " · 괄호는 전년 동기 대비" : " · 전년 자료 없음"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {costs.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">판매비와관리비가 없습니다.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {costs.rows.map((r) => (
              <li key={r.label} className="space-y-1">
                <div className="flex justify-between gap-3">
                  {r.accountId === null ? (
                    <span>{r.label}</span>
                  ) : (
                    <Link href={rowHref(r.accountId)} className={linkClass}>
                      {r.label}
                    </Link>
                  )}
                  <span className="whitespace-nowrap">
                    <span className="font-medium">{won(r.amount)}</span>
                    <span className="ml-2 text-muted-foreground tabular-nums">{pctText(r.share)}</span>
                    {r.changePct !== null && (
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                        ({r.changePct > 0 ? "+" : ""}
                        {r.changePct.toLocaleString("ko-KR")}%)
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-[#eb6834] dark:bg-[#d95926]" style={{ width: `${r.share}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p>
            인건비 <span className="font-semibold">{won(costs.labor.amount)}</span>
            <span className="ml-1 text-xs text-muted-foreground">({costs.labor.codes.join("·") || "해당 계정 없음"})</span>
          </p>
          <p className="text-muted-foreground">
            판관비의 {pctText(costs.labor.shareOfCosts)} · 매출액의 {pctText(costs.labor.shareOfRevenue)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
