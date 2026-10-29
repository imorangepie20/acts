import type { Period } from "@/lib/reports/fiscal";
import type { StatementLine } from "@/lib/reports/statements";
import { accountLedgerHref, StatementTable, type LedgerScope } from "./statement-table";

type Props = { lines: StatementLine[]; period: Period; priorPeriod: Period; scope: LedgerScope };

export function IncomeStatementTable({ lines, period, priorPeriod, scope }: Props) {
  return (
    <StatementTable
      lines={lines}
      currentLabel={`당기 (${period.from} ~ ${period.to})`}
      priorLabel={`전기 (${priorPeriod.from} ~ ${priorPeriod.to})`}
      ledgerHref={(id) => accountLedgerHref(id, period.from, period.to, scope)}
    />
  );
}
