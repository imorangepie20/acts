// 부가가치세 신고기간 (부가가치세법 제5조, 제48조, 제49조) and the screen's URL parameters.

export type VatKind = "prelim" | "final";

export type VatSelection = {
  year: number;
  term: 1 | 2;
  kind: VatKind;
  /** 확정 only: true = this term's 예정신고 was filed, so 확정 covers the last three months. */
  prelimFiled: boolean;
  /** (57) 전자신고 세액공제 applies when the taxpayer files electronically. */
  efile: boolean;
  /** (23) 예정신고 미환급세액, 확정 only */
  prelimRefund: number;
  /** (24) 예정고지세액, 확정 only */
  notice: number;
  errors: { prelimRefund?: string; notice?: string };
};

type BusinessType = "corporation" | "individual";

export const ERR_WON = "0 이상의 정수(원)를 입력하세요.";

/** Date range of a 신고: 예정 = first quarter of the term; 확정 = last quarter, or the whole term without a 예정신고. */
export function vatPeriod(s: Pick<VatSelection, "year" | "term" | "kind" | "prelimFiled">): { from: string; to: string } {
  const [first, last] = s.term === 1 ? ["01-01", "06-30"] : ["07-01", "12-31"];
  const [q2Start, q1End] = s.term === 1 ? ["04-01", "03-31"] : ["10-01", "09-30"];
  if (s.kind === "prelim") return { from: `${s.year}-${first}`, to: `${s.year}-${q1End}` };
  return { from: `${s.year}-${s.prelimFiled ? q2Start : first}`, to: `${s.year}-${last}` };
}

const PERIOD_ENDS: { term: 1 | 2; kind: VatKind; end: string }[] = [
  { term: 1, kind: "prelim", end: "03-31" },
  { term: 1, kind: "final", end: "06-30" },
  { term: 2, kind: "prelim", end: "09-30" },
  { term: 2, kind: "final", end: "12-31" },
];

/** The most recent period whose end date is strictly before `today`; an individual gets 확정 periods only. */
export function defaultVatPeriod(today: string, businessType: BusinessType): Pick<VatSelection, "year" | "term" | "kind"> {
  const year = Number(today.slice(0, 4));
  const candidates = PERIOD_ENDS.filter((p) => businessType === "corporation" || p.kind === "final");
  for (const y of [year, year - 1]) {
    for (const p of [...candidates].reverse()) {
      if (`${y}-${p.end}` < today) return { year: y, term: p.term, kind: p.kind };
    }
  }
  // Unreachable: the previous year's 2기 확정 (12-31) always ends before any date in `year`.
  return { year: year - 1, term: 2, kind: "final" };
}

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

function parseWon(raw: string | undefined): { value: number; error?: string } {
  if (raw === undefined || raw === "") return { value: 0 };
  if (!/^\d{1,12}$/.test(raw)) return { value: 0, error: ERR_WON };
  return { value: Number(raw) };
}

/** Reads `year`, `term`, `kind`, `prelim`, `efile`, `prelimRefund`, `notice`; invalid values fall back to defaults. */
export function parseVatParams(
  sp: Record<string, string | string[] | undefined>,
  ctx: { today: string; businessType: BusinessType },
): VatSelection {
  const d = defaultVatPeriod(ctx.today, ctx.businessType);
  const rawYear = one(sp.year);
  const rawTerm = one(sp.term);
  const rawKind = one(sp.kind);
  const rawPrelim = one(sp.prelim);

  const parsedYear = rawYear !== undefined && /^\d{4}$/.test(rawYear) ? Number(rawYear) : NaN;
  const year = parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : d.year;
  const term: 1 | 2 = rawTerm === "1" ? 1 : rawTerm === "2" ? 2 : d.term;
  const kind: VatKind = rawKind === "prelim" || rawKind === "final" ? rawKind : d.kind;
  const prelimFiled = rawPrelim === "1" ? true : rawPrelim === "0" ? false : ctx.businessType === "corporation";
  const efile = one(sp.efile) !== "0";

  const errors: VatSelection["errors"] = {};
  let prelimRefund = 0;
  let notice = 0;
  if (kind === "final") {
    const r = parseWon(one(sp.prelimRefund));
    const n = parseWon(one(sp.notice));
    prelimRefund = r.value;
    notice = n.value;
    if (r.error) errors.prelimRefund = r.error;
    if (n.error) errors.notice = n.error;
  }

  return { year, term, kind, prelimFiled, efile, prelimRefund, notice, errors };
}
