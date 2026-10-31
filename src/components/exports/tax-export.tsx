import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Period } from "@/lib/reports/fiscal";
import type { PackageSummary } from "@/server/exports/package";

type Presets = { label: string; period: Period }[];

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const size = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024).toLocaleString("ko-KR")}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
const href = (p: Period) => `/exports?from=${p.from}&to=${p.to}`;

export function TaxExport({ period, presets, summary }: { period: Period; presets: Presets; summary: PackageSummary }) {
  const q = `from=${period.from}&to=${period.to}`;
  const downloads = [
    { label: "분개장", url: `/api/exports/journal?${q}` },
    { label: "합계잔액시산표", url: `/api/exports/trial-balance?${q}` },
    { label: "세금계산서 목록", url: `/api/exports/tax-invoices?${q}` },
    { label: "카드·현금영수증 목록", url: `/api/exports/card-purchases?${q}` },
  ];
  const rows = [
    { label: "매출 세금계산서", value: `${summary.invoicesSale.count}건 · ${won(summary.invoicesSale.total)}` },
    { label: "매입 세금계산서", value: `${summary.invoicesPurchase.count}건 · ${won(summary.invoicesPurchase.total)}` },
    { label: "카드·현금영수증 매입", value: `${summary.cards.count}건 · ${won(summary.cards.total)}` },
    { label: "증빙 파일", value: `${summary.attachments.count}개 · ${size(summary.attachments.bytes)}` },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>기간</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from">시작일</Label>
              <Input id="from" name="from" type="date" defaultValue={period.from} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to">종료일</Label>
              <Input id="to" name="to" type="date" defaultValue={period.to} required />
            </div>
            <Button type="submit" variant="outline">
              조회
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <Button
                key={p.label}
                size="sm"
                variant={p.period.from === period.from && p.period.to === period.to ? "secondary" : "outline"}
                nativeButton={false}
                render={<Link href={href(p.period)} />}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            포함 내용 ({period.from} ~ {period.to})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
            {rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className="text-right tabular-nums">{r.value}</dd>
              </div>
            ))}
          </dl>
          {summary.pending > 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400">승인 대기 {summary.pending}건은 포함되지 않습니다.</p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button nativeButton={false} render={<a href={`/api/exports/tax-package?${q}`} />}>
          전체 묶음(zip)
        </Button>
        {downloads.map((d) => (
          <Button key={d.label} variant="outline" nativeButton={false} render={<a href={d.url} />}>
            {d.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
