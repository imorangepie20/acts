import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatWon } from "@/lib/money";

/** 이전/다음 links for a paged ledger; `href(p)` builds the URL for page p. */
export function LedgerPager({
  page,
  pages,
  totalLines,
  href,
}: {
  page: number;
  pages: number;
  totalLines: number;
  href: (p: number) => string;
}) {
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>총 {formatWon(totalLines)}줄</span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={href(page - 1)} />}>
              이전
            </Button>
          )}
          <span className="tabular-nums">
            {page} / {pages}
          </span>
          {page < pages && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={href(page + 1)} />}>
              다음
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
