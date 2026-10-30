import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKoreanShort, formatWon } from "@/lib/money";

export function PositionSummary({
  position,
  href,
}: {
  position: { assets: number; liabilities: number; equity: number };
  href: string;
}) {
  const items = [
    { label: "자산", value: position.assets },
    { label: "부채", value: position.liabilities },
    { label: "자본", value: position.equity },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Link href={href} className="hover:underline">
            재무상태 요약
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-3 gap-4">
          {items.map((i) => (
            <div key={i.label} className="space-y-1">
              <dt className="text-sm text-muted-foreground">{i.label}</dt>
              <dd className="text-xl font-semibold tabular-nums" title={`${formatWon(i.value)}원`}>
                {formatKoreanShort(i.value)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
