// Pure builder for the 원천징수이행상황신고서 figures (근로소득 A01/A04/A10/A99, 환급세액 조정).

export type ReturnRunInput = {
  yearMonth: string; // 귀속 YYYY-MM
  payDate: string; // YYYY-MM-DD
  lines: {
    employeeId: number;
    gross: number;
    excludedNontaxable: number;
    incomeTax: number;
    localTax: number;
    /** 연말정산 소득세·지방소득세 typed on the line (negative = 환급); absent = 0. */
    settlementIncomeTax?: number;
    settlementLocalTax?: number;
  }[];
};

export type ReturnPeriod =
  | { mode: "monthly"; attributionMonth: string; paymentMonth: string }
  | { mode: "semiannual"; year: number; half: 1 | 2 };

/** totalPaid null = not computed (A04: the 연말정산 총급여 is not in the 급여 대장). */
type Row = { people: number; totalPaid: number | null; incomeTax: number };

export type ReturnFigures = {
  attributionMonth: string; // ② 귀속연월
  paymentMonth: string; // ③ 지급연월
  a01: Row;
  /** 연말정산 합계: people with a nonzero 연말정산 amount, the net 소득세 (negative = 환급). */
  a04: Row;
  a10: Row;
  a99: Row;
  /** ⑫, ⑬ 당월 발생 환급세액 (일반환급, when A10 ⑥ is negative), ⑨(=⑲), ⑩, ⑳. */
  refund: { carriedIn: number; arising: number; adjusted: number; payable: number; carriedOut: number };
  localTax: number;
};

const payMonth = (payDate: string) => payDate.slice(0, 7);

function sumRuns(runs: ReturnRunInput[]) {
  let totalPaid = 0;
  let incomeTax = 0;
  let localTax = 0;
  let settlementTax = 0;
  const settled = new Set<number>();
  for (const r of runs) {
    for (const l of r.lines) {
      totalPaid += l.gross - l.excludedNontaxable;
      incomeTax += l.incomeTax;
      localTax += l.localTax + (l.settlementLocalTax ?? 0);
      settlementTax += l.settlementIncomeTax ?? 0;
      if ((l.settlementIncomeTax ?? 0) !== 0 || (l.settlementLocalTax ?? 0) !== 0) settled.add(l.employeeId);
    }
  }
  return { totalPaid, incomeTax, localTax, settlementTax, settledPeople: settled.size };
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

  const { totalPaid, incomeTax, localTax, settlementTax, settledPeople } = sumRuns(filtered);
  const a01: Row = { people: distinctPeople(headcountRuns), totalPaid, incomeTax };
  const a04: Row = { people: settledPeople, totalPaid: null, incomeTax: settlementTax };
  // 가감계: 인원·총지급액 from A01 (the A04 people are the same employees), ⑥ = A01 + A04.
  const a10: Row = { people: a01.people, totalPaid, incomeTax: incomeTax + settlementTax };
  // A negative ⑥ (연말정산 환급 larger than the month's tax) is this month's 환급세액 (⑬), carried out.
  const due = Math.max(0, a10.incomeTax);
  const arising = Math.max(0, -a10.incomeTax);
  const adjusted = Math.min(carriedInRefund, due);

  return {
    attributionMonth,
    paymentMonth,
    a01,
    a04,
    a10,
    a99: { ...a10 },
    refund: {
      carriedIn: carriedInRefund,
      arising,
      adjusted,
      payable: due - adjusted,
      carriedOut: carriedInRefund + arising - adjusted,
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
