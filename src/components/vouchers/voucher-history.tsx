import { formatDateTime } from "@/lib/vouchers/dates";
import { describeChanges, VOUCHER_ACTION_LABELS } from "@/lib/vouchers/history";
import type { HistoryEntry } from "@/server/vouchers/service";

type Props = {
  entries: HistoryEntry[];
  accountNames: Record<number, string>;
  partnerNames: Record<number, string>;
};

/** Change log: each entry with what changed since the previous snapshot. */
export function VoucherHistory({ entries, accountNames, partnerNames }: Props) {
  const names = {
    account: (id: number) => accountNames[id] ?? `#${id}`,
    partner: (id: number | null) => (id === null ? "없음" : (partnerNames[id] ?? `#${id}`)),
  };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">변경 이력</h2>
      <ol className="flex flex-col gap-2">
        {entries.map((e, i) => {
          const changes = i > 0 ? describeChanges(entries[i - 1].snapshot, e.snapshot, names) : [];
          return (
            <li key={e.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium">{VOUCHER_ACTION_LABELS[e.action]}</span>
                <span>{e.userName}</span>
                <time dateTime={e.at.toISOString()} className="text-muted-foreground tabular-nums">
                  {formatDateTime(e.at)}
                </time>
              </div>
              {changes.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                  {changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
              {e.note && (
                <p className="mt-2 text-muted-foreground">
                  {e.action === "attached" || e.action === "detached" ? "파일" : "사유"}: {e.note}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
