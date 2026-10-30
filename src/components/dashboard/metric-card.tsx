import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKoreanShort, formatWon } from "@/lib/money";

export const ROLE_MISSING_HINT = "계정과목에서 대시보드 구분을 지정하세요.";

/** One headline figure. `value` null means no account carries this dashboard role: show "—" and the hint. */
export function MetricCard({
  title,
  value,
  href,
  note,
}: {
  title: string;
  value: number | null;
  href: string;
  note?: string;
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
              <p className="text-3xl font-semibold tabular-nums text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground">{ROLE_MISSING_HINT}</p>
            </>
          ) : (
            <>
              <p
                className={`text-3xl font-semibold tabular-nums ${value < 0 ? "text-destructive" : ""}`}
                title={`${formatWon(value)}원`}
              >
                {formatKoreanShort(value)}
              </p>
              {note && <p className="text-xs text-muted-foreground">{note}</p>}
            </>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
