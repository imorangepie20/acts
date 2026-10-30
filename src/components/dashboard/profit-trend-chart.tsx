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
import { formatKoreanShort, formatWon } from "@/lib/money";

export type TrendPoint = { month: string; revenue: number; operatingProfit: number; netProfit: number };

// Categorical slots 1 (blue) and 2 (orange) of the validated dataviz palette, light / dark steps.
const config = {
  revenue: { label: "매출액", theme: { light: "#2a78d6", dark: "#3987e5" } },
  operatingProfit: { label: "영업이익", theme: { light: "#eb6834", dark: "#d95926" } },
} satisfies ChartConfig;

const monthLabel = (m: string) => `${Number(m.slice(5))}월`;

/** 월별 손익 추이: bars for 매출액, a line for 영업이익, on one shared won axis. */
export function ProfitTrendChart({ data }: { data: TrendPoint[] }) {
  const rows = data.map((d) => ({ ...d, label: monthLabel(d.month) }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>월별 손익 추이</CardTitle>
        <CardDescription>
          {data[0]?.month} ~ {data.at(-1)?.month} · 월별
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ChartContainer config={config} className="h-72 w-full">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.4} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis
              width={72}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatKoreanShort(v)}
            />
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
            <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} maxBarSize={36} />
            <Line
              dataKey="operatingProfit"
              type="monotone"
              stroke="var(--color-operatingProfit)"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ChartContainer>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">표로 보기</summary>
          <table className="mt-2 w-full tabular-nums">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">월</th>
                <th className="py-1 text-right font-medium">매출액</th>
                <th className="py-1 text-right font-medium">영업이익</th>
                <th className="py-1 text-right font-medium">당기순이익</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month} className="border-t">
                  <td className="py-1">{d.month}</td>
                  <td className="py-1 text-right">{formatWon(d.revenue)}</td>
                  <td className="py-1 text-right">{formatWon(d.operatingProfit)}</td>
                  <td className="py-1 text-right">{formatWon(d.netProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </CardContent>
    </Card>
  );
}
