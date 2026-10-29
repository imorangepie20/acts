import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TrialBalance } from "@/lib/reports/trial-balance";
import { Money } from "./money";

type Props = {
  trialBalance: TrialBalance;
  asOf: string;
  fiscalStart: string;
  siteId: number | null;
  departmentId: number | null;
};

export function TrialBalanceTable({ trialBalance, asOf, fiscalStart, siteId, departmentId }: Props) {
  const ledgerHref = (accountId: number) => {
    const q = new URLSearchParams({ account: String(accountId), from: fiscalStart, to: asOf });
    if (siteId !== null) q.set("site", String(siteId));
    if (departmentId !== null) q.set("dept", String(departmentId));
    return `/ledgers/accounts?${q.toString()}`;
  };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-right">차변 잔액</TableHead>
          <TableHead className="text-right">차변 합계</TableHead>
          <TableHead>계정과목</TableHead>
          <TableHead className="text-right">대변 합계</TableHead>
          <TableHead className="text-right">대변 잔액</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trialBalance.rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
              해당 기준일까지 전표가 없습니다.
            </TableCell>
          </TableRow>
        )}
        {trialBalance.rows.map((r, i) => {
          if (r.kind === "group") {
            return (
              <TableRow key={`g${i}`} className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={5} className="font-semibold">
                  {r.label}
                </TableCell>
              </TableRow>
            );
          }
          const bold = r.kind === "subtotal";
          const cls = bold ? "font-semibold" : undefined;
          return (
            <TableRow key={`r${i}`} className={bold ? "bg-muted/30" : undefined}>
              <TableCell><Money value={r.debitBalance} className={cls} /></TableCell>
              <TableCell><Money value={r.debitTotal} className={cls} /></TableCell>
              <TableCell className={bold ? "text-right font-semibold" : "pl-4"}>
                {r.kind === "account" ? (
                  <Link href={ledgerHref(r.accountId)} className="hover:underline">
                    {r.code} {r.name}
                  </Link>
                ) : r.kind === "auto" ? (
                  r.name
                ) : (
                  r.label
                )}
              </TableCell>
              <TableCell><Money value={r.creditTotal} className={cls} /></TableCell>
              <TableCell><Money value={r.creditBalance} className={cls} /></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      <tfoot>
        <TableRow className="border-t-2 bg-muted/50 font-semibold">
          <TableCell><Money value={trialBalance.total.debitBalance} /></TableCell>
          <TableCell><Money value={trialBalance.total.debitTotal} /></TableCell>
          <TableCell className="text-right">합계</TableCell>
          <TableCell><Money value={trialBalance.total.creditTotal} /></TableCell>
          <TableCell><Money value={trialBalance.total.creditBalance} /></TableCell>
        </TableRow>
      </tfoot>
    </Table>
  );
}
