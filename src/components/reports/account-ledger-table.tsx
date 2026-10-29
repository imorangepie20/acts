import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatVoucherNo } from "@/lib/vouchers/types";
import type { LedgerRow } from "@/server/reports/ledgers";
import { Money } from "./money";

export function AccountLedgerTable({ rows }: { rows: LedgerRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>일자</TableHead>
          <TableHead>전표번호</TableHead>
          <TableHead>적요</TableHead>
          <TableHead>거래처</TableHead>
          <TableHead className="text-right">차변</TableHead>
          <TableHead className="text-right">대변</TableHead>
          <TableHead className="text-right">잔액</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          switch (r.kind) {
            case "opening":
              return (
                <TableRow key={i} className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={6} className="font-medium">이월</TableCell>
                  <TableCell><Money value={r.balance} className="font-medium" /></TableCell>
                </TableRow>
              );
            case "line":
              return (
                <TableRow key={i}>
                  <TableCell className="tabular-nums">{r.date}</TableCell>
                  <TableCell>
                    <Link href={`/vouchers/${r.voucherId}`} className="tabular-nums hover:underline">
                      {formatVoucherNo(r.date, r.no)}
                    </Link>
                  </TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell>{r.partnerName ?? ""}</TableCell>
                  <TableCell>{r.debit ? <Money value={r.debit} /> : null}</TableCell>
                  <TableCell>{r.credit ? <Money value={r.credit} /> : null}</TableCell>
                  <TableCell><Money value={r.balance} /></TableCell>
                </TableRow>
              );
            case "month":
              return (
                <TableRow key={i} className="bg-muted/30 font-medium hover:bg-muted/30">
                  <TableCell colSpan={4} className="text-right">월계 ({r.month})</TableCell>
                  <TableCell><Money value={r.debit} /></TableCell>
                  <TableCell><Money value={r.credit} /></TableCell>
                  <TableCell />
                </TableRow>
              );
            case "cumulative":
              return (
                <TableRow key={i} className="bg-muted/30 font-medium hover:bg-muted/30">
                  <TableCell colSpan={4} className="text-right">누계</TableCell>
                  <TableCell><Money value={r.debit} /></TableCell>
                  <TableCell><Money value={r.credit} /></TableCell>
                  <TableCell />
                </TableRow>
              );
          }
        })}
      </TableBody>
    </Table>
  );
}
