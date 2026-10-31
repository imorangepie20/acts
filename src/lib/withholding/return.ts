// Pure builder for the 원천징수이행상황신고서 figures (근로소득 A01/A10/A99, 환급세액 조정).

export type ReturnRunInput = {
  yearMonth: string; // 귀속 YYYY-MM
  payDate: string; // YYYY-MM-DD
  lines: { employeeId: number; gross: number; excludedNontaxable: number; incomeTax: number; localTax: number }[];
};

export type ReturnPeriod =
  | { mode: "monthly"; attributionMonth: string; paymentMonth: string }
  | { mode: "semiannual"; year: number; half: 1 | 2 };

type Row = { people: number; totalPaid: number; incomeTax: number };

export type ReturnFigures = {
  attributionMonth: string; // ② 귀속연월
  paymentMonth: string; // ③ 지급연월
  a01: Row;
  a10: Row;
  a99: Row;
  refund: { carriedIn: number; adjusted: number; payable: number; carriedOut: number }; // ⑫, ⑨(=⑲), ⑩, ⑳
  localTax: number;
};

const payMonth = (payDate: string) => payDate.slice(0, 7);

function sumRuns(runs: ReturnRunInput[]) {
  let totalPaid = 0;
  let incomeTax = 0;
  let localTax = 0;
  for (const r of runs) {
    for (const l of r.lines) {
      totalPaid += l.gross - l.excludedNontaxable;
      incomeTax += l.incomeTax;
      localTax += l.localTax;
    }
  }
  return { totalPaid, incomeTax, localTax };
}

function distinctPeople(runs: ReturnRunInput[]): number {
  return new Set(runs.flatMap((r) => r.lines.map((l) => l.employeeId))).size;
}

export function buildReturn(period: ReturnPeriod, runs: ReturnRunInput[], carriedInRefund: number): ReturnFigures {
  if (!Number.isInteger(carriedInRefund) || carriedInRefund < 0) {
    throw new Error("carriedInRefund must be a non-negative integer");
  }

  let attributionMonth: string;
  let paymentMonth: string;
  let filtered: ReturnRunInput[];
  let headcountRuns: ReturnRunInput[];

  if (period.mode === "monthly") {
    attributionMonth = period.attributionMonth;
    paymentMonth = period.paymentMonth;
    filtered = runs.filter((r) => r.yearMonth === attributionMonth && payMonth(r.payDate) === paymentMonth);
    headcountRuns = filtered;
  } else {
    const first = `${period.year}-${period.half === 1 ? "01" : "07"}`;
    const last = `${period.year}-${period.half === 1 ? "06" : "12"}`;
    attributionMonth = first;
    paymentMonth = last;
    filtered = runs.filter((r) => {
      const m = payMonth(r.payDate);
      return m >= first && m <= last;
    });
    headcountRuns = filtered.filter((r) => payMonth(r.payDate) === last);
  }

  const { totalPaid, incomeTax, localTax } = sumRuns(filtered);
  const row: Row = { people: distinctPeople(headcountRuns), totalPaid, incomeTax };
  const adjusted = Math.min(carriedInRefund, incomeTax);

  return {
    attributionMonth,
    paymentMonth,
    a01: row,
    a10: { ...row },
    a99: { ...row },
    refund: {
      carriedIn: carriedInRefund,
      adjusted,
      payable: incomeTax - adjusted,
      carriedOut: carriedInRefund - adjusted,
    },
    localTax,
  };
}

export function returnPairs(
  runs: Pick<ReturnRunInput, "yearMonth" | "payDate">[],
): { attributionMonth: string; paymentMonth: string }[] {
  const seen = new Map<string, { attributionMonth: string; paymentMonth: string }>();
  for (const r of runs) {
    const pair = { attributionMonth: r.yearMonth, paymentMonth: payMonth(r.payDate) };
    seen.set(`${pair.paymentMonth}|${pair.attributionMonth}`, pair);
  }
  return [...seen.values()].sort(
    (a, b) => a.paymentMonth.localeCompare(b.paymentMonth) || a.attributionMonth.localeCompare(b.attributionMonth),
  );
}
