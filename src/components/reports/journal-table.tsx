import Link from "next/link";
import { Fragment } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatVoucherNo } from "@/lib/vouchers/types";
import type { JournalEntry } from "@/server/reports/ledgers";
import { Money } from "./money";

type Props = { entries: JournalEntry[]; debitSum: number; creditSum: number };

export function JournalTable({ entries, debitSum, creditSum }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>일자</TableHead>
          <TableHead>전표번호</TableHead>
          <TableHead>계정과목</TableHead>
          <TableHead>거래처</TableHead>
          <TableHead>적요</TableHead>
          <TableHead className="text-right">차변</TableHead>
          <TableHead className="text-right">대변</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
              해당 기간에 전표가 없습니다.
            </TableCell>
          </TableRow>
        )}
        {entries.map((e) => (
          <Fragment key={e.voucherId}>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableCell className="tabular-nums">{e.date}</TableCell>
              <TableCell>
                <Link href={`/vouchers/${e.voucherId}`} className="tabular-nums hover:underline">
                  {formatVoucherNo(e.date, e.no)}
                </Link>
              </TableCell>
              <TableCell colSpan={5} className="font-medium">
                {e.description}
              </TableCell>
            </TableRow>
            {e.lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell />
                <TableCell />
                <TableCell className={l.side === "credit" ? "pl-8" : "pl-4"}>
                  {l.code} {l.name}
                </TableCell>
                <TableCell>{l.partnerName ?? ""}</TableCell>
                <TableCell>{l.description}</TableCell>
                <TableCell>{l.side === "debit" ? <Money value={l.amount} /> : null}</TableCell>
                <TableCell>{l.side === "credit" ? <Money value={l.amount} /> : null}</TableCell>
              </TableRow>
            ))}
          </Fragment>
        ))}
      </TableBody>
      <tfoot>
        <TableRow className="border-t-2 bg-muted/50 font-semibold">
          <TableCell colSpan={5} className="text-right">
            합계
          </TableCell>
          <TableCell><Money value={debitSum} /></TableCell>
          <TableCell><Money value={creditSum} /></TableCell>
        </TableRow>
      </tfoot>
    </Table>
  );
}
