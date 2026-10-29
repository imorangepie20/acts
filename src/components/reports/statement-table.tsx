import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StatementLine } from "@/lib/reports/statements";
import { cn } from "@/lib/utils";
import { Money } from "./money";

export type LedgerScope = { siteId: number | null; departmentId: number | null };

/** `/ledgers/accounts` link for one account over [from, to], keeping the site/department filter. */
export function accountLedgerHref(accountId: number, from: string, to: string, scope: LedgerScope): string {
  const q = new URLSearchParams({ account: String(accountId), from, to });
  if (scope.siteId !== null) q.set("site", String(scope.siteId));
  if (scope.departmentId !== null) q.set("dept", String(scope.departmentId));
  return `/ledgers/accounts?${q.toString()}`;
}

type Props = {
  lines: StatementLine[];
  currentLabel: string;
  priorLabel: string;
  ledgerHref: (accountId: number) => string;
  /** Section keys rendered as top-level headers (e.g. 자산/부채/자본). */
  headerKeys?: ReadonlySet<string>;
};

/** Two-column financial statement: 과목 | 당기 | 전기. */
export function StatementTable({ lines, currentLabel, priorLabel, ledgerHref, headerKeys }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>과목</TableHead>
          <TableHead className="text-right">{currentLabel}</TableHead>
          <TableHead className="text-right">{priorLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l, i) => {
          if (l.kind === "account") {
            return (
              <TableRow key={`a${i}`}>
                <TableCell className="pl-8">
                  {l.accountId === null ? (
                    l.name
                  ) : (
                    <Link href={ledgerHref(l.accountId)} className="hover:underline">
                      {l.code} {l.name}
                    </Link>
                  )}
                </TableCell>
                <TableCell><Money value={l.amount} /></TableCell>
                <TableCell><Money value={l.prior} /></TableCell>
              </TableRow>
            );
          }
          const header = l.kind === "section" && headerKeys?.has(l.key);
          return (
            <TableRow
              key={`${l.kind}-${l.key}`}
              className={cn(
                "font-semibold",
                header && "bg-muted/50 hover:bg-muted/50",
                l.kind === "computed" && "border-t-2 bg-muted/30 hover:bg-muted/30",
              )}
            >
              <TableCell className={cn(l.kind === "section" && !header && "pl-4")}>{l.label}</TableCell>
              <TableCell><Money value={l.amount} /></TableCell>
              <TableCell><Money value={l.prior} /></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
