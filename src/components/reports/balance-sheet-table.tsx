import type { StatementLine } from "@/lib/reports/statements";
import { accountLedgerHref, StatementTable, type LedgerScope } from "./statement-table";

const HEADERS: ReadonlySet<string> = new Set(["assets", "liabilities", "capital"]);

type Props = { lines: StatementLine[]; asOf: string; priorAsOf: string; fiscalStart: string; scope: LedgerScope };

export function BalanceSheetTable({ lines, asOf, priorAsOf, fiscalStart, scope }: Props) {
  return (
    <StatementTable
      lines={lines}
      currentLabel={`당기 (${asOf})`}
      priorLabel={`전기말 (${priorAsOf})`}
      ledgerHref={(id) => accountLedgerHref(id, fiscalStart, asOf, scope)}
      headerKeys={HEADERS}
    />
  );
}
