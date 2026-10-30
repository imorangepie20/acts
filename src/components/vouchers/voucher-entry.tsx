"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { VatAccounts } from "@/lib/vouchers/simple";
import { ENTRY_TYPE_LABELS, type EntryType } from "@/lib/vouchers/types";
import { createVoucherAction, updateVoucherAction } from "@/app/(dashboard)/vouchers/actions";
import type { AccountOption } from "./account-picker";
import { GeneralForm, type GeneralRow } from "./general-form";
import { Field, selectClass, type Common, type FormContext, type VoucherPayloadInput } from "./shared";
import { TradeForm, type TradeInitial } from "./trade-form";
import { TransferForm, type TransferInitial } from "./transfer-form";

const TABS: EntryType[] = ["purchase", "sale", "transfer", "general"];

export type EntryOptions = {
  sites: { id: number; name: string }[];
  departments: { id: number; name: string }[];
  showSite: boolean;
  showDepartment: boolean;
};

export type EditTarget = {
  id: string;
  version: number;
  tab: EntryType;
  common: Common;
  trade?: TradeInitial;
  transfer?: TransferInitial;
  general?: GeneralRow[];
  closing?: boolean;
};

type Props = {
  accounts: AccountOption[];
  vat: VatAccounts;
  options: EntryOptions;
  /** YYYY-MM-DD in Asia/Seoul, computed on the server. */
  today: string;
  edit?: EditTarget;
};

export function VoucherEntry({ accounts, vat, options, today, edit }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<EntryType>(edit?.tab ?? "purchase");
  const [common, setCommon] = useState<Common>(
    edit?.common ?? {
      date: today,
      description: "",
      siteId: options.sites[0]?.id ?? 0,
      departmentId: null,
    },
  );
  const [resetKey, setResetKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);

  const submit = async (payload: VoucherPayloadInput) => {
    setPending(true);
    setError(null);
    try {
      if (edit) {
        const r = await updateVoucherAction(edit.id, edit.version, payload);
        if (!r.ok) return setError(r.error);
        toast.success("저장되었습니다.");
        router.push(`/vouchers/${edit.id}`);
        return;
      }
      const r = await createVoucherAction(payload);
      if (!r.ok) return setError(r.error);
      const id = r.value.id;
      toast.success("저장되었습니다.", {
        action: { label: "전표 보기", onClick: () => router.push(`/vouchers/${id}`) },
      });
      // Fast repeated entry: keep tab, date and 사업장/부서; clear the rest.
      setCommon((c) => ({ ...c, description: "" }));
      setResetKey((k) => k + 1);
      descriptionRef.current?.focus();
    } catch {
      setError("저장하지 못했습니다. 다시 시도하세요.");
    } finally {
      setPending(false);
    }
  };

  const ctx: FormContext = { accounts, vat, common, submit, fail: setError, pending, error };
  const formKey = `${tab}-${resetKey}`;

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(v as EntryType);
        setError(null);
      }}
      className="gap-4"
    >
      <TabsList>
        {TABS.map((t) => (
          <TabsTrigger key={t} value={t} disabled={edit !== undefined && t !== edit.tab} className="px-3">
            {ENTRY_TYPE_LABELS[t]}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="grid gap-4 sm:grid-cols-[10rem_1fr] lg:grid-cols-[10rem_1fr_12rem_12rem]">
        <Field label="날짜" htmlFor="voucher-date">
          <Input
            id="voucher-date"
            type="date"
            required
            value={common.date}
            onChange={(e) => setCommon((c) => ({ ...c, date: e.target.value }))}
          />
        </Field>
        <Field label="적요" htmlFor="voucher-description">
          <Input
            id="voucher-description"
            ref={descriptionRef}
            autoComplete="off"
            value={common.description}
            onChange={(e) => setCommon((c) => ({ ...c, description: e.target.value }))}
          />
        </Field>
        {options.showSite && (
          <Field label="사업장" htmlFor="voucher-site">
            <select
              id="voucher-site"
              className={selectClass}
              value={common.siteId}
              onChange={(e) => setCommon((c) => ({ ...c, siteId: Number(e.target.value) }))}
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
          <Field label="부서" htmlFor="voucher-department">
            <select
              id="voucher-department"
              className={selectClass}
              value={common.departmentId ?? ""}
              onChange={(e) =>
                setCommon((c) => ({ ...c, departmentId: e.target.value ? Number(e.target.value) : null }))
              }
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

      <TabsContent value="purchase">
        <TradeForm key={formKey} kind="purchase" ctx={ctx} initial={edit?.trade} />
      </TabsContent>
      <TabsContent value="sale">
        <TradeForm key={formKey} kind="sale" ctx={ctx} initial={edit?.trade} />
      </TabsContent>
      <TabsContent value="transfer">
        <TransferForm key={formKey} ctx={ctx} initial={edit?.transfer} />
      </TabsContent>
      <TabsContent value="general">
        <GeneralForm key={formKey} ctx={ctx} initial={edit?.general} initialClosing={edit?.closing} />
      </TabsContent>
    </Tabs>
  );
}
