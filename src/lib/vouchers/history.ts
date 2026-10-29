import { formatWon } from "@/lib/money";
import {
  EVIDENCE_TYPE_LABELS,
  VAT_TYPE_LABELS,
  VOUCHER_STATUS_LABELS,
  type LineInput,
  type VoucherAction,
  type VoucherSnapshot,
} from "./types";

export const VOUCHER_ACTION_LABELS: Record<VoucherAction, string> = {
  created: "작성",
  updated: "수정",
  deleted: "삭제",
  approved: "승인",
  rejected: "반려",
  attached: "첨부 추가",
  detached: "첨부 삭제",
};

const debitTotal = (s: VoucherSnapshot) =>
  s.lines.filter((l) => l.side === "debit").reduce((sum, l) => sum + l.amount, 0);

/**
 * A line's identity apart from what the header already reports: a line partner or
 * description that follows the header is recorded as such, and amounts only count
 * when the total did not change (the 금액 line covers that case).
 */
function lineKey(s: VoucherSnapshot, l: LineInput, withAmount: boolean): string {
  return JSON.stringify([
    l.accountId,
    l.side,
    withAmount ? l.amount : null,
    l.partnerId === s.partnerId ? "=" : l.partnerId,
    l.siteId,
    l.departmentId,
    l.description === s.description ? "=" : l.description,
  ]);
}

const orNone = (s: string) => s || "없음";

/** Korean one-liners describing what changed between two history snapshots. */
export function describeChanges(
  prev: VoucherSnapshot,
  next: VoucherSnapshot,
  names: { account: (id: number) => string; partner: (id: number | null) => string },
): string[] {
  const out: string[] = [];
  const diff = (label: string, a: string, b: string) => {
    if (a !== b) out.push(`${label}: ${a} → ${b}`);
  };

  diff("날짜", prev.date, next.date);
  diff("적요", orNone(prev.description), orNone(next.description));
  if (prev.partnerId !== next.partnerId) diff("거래처", names.partner(prev.partnerId), names.partner(next.partnerId));
  const [ta, tb] = [debitTotal(prev), debitTotal(next)];
  diff("금액", formatWon(ta), formatWon(tb));
  diff("증빙", EVIDENCE_TYPE_LABELS[prev.evidenceType], EVIDENCE_TYPE_LABELS[next.evidenceType]);
  diff(
    "과세 구분",
    prev.vatType ? VAT_TYPE_LABELS[prev.vatType] : "없음",
    next.vatType ? VAT_TYPE_LABELS[next.vatType] : "없음",
  );

  const withAmount = ta === tb;
  const keys = (s: VoucherSnapshot) => s.lines.map((l) => lineKey(s, l, withAmount)).join("|");
  if (keys(prev) !== keys(next)) out.push("분개 줄 변경");

  diff("상태", VOUCHER_STATUS_LABELS[prev.status], VOUCHER_STATUS_LABELS[next.status]);
  return out;
}
