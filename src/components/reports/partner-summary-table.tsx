import Link from "next/link";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PartnerSummaryRow } from "@/server/reports/ledgers";
import { Money } from "./money";

/** 거래처별 summary; names link to `href(partnerId)` (the partner's ledger). */
export function PartnerSummaryTable({
  rows,
  href,
}: {
  rows: PartnerSummaryRow[];
  href: (partnerId: number) => string;
}) {
  const sum = (k: "opening" | "debit" | "credit" | "closing") => rows.reduce((t, r) => t + r[k], 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>거래처</TableHead>
          <TableHead className="text-right">이월</TableHead>
          <TableHead className="text-right">차변</TableHead>
          <TableHead className="text-right">대변</TableHead>
          <TableHead className="text-right">잔액</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
              해당 기간에 거래가 없습니다.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r) => (
            <TableRow key={r.partnerId ?? "none"}>
              <TableCell>
                {r.partnerId === null ? (
                  r.partnerName
                ) : (
                  <Link href={href(r.partnerId)} className="hover:underline">
                    {r.partnerName}
                  </Link>
                )}
              </TableCell>
              <TableCell><Money value={r.opening} /></TableCell>
              <TableCell><Money value={r.debit} /></TableCell>
              <TableCell><Money value={r.credit} /></TableCell>
              <TableCell><Money value={r.closing} /></TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
      {rows.length > 0 && (
        <TableFooter>
          <TableRow className="font-medium">
            <TableCell>합계</TableCell>
            <TableCell><Money value={sum("opening")} /></TableCell>
            <TableCell><Money value={sum("debit")} /></TableCell>
            <TableCell><Money value={sum("credit")} /></TableCell>
            <TableCell><Money value={sum("closing")} /></TableCell>
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}
