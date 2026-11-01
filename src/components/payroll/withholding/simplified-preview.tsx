import { formatWon } from "@/lib/money";
import type { SimplifiedRow } from "@/server/withholding/simplified";

const num = "px-3 py-2 text-right tabular-nums";
const cell = "px-3 py-2";

/** Employees of the half-year as they go into the file; 주민등록번호 masked. */
export function SimplifiedPreview({ rows }: { rows: SimplifiedRow[] }) {
  const total = rows.reduce((s, r) => s + r.wages, 0);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className={cell}>성명</th>
            <th className={cell}>주민등록번호</th>
            <th className={cell}>근무기간</th>
            <th className={`${cell} text-right`}>급여 등 (과세)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeId} className="border-t">
              <td className={cell}>{r.name}</td>
              <td className={`${cell} tabular-nums`}>{r.rrnMasked}</td>
              <td className={`${cell} tabular-nums`}>
                {r.from} ~ {r.to}
              </td>
              <td className={num}>{formatWon(r.wages)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30 font-medium">
            <td className={cell} colSpan={3}>
              합계 ({rows.length}명)
            </td>
            <td className={num}>{formatWon(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
