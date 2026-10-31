"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatWon } from "@/lib/money";
import type { PreviewRow } from "@/server/imports/service";
import { AccountPicker, type AccountOption } from "@/components/vouchers/account-picker";

export type RowState = {
  checked: boolean;
  accountId: number | null;
  deductible: boolean;
  /** Voucher id once created. */
  voucherId: string | null;
  error: string | null;
};

type Props = {
  rows: PreviewRow[];
  states: RowState[];
  accounts: AccountOption[];
  onChange: (index: number, patch: Partial<RowState>) => void;
  onToggleAll: (checked: boolean) => void;
};

const STATUS_LABEL: Record<PreviewRow["status"], string> = {
  ready: "가능",
  duplicate: "이미 불러온 자료",
  blocked: "불가",
};

export function PreviewTable({ rows, states, accounts, onChange, onToggleAll }: Props) {
  const selectable = rows.flatMap((r, i) => (r.status === "ready" && !states[i].voucherId ? [i] : []));
  const allChecked = selectable.length > 0 && selectable.every((i) => states[i].checked);
  const purchase = rows[0]?.direction === "purchase";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">
            <Checkbox
              aria-label="전체 선택"
              checked={allChecked}
              disabled={selectable.length === 0}
              onCheckedChange={(c) => onToggleAll(c === true)}
            />
          </TableHead>
          <TableHead>날짜</TableHead>
          <TableHead>거래처/가맹점</TableHead>
          <TableHead>적요</TableHead>
          <TableHead className="text-right">공급가액</TableHead>
          <TableHead className="text-right">세액</TableHead>
          <TableHead className="text-right">합계</TableHead>
          <TableHead className="min-w-52">계정</TableHead>
          {purchase && <TableHead>공제</TableHead>}
          <TableHead>상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          const s = states[i];
          const locked = r.status !== "ready" || s.voucherId !== null;
          const rec = r.recommendations[0];
          const showRec = !locked && rec && rec.accountId === s.accountId;
          const name = r.partnerName ?? r.counterpartyName;
          return (
            <TableRow key={i} data-state={s.checked ? "selected" : undefined}>
              <TableCell>
                <Checkbox
                  aria-label={`${name || r.description} 선택`}
                  checked={s.checked}
                  disabled={locked}
                  onCheckedChange={(c) => onChange(i, { checked: c === true })}
                />
              </TableCell>
              <TableCell className="tabular-nums">{r.date ?? "-"}</TableCell>
              <TableCell>
                <span>{name}</span>
                {r.evidenceType !== "card" && r.partnerId === null && (
                  <Badge variant="secondary" className="ml-2">
                    새 거래처
                  </Badge>
                )}
              </TableCell>
              <TableCell className="max-w-48 truncate">{r.description}</TableCell>
              <TableCell className="text-right tabular-nums">{formatWon(r.supplyAmount)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatWon(r.vatAmount)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatWon(r.supplyAmount + r.vatAmount)}</TableCell>
              <TableCell>
                {locked ? null : (
                  <div className="flex flex-col gap-1">
                    <AccountPicker
                      label={`${name || r.description} 계정`}
                      accounts={accounts}
                      value={s.accountId}
                      onChange={(id) => onChange(i, { accountId: id })}
                      className="h-8"
                    />
                    {showRec && <span className="text-xs text-muted-foreground">{rec.reason}</span>}
                  </div>
                )}
              </TableCell>
              {purchase && (
                <TableCell>
                  {r.vatAmount > 0 && (
                    <Switch
                      aria-label={`${name || r.description} 공제`}
                      checked={s.deductible}
                      disabled={locked}
                      onCheckedChange={(c) => onChange(i, { deductible: c })}
                    />
                  )}
                </TableCell>
              )}
              <TableCell>
                {s.voucherId ? (
                  <Link href={`/vouchers/${s.voucherId}`} className="text-primary hover:underline">
                    전표 보기
                  </Link>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {r.status !== "ready" && (
                      <>
                        <Badge variant={r.status === "duplicate" ? "outline" : "destructive"}>
                          {STATUS_LABEL[r.status]}
                        </Badge>
                        {r.status === "blocked" && r.reason && (
                          <span className="text-xs text-muted-foreground">{r.reason}</span>
                        )}
                      </>
                    )}
                    {s.error && <span className="text-xs text-destructive">{s.error}</span>}
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
