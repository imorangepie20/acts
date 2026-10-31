import { notFound } from "next/navigation";
import { VoucherAttachments } from "@/components/vouchers/voucher-attachments";
import { VoucherDetail } from "@/components/vouchers/voucher-detail";
import { VoucherHistory } from "@/components/vouchers/voucher-history";
import { can, hidesPayroll } from "@/lib/permissions";
import { listAccounts } from "@/server/accounts/service";
import { listAttachments } from "@/server/attachments/service";
import { requirePermission } from "@/server/auth/dal";
import { isMonthClosed, monthOf } from "@/server/closing/periods";
import { db } from "@/server/db";
import { listPartnersByIds } from "@/server/partners/service";
import { canModify, getVoucher, listHistory } from "@/server/vouchers/service";
import { isUuid } from "@/lib/uuid";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("ledger:view");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  // A payroll voucher is a 404 without payroll:manage; nothing else (attachments, history) is read first.
  const voucher = await getVoucher(db, id, { hidePayroll: hidesPayroll(user.role) });
  if (!voucher) notFound();
  const [attachments, history, accounts] = await Promise.all([
    listAttachments(db, id),
    listHistory(db, id),
    listAccounts(db),
  ]);
  // Only partners named in this voucher's history snapshots, not the whole partner list.
  const partnerIds = history.flatMap((h) =>
    [h.snapshot.partnerId, ...h.snapshot.lines.map((l) => l.partnerId)].filter((p): p is number => p !== null),
  );
  const [partners, closed] = await Promise.all([
    listPartnersByIds(db, partnerIds),
    isMonthClosed(db, monthOf(voucher.date)),
  ]);
  const modifiable = !closed && canModify(user, { createdBy: voucher.createdBy.id });
  return (
    <VoucherDetail
      voucher={voucher}
      canModify={modifiable}
      canEditOpening={can(user.role, "period:close")}
      canApprove={can(user.role, "voucher:approve")}
      closed={closed}
    >
      <VoucherAttachments voucherId={voucher.id} attachments={attachments} canModify={modifiable} />
      <VoucherHistory
        entries={history}
        accountNames={Object.fromEntries(accounts.map((a) => [a.id, `${a.code} ${a.name}`]))}
        partnerNames={Object.fromEntries(partners.map((p) => [p.id, p.name]))}
      />
    </VoucherDetail>
  );
}
