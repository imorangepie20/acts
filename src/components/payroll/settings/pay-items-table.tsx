"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountPicker, type AccountOption } from "@/components/vouchers/account-picker";
import { MoneyInput } from "@/components/vouchers/money-input";
import { formatWon } from "@/lib/money";
import type { PayItemRow } from "@/server/payroll/items";
import { deletePayItemAction, savePayItemAction } from "@/app/(dashboard)/payroll/settings/actions";

export type PayItemView = PayItemRow & { builtin: boolean };

type Props = { items: PayItemView[]; accounts: AccountOption[] };

const EMPTY: PayItemRow = {
  code: "",
  name: "",
  taxable: true,
  nontaxLimit: null,
  inEmploymentBase: true,
  debitAccountCode: null,
  sort: 100,
  isActive: true,
};

function ItemForm({
  initial,
  isNew,
  accounts,
  onDone,
}: {
  initial: PayItemRow;
  isNew: boolean;
  accounts: AccountOption[];
  onDone: () => void;
}) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof PayItemRow>(k: K, value: PayItemRow[K]) => setV((s) => ({ ...s, [k]: value }));
  const salary = v.debitAccountCode === null;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await savePayItemAction(
            { ...v, nontaxLimit: v.taxable ? null : (v.nontaxLimit ?? 0) },
            isNew ? "create" : "update",
          );
          if (r.ok) {
            toast.success(isNew ? "급여 항목을 추가했습니다." : "저장했습니다.");
            onDone();
          } else setError(r.error);
        });
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="item-code">코드</Label>
          <Input
            id="item-code"
            value={v.code}
            onChange={(e) => set("code", e.target.value)}
            disabled={!isNew}
            placeholder="family_allowance"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="item-name">이름</Label>
          <Input id="item-name" value={v.name} onChange={(e) => set("name", e.target.value)} required />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="item-taxable" checked={v.taxable} onCheckedChange={(c) => set("taxable", c)} />
        <Label htmlFor="item-taxable">과세</Label>
      </div>
      {!v.taxable && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="item-limit">비과세 월 한도</Label>
          <MoneyInput id="item-limit" value={v.nontaxLimit} onValueChange={(n) => set("nontaxLimit", n)} />
          <p className="text-xs text-muted-foreground">한도를 넘는 금액은 과세됩니다.</p>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Switch
          id="item-employment"
          checked={v.inEmploymentBase}
          onCheckedChange={(c) => set("inEmploymentBase", c)}
        />
        <Label htmlFor="item-employment">고용보험 보수에 포함</Label>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Switch
            id="item-salary"
            checked={salary}
            onCheckedChange={(c) => set("debitAccountCode", c ? null : (accounts.find((a) => a.code === "802")?.code ?? ""))}
          />
          <Label htmlFor="item-salary">임원급여·직원급여 계정 사용 (임원 여부로 나눔)</Label>
        </div>
        {!salary && (
          <AccountPicker
            label="전표 계정"
            accounts={accounts}
            value={accounts.find((a) => a.code === v.debitAccountCode)?.id ?? null}
            onChange={(id) => set("debitAccountCode", accounts.find((a) => a.id === id)?.code ?? null)}
          />
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="item-sort">정렬 순서</Label>
          <Input
            id="item-sort"
            type="number"
            value={v.sort}
            onChange={(e) => set("sort", Number(e.target.value))}
            required
          />
        </div>
        <div className="flex items-end gap-3 pb-1.5">
          <Switch id="item-active" checked={v.isActive} onCheckedChange={(c) => set("isActive", c)} />
          <Label htmlFor="item-active">사용</Label>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {isNew ? "추가" : "저장"}
      </Button>
    </form>
  );
}

export function PayItemsTable({ items, accounts }: Props) {
  const [editing, setEditing] = useState<{ item: PayItemRow; isNew: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const accountName = (code: string | null) => {
    if (code === null) return "임원급여·직원급여";
    const a = accounts.find((x) => x.code === code);
    return a ? `${a.code} ${a.name}` : `${code} (사용 안 함)`;
  };
  const remove = (code: string) =>
    startTransition(async () => {
      const r = await deletePayItemAction(code);
      if (r.ok) toast.success("급여 항목을 삭제했습니다.");
      else toast.error(r.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>급여 항목</CardTitle>
        <CardDescription>지급 항목의 과세 여부, 비과세 한도, 고용보험 보수 포함 여부와 전표 계정입니다.</CardDescription>
        <CardAction>
          <Button onClick={() => setEditing({ item: EMPTY, isNew: true })}>항목 추가</Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>코드</TableHead>
                <TableHead>이름</TableHead>
                <TableHead>과세</TableHead>
                <TableHead className="text-right">비과세 한도</TableHead>
                <TableHead>고용보험 보수</TableHead>
                <TableHead>전표 계정</TableHead>
                <TableHead>상태</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.code}>
                  <TableCell className="font-mono text-xs">{i.code}</TableCell>
                  <TableCell>{i.name}</TableCell>
                  <TableCell>{i.taxable ? "과세" : "비과세"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {i.nontaxLimit === null ? "-" : formatWon(i.nontaxLimit)}
                  </TableCell>
                  <TableCell>{i.inEmploymentBase ? "포함" : "제외"}</TableCell>
                  <TableCell>{accountName(i.debitAccountCode)}</TableCell>
                  <TableCell>
                    <Badge variant={i.isActive ? "secondary" : "destructive"}>{i.isActive ? "사용" : "중지"}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ item: i, isNew: false })}>
                        수정
                      </Button>
                      {!i.builtin && (
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(i.code)}>
                          삭제
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>{editing.isNew ? "급여 항목 추가" : "급여 항목 수정"}</DialogTitle>
              </DialogHeader>
              <ItemForm
                initial={editing.item}
                isNew={editing.isNew}
                accounts={accounts}
                onDone={() => setEditing(null)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
