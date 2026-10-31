"use client";

import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatWon } from "@/lib/money";
import {
  ENTRY_TYPE_LABELS,
  VOUCHER_KIND_LABELS,
  VOUCHER_STATUS_LABELS,
  formatVoucherNo,
  type VoucherKind,
  type VoucherStatus,
} from "@/lib/vouchers/types";
import type { VoucherListRow } from "@/server/vouchers/service";
import { Field, StatusBadge, selectClass } from "./shared";

export type VoucherFilters = { from: string; to: string; status: VoucherStatus | null; kind: VoucherKind | null; q: string };

type Props = {
  rows: VoucherListRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: VoucherFilters;
  canCreate: boolean;
};

function pageHref(f: VoucherFilters, page: number): string {
  const sp = new URLSearchParams({ from: f.from, to: f.to });
  if (f.status) sp.set("status", f.status);
  if (f.kind) sp.set("kind", f.kind);
  if (f.q) sp.set("q", f.q);
  if (page > 1) sp.set("page", String(page));
  return `/vouchers?${sp}`;
}

export function VoucherList({ rows, total, page, pageSize, filters, canCreate }: Props) {
  const router = useRouter();
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Form action="/vouchers" className="flex flex-wrap items-end gap-3">
          <Field label="시작일" htmlFor="filter-from">
            <Input id="filter-from" name="from" type="date" defaultValue={filters.from} className="w-40" />
          </Field>
          <Field label="종료일" htmlFor="filter-to">
            <Input id="filter-to" name="to" type="date" defaultValue={filters.to} className="w-40" />
          </Field>
          <Field label="상태" htmlFor="filter-status">
            <select id="filter-status" name="status" defaultValue={filters.status ?? ""} className={selectClass}>
              <option value="">전체</option>
              {(Object.keys(VOUCHER_STATUS_LABELS) as VoucherStatus[]).map((s) => (
                <option key={s} value={s}>
                  {VOUCHER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="구분" htmlFor="filter-kind">
            <select id="filter-kind" name="kind" defaultValue={filters.kind ?? ""} className={selectClass}>
              <option value="">전체</option>
              {(Object.keys(VOUCHER_KIND_LABELS) as VoucherKind[]).map((k) => (
                <option key={k} value={k}>
                  {VOUCHER_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="검색" htmlFor="filter-q">
            <Input id="filter-q" name="q" defaultValue={filters.q} placeholder="적요 또는 거래처" className="w-56" />
          </Field>
          <Button type="submit" variant="secondary">
            조회
          </Button>
        </Form>
        {canCreate && (
          <Button nativeButton={false} render={<Link href="/vouchers/new" />}>
            전표 입력
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>일자</TableHead>
              <TableHead>번호</TableHead>
              <TableHead>유형</TableHead>
              <TableHead>적요</TableHead>
              <TableHead>거래처</TableHead>
              <TableHead className="text-right">금액</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>작성자</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  조건에 맞는 전표가 없습니다.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow
                key={r.id}
                className={r.hidden ? undefined : "cursor-pointer"}
                onClick={r.hidden ? undefined : () => router.push(`/vouchers/${r.id}`)}
              >
                <TableCell className="tabular-nums">{r.date}</TableCell>
                <TableCell className="tabular-nums">
                  {r.hidden ? (
                    formatVoucherNo(r.date, r.no)
                  ) : (
                    <Link href={`/vouchers/${r.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                      {formatVoucherNo(r.date, r.no)}
                    </Link>
                  )}
                </TableCell>
                <TableCell>
                  {r.entryType !== null && ENTRY_TYPE_LABELS[r.entryType]}
                  {!r.hidden && r.kind !== "general" && (
                    <Badge variant="secondary" className="ml-2">
                      {VOUCHER_KIND_LABELS[r.kind]}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="max-w-72 truncate">{r.description}</TableCell>
                <TableCell>{r.partnerName ?? ""}</TableCell>
                <TableCell className="text-right tabular-nums">{r.amount === null ? "" : formatWon(r.amount)}</TableCell>
                <TableCell>
                  {r.status !== null && <StatusBadge status={r.status} />}
                </TableCell>
                <TableCell>{r.createdByName ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>총 {formatWon(total)}건</span>
        <div className="flex items-center gap-2">
          {page > 1 && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={pageHref(filters, page - 1)} />}>
              이전
            </Button>
          )}
          <span className="tabular-nums">
            {page} / {pages}
          </span>
          {page < pages && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={pageHref(filters, page + 1)} />}>
              다음
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
