import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Comparison } from "@/lib/dashboard/kpi";
import { formatKoreanShort, formatWon } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ROLE_MISSING_HINT } from "./metric-card";

/** "up": an increase is good (매출, 이익, 현금); "neutral": no colour (줄 돈). */
export type Tone = "up" | "neutral";

/** ▲ 12.3% / ▼ 4.0% against `label`, or `missing` when there is nothing to compare with. */
export function Delta({ c, label, missing, tone = "up" }: { c: Comparison; label: string; missing: string; tone?: Tone }) {
  if (c.pct === null) return <p className="text-xs text-muted-foreground">{missing}</p>;
  const up = c.pct > 0;
  const flat = c.pct === 0;
  const color = tone === "neutral" || flat ? "text-muted-foreground" : up ? "text-emerald-600 dark:text-emerald-400" : "text-destructive";
  return (
    <p className="text-xs text-muted-foreground" title={c.previous === null ? undefined : `${label} ${formatWon(c.previous)}원`}>
      {label}{" "}
      <span className={cn("font-medium tabular-nums", color)}>
        {flat ? "―" : up ? "▲" : "▼"} {Math.abs(c.pct).toLocaleString("ko-KR")}%
      </span>
    </p>
  );
}

/** A headline figure with optional comparison lines; `value` null = no account carries the role. */
export function KpiCard({
  title,
  value,
  href,
  children,
}: {
  title: string;
  value: number | null;
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <Link href={href} className="group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <Card className="h-full transition-colors group-hover:bg-muted/40">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {value === null ? (
            <>
              <p className="text-2xl font-semibold tabular-nums text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground">{ROLE_MISSING_HINT}</p>
            </>
          ) : (
            <>
              <p
                className={cn("text-2xl font-semibold tabular-nums", value < 0 && "text-destructive")}
                title={`${formatWon(value)}원`}
              >
                {formatKoreanShort(value)}
              </p>
              {children}
            </>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
