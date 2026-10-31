import { Badge } from "@/components/ui/badge";
import { RUN_STATUS_LABELS } from "@/lib/payroll/labels";
import { VOUCHER_STATUS_LABELS, type VoucherStatus } from "@/lib/vouchers/types";
import type { RunStatus } from "@/server/payroll/runs";

/** 작성 중, or 확정 with the voucher's status (승인 대기 / 승인 / 반려). */
export function RunStatusBadge({ status, voucherStatus }: { status: RunStatus; voucherStatus: VoucherStatus | null }) {
  if (status === "draft") return <Badge variant="secondary">{RUN_STATUS_LABELS.draft}</Badge>;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge>{RUN_STATUS_LABELS.confirmed}</Badge>
      {voucherStatus && (
        <Badge variant={voucherStatus === "rejected" ? "destructive" : "outline"}>
          전표 {VOUCHER_STATUS_LABELS[voucherStatus]}
        </Badge>
      )}
    </span>
  );
}
