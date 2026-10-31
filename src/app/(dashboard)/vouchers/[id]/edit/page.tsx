import { notFound, redirect } from "next/navigation";
import { VoucherEntry, type EditTarget } from "@/components/vouchers/voucher-entry";
import { isUuid } from "@/lib/uuid";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { toSimpleInput, type VatAccounts } from "@/lib/vouchers/simple";
import type { VoucherInput } from "@/lib/vouchers/types";
import { getVatAccountIds, listAccounts } from "@/server/accounts/service";
import { hidesPayroll } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/dal";
import { isMonthClosed, monthOf } from "@/server/closing/periods";
import { db } from "@/server/db";
import { getEntryOptions, listDepartments, listSites } from "@/server/sites/service";
import { canModify, getVoucher, type VoucherDetail } from "@/server/vouchers/service";

/** Prefills the entry form: simple types through toSimpleInput, anything else as general lines. */
function editTarget(v: VoucherDetail, vat: VatAccounts): EditTarget {
  const input: VoucherInput = {
    date: v.date,
    description: v.description,
    entryType: v.entryType,
    // The page redirects the 기초 voucher to /closing/opening before this runs.
    kind: v.kind === "closing" ? "closing" : "general",
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
    closing: v.kind === "closing",
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
  if (!isUuid(id)) notFound();
  const voucher = await getVoucher(db, id, { hidePayroll: hidesPayroll(user.role) });
  if (!voucher) notFound();
  // Opening balances have their own screen and rules.
  if (voucher.kind === "opening") redirect("/closing/opening");
  if (!canModify(user, { createdBy: voucher.createdBy.id })) redirect(`/vouchers/${id}`);
  if (await isMonthClosed(db, monthOf(voucher.date))) redirect(`/vouchers/${id}`);

  const [allAccounts, vat, activeOptions, allSites, allDepartments] = await Promise.all([
    listAccounts(db),
    getVatAccountIds(db),
    getEntryOptions(db),
    listSites(db),
    listDepartments(db),
  ]);
  // A deactivated 사업장/부서 already on the voucher stays selectable (labelled), so the select
  // shows what will be saved. New vouchers never see inactive ones.
  const currentSite = allSites.find((s) => s.id === voucher.lines[0].siteId);
  const currentDept = allDepartments.find((d) => d.id === voucher.lines[0].departmentId);
  const extraSite = currentSite && !currentSite.isActive ? currentSite : null;
  const extraDept = currentDept && !currentDept.isActive ? currentDept : null;
  const options = {
    ...activeOptions,
    sites: extraSite
      ? [...activeOptions.sites, { ...extraSite, name: `${extraSite.name} (중지)` }]
      : activeOptions.sites,
    departments: extraDept
      ? [...activeOptions.departments, { ...extraDept, name: `${extraDept.name} (중지)` }]
      : activeOptions.departments,
    showSite: activeOptions.showSite || extraSite !== null,
    showDepartment: activeOptions.showDepartment || extraDept !== null,
  };
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
