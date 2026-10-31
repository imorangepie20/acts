"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountPicker, type AccountOption } from "@/components/vouchers/account-picker";
import { PartnerPicker, type PartnerValue } from "@/components/vouchers/partner-picker";
import { Field, selectClass } from "@/components/vouchers/shared";
import type { PreviewRow, ImportKind } from "@/server/imports/service";
import { commitImportAction, previewImportAction } from "@/app/(dashboard)/imports/actions";
import { PreviewTable, type RowState } from "./preview-table";

type Direction = "purchase" | "sale";
type Options = {
  sites: { id: number; name: string }[];
  departments: { id: number; name: string }[];
  showSite: boolean;
  showDepartment: boolean;
};

/** Counter-account preselection, as on the entry screen: 매입 251, 매출 108, 카드 253. */
const COUNTER_CODE = { purchase: "251", sale: "108", card: "253" } as const;

export function ImportScreen({ accounts, options }: { accounts: AccountOption[]; options: Options }) {
  const defaultCounter = (kind: ImportKind, dir: Direction) =>
    accounts.find((a) => a.code === COUNTER_CODE[kind === "card" ? "card" : dir])?.id ?? null;

  const [kind, setKind] = useState<ImportKind>("tax_invoice");
  const [direction, setDirection] = useState<Direction>("purchase");
  const [counter, setCounter] = useState<number | null>(defaultCounter("tax_invoice", "purchase"));
  const [cardPartner, setCardPartner] = useState<PartnerValue>(null);
  const [siteId, setSiteId] = useState(options.sites[0]?.id ?? 0);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [states, setStates] = useState<RowState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [bulk, setBulk] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setRows([]);
    setStates([]);
    setError(null);
    setDone(null);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };
  const switchContext = (k: ImportKind, d: Direction) => {
    setKind(k);
    setDirection(d);
    setCounter(defaultCounter(k, d));
    reset();
  };

  const patch = (i: number, p: Partial<RowState>) =>
    setStates((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const preview = () => {
    if (!file) {
      setError("엑셀 파일을 선택하세요.");
      return;
    }
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("direction", direction);
    fd.set("file", file);
    start(async () => {
      setDone(null);
      const r = await previewImportAction(fd);
      if (!r.ok) {
        setError(r.error);
        setRows([]);
        setStates([]);
        return;
      }
      setError(null);
      setRows(r.value.rows);
      setStates(
        r.value.rows.map((row) => ({
          checked: row.status === "ready",
          accountId: row.recommendations[0]?.accountId ?? null,
          deductible: row.deductible,
          voucherId: null,
          error: null,
        })),
      );
    });
  };

  const toggleAll = (checked: boolean) =>
    setStates((s) => s.map((x, i) => (rows[i].status === "ready" && !x.voucherId ? { ...x, checked } : x)));

  const checkedIdx = states.flatMap((s, i) => (s.checked && !s.voucherId ? [i] : []));
  const missingAccount = checkedIdx.some((i) => states[i].accountId === null);
  const canCommit = checkedIdx.length > 0 && !missingAccount && counter !== null && !pending;

  const assignBulk = (id: number) => {
    setBulk(id);
    setStates((s) => s.map((x) => (x.checked && !x.voucherId ? { ...x, accountId: id } : x)));
  };

  const commit = () => {
    if (counter === null) return;
    const picked = checkedIdx.map((i) => ({ i, row: rows[i], st: states[i] }));
    start(async () => {
      const r = await commitImportAction({
        kind,
        direction,
        counterAccountId: counter,
        cardPartnerId: kind === "card" ? (cardPartner?.id ?? null) : null,
        siteId,
        departmentId,
        rows: picked.map(({ row, st }) => ({
          key: row.key,
          date: row.date!,
          description: row.description,
          mainAccountId: st.accountId!,
          deductible: st.deductible,
          partnerId: kind === "card" ? null : row.partnerId,
          counterparty:
            kind === "card" || row.partnerId !== null
              ? null
              : {
                  name: row.counterpartyName,
                  businessNumber: row.counterpartyBusinessNumber,
                  representative: row.representative,
                },
          evidenceType: row.evidenceType,
          vatType: row.vatType,
          supplyAmount: row.supplyAmount,
          vatAmount: row.vatAmount,
          meta: row.meta,
        })),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setError(null);
      const created = new Map(r.value.created.map((c) => [c.key, c.id]));
      const failed = new Map(r.value.failed.map((f) => [f.key, f.error]));
      setStates((s) => {
        const next = [...s];
        for (const { i, row } of picked) {
          const id = created.get(row.key);
          if (id !== undefined) {
            created.delete(row.key); // a repeated key in one file links only its first row
            next[i] = { ...next[i], checked: false, voucherId: id, error: null };
          } else {
            next[i] = { ...next[i], error: failed.get(row.key) ?? "저장하지 못했습니다." };
          }
        }
        return next;
      });
      setDone(`${r.value.created.length}건을 전표로 만들었습니다.`);
    });
  };

  const failures = states.flatMap((s, i) => (s.error ? [{ row: rows[i], error: s.error }] : []));

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={kind} onValueChange={(v) => switchContext(v as ImportKind, direction)}>
        <TabsList>
          <TabsTrigger value="tax_invoice">전자세금계산서</TabsTrigger>
          <TabsTrigger value="card">카드 사용내역</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kind === "tax_invoice" && (
          <div className="flex flex-col gap-1.5">
            <Label>구분</Label>
            <RadioGroup
              value={direction}
              onValueChange={(v) => switchContext(kind, v as Direction)}
              className="flex h-8 items-center gap-4"
            >
              <label className="flex items-center gap-1.5 text-sm">
                <RadioGroupItem value="purchase" />
                매입
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <RadioGroupItem value="sale" />
                매출
              </label>
            </RadioGroup>
          </div>
        )}
        <Field label="상대 계정" htmlFor="import-counter">
          <AccountPicker label="상대 계정" id="import-counter" accounts={accounts} value={counter} onChange={setCounter} />
        </Field>
        {kind === "card" && (
          <Field label="카드사 거래처" htmlFor="import-card-partner">
            <PartnerPicker label="카드사 거래처" id="import-card-partner" value={cardPartner} onChange={setCardPartner} />
          </Field>
        )}
        {options.showSite && (
          <Field label="사업장" htmlFor="import-site">
            <select
              id="import-site"
              className={selectClass}
              value={siteId}
              onChange={(e) => setSiteId(Number(e.target.value))}
            >
              {options.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {options.showDepartment && (
          <Field label="부서" htmlFor="import-department">
            <select
              id="import-department"
              className={selectClass}
              value={departmentId ?? ""}
              onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">없음</option>
              {options.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          aria-label="엑셀 파일"
          className="text-sm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button type="button" onClick={preview} disabled={pending}>
          미리보기
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm font-medium">
          {done}
        </p>
      )}
      {failures.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-destructive">
          {failures.map(({ row, error: e }) => (
            <li key={row.key}>
              {row.counterpartyName || row.description}: {e}
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex w-64 flex-col gap-1.5">
              <Label htmlFor="import-bulk">계정 일괄 지정</Label>
              <AccountPicker label="계정 일괄 지정" id="import-bulk" accounts={accounts} value={bulk} onChange={assignBulk} />
            </div>
            <Button type="button" onClick={commit} disabled={!canCommit}>
              선택한 {checkedIdx.length}건 전표 만들기
            </Button>
          </div>
          <PreviewTable rows={rows} states={states} accounts={accounts} onChange={patch} onToggleAll={toggleAll} />
        </>
      )}
    </div>
  );
}
