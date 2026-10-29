import { notFound, redirect } from "next/navigation";
import { VoucherEntry, type EditTarget } from "@/components/vouchers/voucher-entry";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { toSimpleInput, type VatAccounts } from "@/lib/vouchers/simple";
import type { VoucherInput } from "@/lib/vouchers/types";
import { getVatAccountIds, listAccounts } from "@/server/accounts/service";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { getEntryOptions } from "@/server/sites/service";
import { canModify, getVoucher, type VoucherDetail } from "@/server/vouchers/service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prefills the entry form: simple types through toSimpleInput, anything else as general lines. */
function editTarget(v: VoucherDetail, vat: VatAccounts): EditTarget {
  const input: VoucherInput = {
    date: v.date,
    description: v.description,
    entryType: v.entryType,
    partnerId: v.partnerId,
    evidenceType: v.evidenceType,
    vatType: v.vatType,
    vatDeductible: v.vatDeductible,
    supplyAmount: v.supplyAmount,
    vatAmount: v.vatAmount,
    lines: v.lines.map((l) => ({
      accountId: l.accountId,
      side: l.side,
      amount: l.amount,
      partnerId: l.partnerId,
      siteId: l.siteId,
      departmentId: l.departmentId,
      description: l.description,
    })),
  };
  const first = v.lines[0];
  const base = {
    id: v.id,
    version: v.version,
    common: {
      date: v.date,
      description: v.description,
      siteId: first.siteId,
      departmentId: first.departmentId,
    },
  };
  const partnerLine = v.lines.find((l) => l.partnerId !== null && l.partnerId === v.partnerId);
  const partner = partnerLine ? { id: partnerLine.partnerId!, name: partnerLine.partnerName ?? "" } : null;

  const simple = toSimpleInput(input, vat);
  if (simple?.type === "transfer") return { ...base, tab: "transfer", transfer: { simple, partner } };
  if (simple) return { ...base, tab: simple.type, trade: { simple, partner } };
  return {
    ...base,
    tab: "general",
    general: v.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.side === "debit" ? l.amount : null,
      credit: l.side === "credit" ? l.amount : null,
      partner: l.partnerId !== null ? { id: l.partnerId, name: l.partnerName ?? "" } : null,
      description: l.description === v.description ? "" : l.description,
    })),
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("voucher:create");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const voucher = await getVoucher(db, id);
  if (!voucher) notFound();
  if (!canModify(user, { createdBy: voucher.createdBy.id })) redirect(`/vouchers/${id}`);

  const [allAccounts, vat, options] = await Promise.all([
    listAccounts(db),
    getVatAccountIds(db),
    getEntryOptions(db),
  ]);
  const used = new Set(voucher.lines.map((l) => l.accountId));
  const accounts = allAccounts
    .filter((a) => a.isActive || used.has(a.id))
    .map(({ id, code, name, group }) => ({ id, code, name, group }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">전표 수정</h1>
      <VoucherEntry
        accounts={accounts}
        vat={vat}
        options={options}
        today={todayInSeoul()}
        edit={editTarget(voucher, vat)}
      />
    </div>
  );
}
