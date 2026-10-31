import { DEDUCTION_KEYS, DEDUCTION_LABELS, ledgerFileName, RUN_STATUS_LABELS, runTitle } from "@/lib/payroll/labels";
import type { SheetColumn, SheetSpec } from "@/server/exports/xlsx";
import type { RunDetail } from "./runs";

type Row = SheetSpec["rows"][number];

/**
 * The 급여 대장 Excel sheet: one row per employee, one column per item, the deductions, then a
 * 합계 row. The 주민등록번호 comes from the line snapshot, which only ever holds the masked form.
 */
export function buildPayrollLedgerSheet(run: RunDetail, companyName: string): SheetSpec {
  const columns: SheetColumn[] = [
    { header: "사번", key: "employeeNo", width: 10 },
    { header: "이름", key: "name", width: 10 },
    { header: "주민등록번호", key: "rrn", width: 16 },
    { header: "사업장", key: "site", width: 12 },
    { header: "부서", key: "department", width: 12 },
    ...run.items.map((i) => ({ header: i.name, key: `item:${i.code}`, width: 13, money: true })),
    { header: "지급 계", key: "gross", width: 14, money: true },
    { header: "비과세", key: "nontaxable", width: 12, money: true },
    { header: "과세 급여", key: "taxable", width: 14, money: true },
    ...DEDUCTION_KEYS.map((k) => ({ header: DEDUCTION_LABELS[k], key: `ded:${k}`, width: 12, money: true })),
    { header: "공제 계", key: "totalDeductions", width: 13, money: true },
    { header: "실지급액", key: "netPay", width: 14, money: true },
  ];
  const money = columns.filter((c) => c.money).map((c) => c.key);

  const rows: Row[] = run.lines.map((l) => {
    const row: Row = {
      employeeNo: l.snapshot.employeeNo,
      name: l.snapshot.name,
      rrn: l.snapshot.rrnMasked,
      site: l.snapshot.siteName,
      department: l.snapshot.departmentName,
      gross: l.result.gross,
      nontaxable: l.result.nontaxable,
      taxable: l.result.taxable,
      totalDeductions: l.result.totalDeductions,
      netPay: l.result.netPay,
    };
    for (const i of run.items) row[`item:${i.code}`] = l.amounts[i.code] ?? 0;
    for (const k of DEDUCTION_KEYS) row[`ded:${k}`] = l.result.deductions[k];
    return row;
  });
  const total: Row = { employeeNo: "합계", name: `${run.lines.length}명`, rrn: null, site: null, department: null };
  for (const key of money) total[key] = rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

  const meta = [
    `회사: ${companyName}`,
    `귀속월: ${run.yearMonth}`,
    `지급일: ${run.payDate}`,
    `상태: ${RUN_STATUS_LABELS[run.status]}`,
  ];
  if (run.type === "bonus" && run.bonusFrom && run.bonusTo) meta.push(`지급대상기간: ${run.bonusFrom} ~ ${run.bonusTo}`);

  return {
    fileName: ledgerFileName(run.yearMonth, run.type),
    title: runTitle(run.yearMonth, run.type),
    meta,
    columns,
    rows: [...rows, total],
    emphasis: [rows.length],
  };
}
