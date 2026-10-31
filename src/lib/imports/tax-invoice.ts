import { normalizeBusinessNumber } from "@/lib/business-number";
import { fail, ok } from "@/server/result";
import { findHeader, isBlankRow, parseDate, parseWon } from "./sheet";
import {
  ERR_BAD_AMOUNT,
  ERR_BAD_DATE,
  ERR_NEGATIVE,
  ERR_TOO_MANY_ROWS,
  MAX_IMPORT_ROWS,
  type Cell,
  type ParsedRow,
  type ParseResult,
} from "./types";

const REQUIRED = {
  date: ["작성일자"],
  approvalNo: ["승인번호"],
  supplierBiz: ["공급자사업자등록번호"],
  buyerBiz: ["공급받는자사업자등록번호"],
  name: ["상호"],
  supply: ["공급가액"],
};
const OPTIONAL = {
  vat: ["세액"],
  rep: ["대표자명"],
  item: ["품목명"],
  kind: ["전자세금계산서종류"],
};

const text = (c: Cell | undefined): string => (c == null ? "" : String(c).trim());
const digitsOrNull = (c: Cell | undefined) => normalizeBusinessNumber(text(c)) || null;
const firstAfter = (cols: number[], after: number) => cols.find((i) => i > after);

export function parseTaxInvoices(grid: Cell[][], direction: "purchase" | "sale"): ParseResult {
  const h = findHeader(grid, REQUIRED, OPTIONAL);
  if (!h.ok) return fail(h.error);
  const { row: headerRow, cols } = h.value;
  const supplierBizCol = cols.supplierBiz[0];
  const buyerBizCol = cols.buyerBiz[0];
  const hasVat = cols.vat.length > 0;
  const sale = direction === "sale";
  const counterBizCol = sale ? buyerBizCol : supplierBizCol;
  const ownBizCol = sale ? supplierBizCol : buyerBizCol;
  const nameCol = firstAfter(cols.name, counterBizCol);
  const repCol = firstAfter(cols.rep, counterBizCol);

  const rows: ParsedRow[] = [];
  for (const cells of grid.slice(headerRow + 1)) {
    const approvalNo = text(cells[cols.approvalNo[0]]);
    const dateCell = cells[cols.date[0]];
    const dateText = text(dateCell);
    if (!approvalNo && (dateText === "" || dateText.includes("합계"))) continue; // blank and 합계 rows
    if (isBlankRow(cells)) continue;
    if (rows.length >= MAX_IMPORT_ROWS) return fail(ERR_TOO_MANY_ROWS);

    const date = parseDate(dateCell);
    const supplyRaw = parseWon(cells[cols.supply[0]] ?? null);
    const vatRaw = hasVat
      ? text(cells[cols.vat[0]]) === ""
        ? 0
        : parseWon(cells[cols.vat[0]])
      : 0;
    const supply = supplyRaw ?? 0;
    const vat = vatRaw ?? 0;
    const kind = cols.kind.length ? text(cells[cols.kind[0]]) : "";
    const counterName = nameCol === undefined ? "" : text(cells[nameCol]);
    const item = cols.item.length ? text(cells[cols.item[0]]) : "";

    let problem: string | null = null;
    if (!date) problem = ERR_BAD_DATE;
    else if (!approvalNo) problem = "승인번호가 없습니다.";
    else if (supplyRaw === null || vatRaw === null) problem = ERR_BAD_AMOUNT;
    else if (supply <= 0 || vat < 0) problem = ERR_NEGATIVE;
    else if (vat > supply) problem = "세액이 공급가액보다 큽니다.";

    rows.push({
      key: `nts:${approvalNo.replace(/-/g, "")}`,
      date,
      counterpartyName: counterName,
      counterpartyBusinessNumber: digitsOrNull(cells[counterBizCol]),
      representative: repCol === undefined ? null : text(cells[repCol]) || null,
      ownBusinessNumber: digitsOrNull(cells[ownBizCol]),
      description: item || counterName,
      evidenceType: hasVat ? "tax_invoice" : "invoice",
      vatType: !hasVat ? "exempt" : kind.includes("영세") ? "zero_rated" : "taxable",
      supplyAmount: supply,
      vatAmount: vat,
      serviceCharge: 0,
      deductible: true,
      meta: {
        approvalNo: approvalNo || null,
        merchantName: null,
        merchantBusinessNumber: null,
        cardNo: null,
      },
      problem,
    });
  }
  return ok({ rows });
}
