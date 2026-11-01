"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { CashMonth, Runway } from "@/lib/dashboard/cash";
import { formatKoreanShort, formatWon } from "@/lib/money";

// Categorical slots 1 (blue) and 2 (orange) plus a neutral foreground line for the net.
const config = {
  inflow: { label: "유입", theme: { light: "#2a78d6", dark: "#3987e5" } },
  outflow: { label: "유출", theme: { light: "#eb6834", dark: "#d95926" } },
  net: { label: "순증감", theme: { light: "#3f3f46", dark: "#d4d4d8" } },
} satisfies ChartConfig;

const monthLabel = (m: string) => `${Number(m.slice(5))}월`;

/** 현금 흐름 추이: monthly in/out bars on cash-role accounts, a net line, and the 런웨이. */
export function CashFlowChart({ data, runway, cash }: { data: CashMonth[]; runway: Runway; cash: number }) {
  const rows = data.map((d) => ({ ...d, label: monthLabel(d.month), outflow: d.outflow }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>현금 흐름 추이</CardTitle>
        <CardDescription>현금·예금 계정의 월별 유입·유출 (계정 간 이체는 양쪽에 함께 잡혀 순증감에는 영향이 없습니다)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-sm text-muted-foreground">
            현재 잔액 <span className="font-semibold text-foreground tabular-nums" title={`${formatWon(cash)}원`}>{formatKoreanShort(cash)}</span>
          </p>
          {runway ? (
            <p className="text-sm text-muted-foreground">
              런웨이 <span className="font-semibold text-foreground tabular-nums">약 {runway.months.toLocaleString("ko-KR")}개월치 지출</span>
              <span className="ml-1 text-xs">
                (최근 {runway.basisMonths.length}개월 평균 유출 {formatKoreanShort(runway.avgOutflow)} 기준)
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">런웨이: 최근 3개월 유출 자료 없음</p>
          )}
        </div>
        <ChartContainer config={config} className="h-64 w-full">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.4} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis width={72} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatKoreanShort(v)} />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-6">
                      <span className="text-muted-foreground">{config[name as keyof typeof config]?.label ?? name}</span>
                      <span className="font-medium tabular-nums" title={`${formatWon(Number(value))}원`}>
                        {formatKoreanShort(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="inflow" fill="var(--color-inflow)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="outflow" fill="var(--color-outflow)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            <Line dataKey="net" type="monotone" stroke="var(--color-net)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ChartContainer>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">표로 보기</summary>
          <table className="mt-2 w-full tabular-nums">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">월</th>
                <th className="py-1 text-right font-medium">유입</th>
                <th className="py-1 text-right font-medium">유출</th>
                <th className="py-1 text-right font-medium">순증감</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month} className="border-t">
                  <td className="py-1">{d.month}</td>
                  <td className="py-1 text-right">{formatWon(d.inflow)}</td>
                  <td className="py-1 text-right">{formatWon(d.outflow)}</td>
                  <td className="py-1 text-right">{formatWon(d.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </CardContent>
    </Card>
  );
}
