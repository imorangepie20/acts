import { DEDUCTION_KEYS, DEDUCTION_LABELS, RUN_TYPE_LABELS } from "@/lib/payroll/labels";
import { formatWon } from "@/lib/money";
import type { RunDetail, RunLineView } from "@/server/payroll/runs";

const pct = (n: number) => `${n}%`;

function Rows({ rows, total, totalLabel }: { rows: [string, number][]; total: number; totalLabel: string }) {
  return (
    <table className="w-full border-collapse text-sm">
      <tbody>
        {rows.map(([label, amount]) => (
          <tr key={label} className="border-b border-neutral-200">
            <td className="py-1.5">{label}</td>
            <td className="py-1.5 text-right tabular-nums">{formatWon(amount)}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-neutral-800 font-semibold">
          <td className="py-1.5">{totalLabel}</td>
          <td className="py-1.5 text-right tabular-nums">{formatWon(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * One payslip (one A4 page when printed). Only the masked 주민등록번호 from the line snapshot is
 * shown; the employee facts are those the line was computed with.
 */
export function Payslip({ companyName, run, line }: { companyName: string; run: RunDetail; line: RunLineView }) {
  const s = line.snapshot;
  const r = line.result;
  const [y, m] = run.yearMonth.split("-").map(Number);
  const earnings: [string, number][] = run.items
    .filter((i) => (line.amounts[i.code] ?? 0) > 0)
    .map((i) => [i.name, line.amounts[i.code]]);
  const deductions: [string, number][] = DEDUCTION_KEYS.map((k) => [
    `${DEDUCTION_LABELS[k]}${line.overrides[k] !== undefined ? " (직접 입력)" : ""}`,
    r.deductions[k],
  ]);
  const basis: [string, string][] = [
    ["기준소득월액 (국민연금)", s.calc.insPension ? `${formatWon(s.calc.pensionBase)}원` : "미가입"],
    ["보수월액 (건강보험)", s.calc.insHealth ? `${formatWon(s.calc.healthBase)}원` : "미가입"],
    ["과세 급여 / 비과세", `${formatWon(r.taxable)}원 / ${formatWon(r.nontaxable)}원`],
    ["국민연금 요율 (근로자)", pct(s.rates.pensionEmployee)],
    ["건강보험 요율 (근로자)", pct(s.rates.healthEmployee)],
    ["장기요양보험 (건강보험료 대비)", pct(s.rates.ltcEmployee)],
    ["고용보험 요율 (근로자)", s.calc.insEmployment ? pct(s.rates.employmentEmployee) : "미가입"],
    ["간이세액 비율", pct(s.calc.withholdingRate)],
    ["공제대상가족 (본인 포함) / 8~20세 자녀", `${s.calc.dependents}명 / ${s.calc.children}명`],
  ];
  if (s.bonus) basis.push(["상여 지급대상기간", `${s.bonus.from} ~ ${s.bonus.to} (${s.bonus.months}개월)`]);

  return (
    <article
      className="payslip mx-auto flex w-full max-w-[190mm] flex-col gap-5 rounded-md border bg-white p-8 text-neutral-900 print:max-w-none print:rounded-none print:border-0 print:p-0"
      aria-label={`${s.name} 급여명세서`}
    >
      <header className="flex items-end justify-between border-b-2 border-neutral-800 pb-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">급여명세서</h2>
          <p className="text-sm">
            {y}년 {m}월분 {RUN_TYPE_LABELS[run.type]} · 귀속월 {run.yearMonth}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold">{companyName}</p>
          <p className="tabular-nums">지급일 {run.payDate}</p>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-neutral-500">성명</dt>
          <dd className="font-semibold">{s.name}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">사번</dt>
          <dd className="tabular-nums">{s.employeeNo}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">주민등록번호</dt>
          <dd className="font-mono tabular-nums">{s.rrnMasked}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">소속</dt>
          <dd>{s.departmentName ? `${s.siteName} · ${s.departmentName}` : s.siteName}</dd>
        </div>
      </dl>

      <div className="grid grid-cols-2 gap-6">
        <section>
          <h3 className="mb-1 text-sm font-semibold">지급 내역</h3>
          <Rows rows={earnings} total={r.gross} totalLabel="지급 계" />
        </section>
        <section>
          <h3 className="mb-1 text-sm font-semibold">공제 내역</h3>
          <Rows rows={deductions} total={r.totalDeductions} totalLabel="공제 계" />
        </section>
      </div>

      <div className="flex items-center justify-between rounded-md bg-neutral-100 px-4 py-3">
        <span className="font-semibold">실지급액</span>
        <span className="text-xl font-bold tabular-nums">{formatWon(r.netPay)}원</span>
      </div>

      <section>
        <h3 className="mb-1 text-sm font-semibold">계산 근거</h3>
        <table className="w-full border-collapse text-xs">
          <tbody>
            {basis.map(([label, value]) => (
              <tr key={label} className="border-b border-neutral-200">
                <td className="py-1 text-neutral-600">{label}</td>
                <td className="py-1 text-right tabular-nums">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-neutral-500">
          4대보험료와 지방소득세는 10원 미만을 버립니다. 소득세는 근로소득 간이세액표(지급일 기준)에 간이세액 비율을 곱해
          계산합니다.
        </p>
      </section>
    </article>
  );
}
