"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { saveOpeningAction } from "@/app/(dashboard)/closing/opening/actions";
import { PartnerPicker, type PartnerValue } from "@/components/vouchers/partner-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ACCOUNT_GROUP_LABELS, ACCOUNT_GROUPS, normalSideOf, type AccountGroup } from "@/lib/accounts";
import { formatWon, parseSignedWon } from "@/lib/money";
import { cn } from "@/lib/utils";

export type OpeningAccount = { id: number; code: string; name: string; group: AccountGroup; requiresPartner: boolean };
type Line = { accountId: number; partnerId: number | null; balance: number };
type PartnerRow = { key: number; partner: PartnerValue; balance: number | null };

type Props = {
  accounts: OpeningAccount[];
  version: number | null;
  date: string;
  lines: Line[];
  partnerNames: Record<number, string>;
};

const SIDE_LABEL = { debit: "차변", credit: "대변" } as const;

/** Signed won input: thousands separators while typing, a leading minus allowed; reports validity. */
function BalanceInput({
  label,
  initial,
  onChange,
}: {
  label: string;
  initial: number | null;
  onChange: (value: number | null, valid: boolean) => void;
}) {
  const [text, setText] = useState(initial === null || initial === 0 ? "" : formatWon(initial));
  const invalid = text.trim() !== "" && parseSignedWon(text) === null;
  return (
    <div className="flex flex-col items-end gap-1">
      <Input
        aria-label={label}
        inputMode="numeric"
        autoComplete="off"
        value={text}
        aria-invalid={invalid || undefined}
        className="w-40 text-right tabular-nums"
        onChange={(e) => {
          const raw = e.target.value;
          const n = parseSignedWon(raw);
          // keep a bare "-" (or "-0") as typed so the minus can be entered first
          setText(n === null || n === 0 ? raw : formatWon(n));
          onChange(n, raw.trim() === "" || n !== null);
        }}
      />
      {invalid && <p className="text-xs text-destructive">금액을 올바르게 입력하세요.</p>}
    </div>
  );
}

export function OpeningForm({ accounts, version, date: initialDate, lines, partnerNames }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(initialDate);
  // Row keys: the initial rows take 0..lines.length-1, added rows count on from there.
  const nextKey = useRef(lines.length);
  const byPartner = useMemo(() => new Set(accounts.filter((a) => a.requiresPartner).map((a) => a.id)), [accounts]);

  const [balances, setBalances] = useState<Record<number, number | null>>(() => {
    const b: Record<number, number | null> = {};
    for (const l of lines) if (!byPartner.has(l.accountId)) b[l.accountId] = (b[l.accountId] ?? 0) + l.balance;
    return b;
  });
  const [partnerRows, setPartnerRows] = useState<Record<number, PartnerRow[]>>(() => {
    const rows: Record<number, PartnerRow[]> = {};
    lines.forEach((l, key) => {
      if (!byPartner.has(l.accountId)) return;
      const partner = l.partnerId === null ? null : { id: l.partnerId, name: partnerNames[l.partnerId] ?? "" };
      (rows[l.accountId] ??= []).push({ key, partner, balance: l.balance });
    });
    return rows;
  });
  const [invalid, setInvalid] = useState<Set<string>>(new Set());

  const markValid = (key: string, valid: boolean) =>
    setInvalid((s) => {
      if (valid === !s.has(key)) return s;
      const next = new Set(s);
      if (valid) next.delete(key);
      else next.add(key);
      return next;
    });

  const entries: Line[] = [
    ...Object.entries(balances).flatMap(([id, balance]) =>
      balance ? [{ accountId: Number(id), partnerId: null, balance }] : [],
    ),
    ...Object.entries(partnerRows).flatMap(([id, rows]) =>
      rows.flatMap((r) => (r.balance ? [{ accountId: Number(id), partnerId: r.partner?.id ?? null, balance: r.balance }] : [])),
    ),
  ];
  const groupOf = new Map(accounts.map((a) => [a.id, a.group]));
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    const normal = normalSideOf(groupOf.get(e.accountId)!);
    const side = e.balance > 0 ? normal : normal === "debit" ? "credit" : "debit";
    if (side === "debit") debit += Math.abs(e.balance);
    else credit += Math.abs(e.balance);
  }
  const diff = debit - credit;
  const canSave = diff === 0 && invalid.size === 0 && date !== "" && !pending;

  const save = () =>
    startTransition(async () => {
      const r = await saveOpeningAction({ date, version, lines: entries });
      if (!r.ok) return void toast.error(r.error);
      toast.success("저장되었습니다.");
      router.refresh();
    });

  const updateRow = (accountId: number, key: number, patch: Partial<PartnerRow>) =>
    setPartnerRows((p) => ({
      ...p,
      [accountId]: (p[accountId] ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)),
    }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opening-date">기준일</Label>
          <Input
            id="opening-date"
            type="date"
            required
            className="w-44"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          시스템 도입 전 잔액만 입력합니다. 도입 이후 거래는 전표로 입력하세요.
        </p>
        <p className="text-xs text-muted-foreground">
          잔액은 계정의 정상 잔액 방향이면 양수, 반대 방향(예: 감가상각누계액)이면 음수로 입력합니다.
        </p>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>계정과목</TableHead>
              <TableHead className="w-16">정상</TableHead>
              <TableHead className="w-48 text-right">잔액</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ACCOUNT_GROUPS.map((group) => {
              const members = accounts.filter((a) => a.group === group);
              if (members.length === 0) return null;
              return [
                <TableRow key={group} className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={3} className="font-medium">
                    {ACCOUNT_GROUP_LABELS[group]}
                  </TableCell>
                </TableRow>,
                ...members.flatMap((a) => {
                  const label = `${a.code} ${a.name}`;
                  const side = SIDE_LABEL[normalSideOf(a.group)];
                  if (!a.requiresPartner) {
                    return [
                      <TableRow key={a.id}>
                        <TableCell>{label}</TableCell>
                        <TableCell className="text-muted-foreground">{side}</TableCell>
                        <TableCell className="text-right">
                          <BalanceInput
                            label={`${label} 잔액`}
                            initial={balances[a.id] ?? null}
                            onChange={(n, valid) => {
                              setBalances((b) => ({ ...b, [a.id]: n }));
                              markValid(`a${a.id}`, valid);
                            }}
                          />
                        </TableCell>
                      </TableRow>,
                    ];
                  }
                  const rows = partnerRows[a.id] ?? [];
                  const sum = rows.reduce((s, r) => s + (r.balance ?? 0), 0);
                  return [
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{label}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setPartnerRows((p) => ({
                                ...p,
                                [a.id]: [...(p[a.id] ?? []), { key: nextKey.current++, partner: null, balance: null }],
                              }))
                            }
                          >
                            <PlusIcon />
                            거래처 추가
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{side}</TableCell>
                      <TableCell
                        className="pr-4 text-right tabular-nums"
                        aria-label={`${label} 거래처 합계`}
                      >
                        {formatWon(sum)}
                      </TableCell>
                    </TableRow>,
                    ...rows.map((r) => (
                      <TableRow key={`${a.id}-${r.key}`}>
                        <TableCell className="pl-8">
                          <div className="flex items-center gap-2">
                            <PartnerPicker
                              label={`${label} 거래처`}
                              value={r.partner}
                              onChange={(partner) => updateRow(a.id, r.key, { partner })}
                              className="w-64"
                            />
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label="거래처 행 삭제"
                              onClick={() => {
                                setPartnerRows((p) => ({ ...p, [a.id]: (p[a.id] ?? []).filter((x) => x.key !== r.key) }));
                                markValid(`p${r.key}`, true);
                              }}
                            >
                              <Trash2Icon />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-right">
                          <BalanceInput
                            label={`${label} ${r.partner?.name ?? "거래처"} 잔액`}
                            initial={r.balance}
                            onChange={(n, valid) => {
                              updateRow(a.id, r.key, { balance: n });
                              markValid(`p${r.key}`, valid);
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    )),
                  ];
                }),
              ];
            })}
          </TableBody>
        </Table>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t bg-background py-3 text-sm">
        <span>
          차변 합계 <strong className="tabular-nums">{formatWon(debit)}</strong>
        </span>
        <span>
          대변 합계 <strong className="tabular-nums">{formatWon(credit)}</strong>
        </span>
        <span className={cn(diff !== 0 && "text-destructive")}>
          차액 <strong className="tabular-nums">{formatWon(Math.abs(diff))}</strong>
        </span>
        <Button type="button" disabled={!canSave} onClick={save}>
          저장
        </Button>
      </div>
    </div>
  );
}
