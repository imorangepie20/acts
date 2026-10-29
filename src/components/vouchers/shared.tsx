"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatWon } from "@/lib/money";
import type { SimpleInput, VatAccounts } from "@/lib/vouchers/simple";
import {
  VOUCHER_STATUS_LABELS,
  type LineInput,
  type VoucherInput,
  type VoucherStatus,
} from "@/lib/vouchers/types";
import { cn } from "@/lib/utils";
import type { AccountOption } from "./account-picker";

export type VoucherPayloadInput =
  | { mode: "simple"; simple: SimpleInput }
  | { mode: "general"; voucher: VoucherInput };

/** Fields shared by every tab; date and 사업장/부서 survive a reset after saving. */
export type Common = { date: string; description: string; siteId: number; departmentId: number | null };

/** What each entry form gets from the surrounding VoucherEntry. */
export type FormContext = {
  accounts: AccountOption[];
  vat: VatAccounts;
  common: Common;
  submit: (payload: VoucherPayloadInput) => void;
  /** Shows a client-side error above the save button. */
  fail: (message: string) => void;
  pending: boolean;
  error: string | null;
};

export const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";

export function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function SaveBar({ error, pending, disabled }: { error: string | null; pending: boolean; disabled?: boolean }) {
  return (
    <div className="flex flex-col items-end gap-2">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending || disabled} className="min-w-24">
        저장
      </Button>
    </div>
  );
}

export function accountLabel(accounts: AccountOption[], id: number): string {
  const a = accounts.find((x) => x.id === id);
  return a ? `${a.code} ${a.name}` : "(계정 선택)";
}

/** The journal lines a simple form will save, so the user sees the entry without composing it. */
export function LinesPreview({ lines, accounts }: { lines: LineInput[]; accounts: AccountOption[] }) {
  const total = (side: LineInput["side"]) => lines.filter((l) => l.side === side).reduce((s, l) => s + l.amount, 0);
  return (
    <div className="rounded-md border">
      <Table aria-label="분개 미리보기">
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">구분</TableHead>
            <TableHead>계정</TableHead>
            <TableHead className="text-right">차변</TableHead>
            <TableHead className="text-right">대변</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l, i) => (
            <TableRow key={i}>
              <TableCell>{l.side === "debit" ? "차변" : "대변"}</TableCell>
              <TableCell>{accountLabel(accounts, l.accountId)}</TableCell>
              <TableCell className="text-right tabular-nums">{l.side === "debit" ? formatWon(l.amount) : ""}</TableCell>
              <TableCell className="text-right tabular-nums">{l.side === "credit" ? formatWon(l.amount) : ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>합계</TableCell>
            <TableCell className="text-right tabular-nums">{formatWon(total("debit"))}</TableCell>
            <TableCell className="text-right tabular-nums">{formatWon(total("credit"))}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

const STATUS_VARIANT: Record<VoucherStatus, "secondary" | "outline" | "destructive"> = {
  approved: "secondary",
  pending: "outline",
  rejected: "destructive",
};

export function StatusBadge({ status }: { status: VoucherStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{VOUCHER_STATUS_LABELS[status]}</Badge>;
}
