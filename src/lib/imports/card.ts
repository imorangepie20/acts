import { normalizeBusinessNumber } from "@/lib/business-number";
import { fail, ok } from "@/server/result";
import { findHeader, isBlankRow, parseDate, parseWon } from "./sheet";
import {
  ERR_BAD_AMOUNT,
  ERR_BAD_DATE,
  ERR_NEGATIVE,
  ERR_SERVICE_CHARGE,
  ERR_TOO_MANY_ROWS,
  MAX_IMPORT_ROWS,
  type Cell,
  type ParsedRow,
  type ParseResult,
} from "./types";

const REQUIRED = {
  date: ["승인일자", "거래일자", "이용일자", "승인일시", "거래일시"],
  merchant: ["가맹점명", "이용가맹점", "가맹점"],
  total: ["합계", "합계금액", "이용금액", "승인금액", "매입금액"],
};
const OPTIONAL = {
  supply: ["공급가액"],
  vat: ["세액", "부가세"],
  service: ["봉사료", "비과세"],
  bizNo: ["가맹점사업자번호", "가맹점사업자등록번호", "사업자번호"],
  approvalNo: ["승인번호"],
  /** 홈택스 files carry no 승인번호; this per-transaction serial is the dedup key instead. */
  serial: ["사업용신용카드거래내역일련번호"],
  cardNo: ["카드번호"],
  deduct: ["공제여부결정", "공제여부", "공제구분"],
  type: ["가맹점유형", "과세유형"],
};

const text = (c: Cell | undefined): string => (c == null ? "" : String(c).trim());

export function parseCardPurchases(grid: Cell[][]): ParseResult {
  const h = findHeader(grid, REQUIRED, OPTIONAL);
  if (!h.ok) return fail(h.error);
  const { row: headerRow, cols } = h.value;
  const get = (cells: Cell[], f: string): Cell => {
    const i = cols[f][0];
    return i === undefined ? null : (cells[i] ?? null);
  };
  const splitColumns = cols.supply.length > 0 && cols.vat.length > 0;

  const seen = new Map<string, number>();
  const rows: ParsedRow[] = [];
  for (const cells of grid.slice(headerRow + 1)) {
    if (isBlankRow(cells)) continue;
    const dateCell = get(cells, "date");
    const merchant = text(get(cells, "merchant"));
    const dateText = text(dateCell);
    if (
      (dateText === "" && (merchant === "" || merchant.includes("합계"))) ||
      dateText.includes("합계")
    ) {
      continue; // blank and 합계 rows
    }
    if (rows.length >= MAX_IMPORT_ROWS) return fail(ERR_TOO_MANY_ROWS);

    const date = parseDate(dateCell);
    const total = parseWon(get(cells, "total"));
    const serviceCharge = parseWon(get(cells, "service")) ?? 0;
    const approvalNo = text(get(cells, "approvalNo")) || null;
    const uniqueNo = approvalNo ?? (text(get(cells, "serial")) || null);
    const last4 = normalizeBusinessNumber(text(get(cells, "cardNo"))).slice(-4);
    const bizNo = normalizeBusinessNumber(text(get(cells, "bizNo"))) || null;

    let supply = total ?? 0;
    let vat = 0;
    let deductible = false;
    if (splitColumns) {
      const s = parseWon(get(cells, "supply"));
      const v = parseWon(get(cells, "vat"));
      if (s !== null && v !== null) {
        supply = s;
        vat = v;
        deductible = !text(get(cells, "deduct")).includes("불공제");
      }
    }

    let key: string;
    if (uniqueNo) {
      key = `card:${last4}:${date ?? ""}:${uniqueNo}`;
    } else {
      const tuple = `card:${date ?? ""}:${merchant}:${total ?? ""}`;
      const n = (seen.get(tuple) ?? 0) + 1;
      seen.set(tuple, n);
      key = `${tuple}:${n}`;
    }

    let problem: string | null = null;
    if (!date) problem = ERR_BAD_DATE;
    else if (total === null) problem = ERR_BAD_AMOUNT;
    else if (total <= 0) problem = ERR_NEGATIVE;
    else if (serviceCharge > 0) problem = ERR_SERVICE_CHARGE;

    rows.push({
      key,
      date,
      counterpartyName: merchant,
      counterpartyBusinessNumber: bizNo,
      representative: null,
      ownBusinessNumber: null,
      description: merchant,
      evidenceType: "card",
      vatType: text(get(cells, "type")).includes("면세") ? "exempt" : "taxable",
      supplyAmount: supply,
      vatAmount: vat,
      serviceCharge,
      deductible,
      meta: {
        approvalNo,
        merchantName: merchant || null,
        merchantBusinessNumber: bizNo,
        cardNo: last4.length === 4 ? `****${last4}` : null,
      },
      problem,
    });
  }
  return ok({ rows });
}
