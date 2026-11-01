import { formatWon } from "@/lib/money";
import type { ReturnFigures } from "@/lib/withholding/return";
import { COMPUTED_ROW_CODES, NOT_COMPUTED_TEXT, RETURN_ROW_GROUPS, yearMonthLabel } from "@/lib/withholding/return-rows";

const cell = "border border-neutral-400 px-2 py-1";
const num = `${cell} text-right tabular-nums`;

/** 원천징수이행상황신고서 (별지 제21호서식) page 1, filled with the figures acts computes. */
export function ReturnForm({
  figures: f,
  company,
  semiannual,
}: {
  figures: ReturnFigures;
  company: { name: string; businessNumber: string | null; representative: string | null };
  semiannual: boolean;
}) {
  const computed: readonly string[] = COMPUTED_ROW_CODES;
  const rowFigures = { A01: f.a01, A04: f.a04, A10: f.a10, A99: f.a99 } as const;
  const range = `${yearMonthLabel(f.attributionMonth)} ~ ${yearMonthLabel(f.paymentMonth)}`;

  return (
    <section
      className="return-form mx-auto flex w-full max-w-[200mm] flex-col gap-3 rounded-md border bg-white p-6 text-xs text-neutral-900 print:max-w-none print:rounded-none print:border-0 print:p-0"
      aria-label={`원천징수이행상황신고서 귀속 ${f.attributionMonth} 지급 ${f.paymentMonth}`}
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-center text-lg font-semibold">원천징수이행상황신고서</h2>
        <p className="text-center text-neutral-600">[별지 제21호서식]</p>
        <table className="w-full border-collapse">
          <tbody>
            <tr>
              <th className={cell}>① 신고구분</th>
              <td className={cell}>{semiannual ? "반기" : "매월"}</td>
              <th className={cell}>② 귀속연월</th>
              <td className={cell}>{semiannual ? range : yearMonthLabel(f.attributionMonth)}</td>
              <th className={cell}>③ 지급연월</th>
              <td className={cell}>{semiannual ? range : yearMonthLabel(f.paymentMonth)}</td>
            </tr>
            <tr>
              <th className={cell}>법인명(상호)</th>
              <td className={cell}>{company.name}</td>
              <th className={cell}>대표자(성명)</th>
              <td className={cell}>{company.representative ?? ""}</td>
              <th className={cell}>사업자등록번호</th>
              <td className={cell}>{company.businessNumber ?? ""}</td>
            </tr>
          </tbody>
        </table>
      </header>

      <div>
        <p className="mb-1 flex justify-between font-medium">
          <span>① 원천징수 명세 및 납부세액</span>
          <span className="font-normal">(단위: 원)</span>
        </p>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-neutral-100">
              <th className={cell} colSpan={2}>
                소득구분
              </th>
              <th className={cell}>코드</th>
              <th className={cell}>④ 인원</th>
              <th className={cell}>⑤ 총지급액</th>
              <th className={cell}>⑥ 소득세 등</th>
              <th className={cell}>⑦ 농어촌특별세</th>
              <th className={cell}>⑧ 가산세</th>
              <th className={cell}>⑨ 당월 조정 환급세액</th>
              <th className={cell}>⑩ 소득세 등</th>
              <th className={cell}>⑪ 농어촌특별세</th>
            </tr>
          </thead>
          <tbody>
            {RETURN_ROW_GROUPS.flatMap((g) =>
              g.rows.map((r, i) => {
                const fig = computed.includes(r.code) ? rowFigures[r.code as keyof typeof rowFigures] : null;
                const totals = r.code === "A10" || r.code === "A99";
                return (
                  <tr key={r.code} className={totals ? "bg-neutral-50 font-semibold" : undefined} data-row={r.code}>
                    {i === 0 && g.rows.length > 1 ? (
                      <th className={`${cell} text-left`} rowSpan={g.rows.length}>
                        {g.label}
                      </th>
                    ) : null}
                    <td className={`${cell} whitespace-nowrap`} colSpan={g.rows.length > 1 ? 1 : 2}>
                      {r.label}
                    </td>
                    <td className={`${cell} text-center`}>{r.code}</td>
                    {fig ? (
                      <>
                        <td className={num}>{fig.people}</td>
                        <td className={num}>{fig.totalPaid === null ? "" : formatWon(fig.totalPaid)}</td>
                        <td className={num}>{formatWon(fig.incomeTax)}</td>
                        <td className={cell} />
                        <td className={cell} />
                        <td className={num}>{totals ? formatWon(f.refund.adjusted) : ""}</td>
                        <td className={num}>{totals ? formatWon(f.refund.payable) : ""}</td>
                        <td className={cell} />
                      </>
                    ) : (
                      <td className={`${cell} text-center text-neutral-500`} colSpan={8}>
                        {NOT_COMPUTED_TEXT}
                      </td>
                    )}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
        <p className="mt-1 text-neutral-600">⑦ 농어촌특별세, ⑧ 가산세, ⑪ 농어촌특별세는 계산하지 않아 비워 두었습니다.</p>
      </div>

      <div>
        <p className="mb-1 flex justify-between font-medium">
          <span>② 환급세액 조정</span>
          <span className="font-normal">(단위: 원)</span>
        </p>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-neutral-100">
              <th className={cell}>⑫ 전월 미환급세액</th>
              <th className={cell}>⑬ 당월 발생 환급세액(일반환급)</th>
              <th className={cell}>⑱ 조정대상 환급세액</th>
              <th className={cell}>⑲ 당월조정 환급세액계</th>
              <th className={cell}>⑳ 차월이월 환급세액 (⑱-⑲)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={num}>{formatWon(f.refund.carriedIn)}</td>
              <td className={num}>{formatWon(f.refund.arising)}</td>
              <td className={num}>{formatWon(f.refund.carriedIn + f.refund.arising)}</td>
              <td className={num}>{formatWon(f.refund.adjusted)}</td>
              <td className={num}>{formatWon(f.refund.carriedOut)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-neutral-600">
          ⑬은 연말정산 환급이 그달 소득세보다 클 때 생기는 일반환급입니다. ⑭~⑰, ㉑ 환급 신청액: {NOT_COMPUTED_TEXT}.
          ⑱은 ⑫+⑬으로 계산했습니다. A04 ⑤ 총지급액(연말정산 총급여)은 급여 대장에 없어 비워 두었습니다.
        </p>
      </div>

      <p className="flex justify-between border border-neutral-400 px-2 py-1.5 text-sm">
        <span className="font-medium">지방소득세(위택스 신고용)</span>
        <span className="tabular-nums">{formatWon(f.localTax)}원</span>
      </p>
    </section>
  );
}
