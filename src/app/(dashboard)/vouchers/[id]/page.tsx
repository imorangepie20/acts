import { notFound } from "next/navigation";
import { VoucherAttachments } from "@/components/vouchers/voucher-attachments";
import { VoucherDetail } from "@/components/vouchers/voucher-detail";
import { VoucherHistory } from "@/components/vouchers/voucher-history";
import { can } from "@/lib/permissions";
import { listAccounts } from "@/server/accounts/service";
import { listAttachments } from "@/server/attachments/service";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { listPartners } from "@/server/partners/service";
import { canModify, getVoucher, listHistory } from "@/server/vouchers/service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("ledger:view");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [voucher, attachments, history, accounts, partners] = await Promise.all([
    getVoucher(db, id),
    listAttachments(db, id),
    listHistory(db, id),
    listAccounts(db),
    listPartners(db),
  ]);
  if (!voucher) notFound();
  const modifiable = canModify(user, { createdBy: voucher.createdBy.id });
  return (
    <VoucherDetail voucher={voucher} canModify={modifiable} canApprove={can(user.role, "voucher:approve")}>
      <VoucherAttachments voucherId={voucher.id} attachments={attachments} canModify={modifiable} />
      <VoucherHistory
        entries={history}
        accountNames={Object.fromEntries(accounts.map((a) => [a.id, `${a.code} ${a.name}`]))}
        partnerNames={Object.fromEntries(partners.map((p) => [p.id, p.name]))}
      />
    </VoucherDetail>
  );
}
