import type { Result } from "@/server/result";
import type { EvidenceType, VatType } from "@/lib/vouchers/types";

export type Cell = string | number | Date | null;

export type ImportMeta = {
  approvalNo: string | null;
  merchantName: string | null;
  merchantBusinessNumber: string | null;
  cardNo: string | null;
};

export type ParsedRow = {
  key: string;
  date: string | null;
  counterpartyName: string;
  counterpartyBusinessNumber: string | null;
  representative: string | null;
  /** Our side of a tax invoice (buyer for purchase, supplier for sale); null for cards. */
  ownBusinessNumber: string | null;
  description: string;
  evidenceType: EvidenceType;
  vatType: VatType;
  supplyAmount: number;
  vatAmount: number;
  serviceCharge: number;
  deductible: boolean;
  meta: ImportMeta;
  /** Parse-level block reason (negative, 봉사료, bad date). */
  problem: string | null;
};

export type ParseResult = Result<{ rows: ParsedRow[] }>;

export const MAX_IMPORT_ROWS = 1000;
export const ERR_TOO_MANY_ROWS = "한 번에 1,000건까지 불러올 수 있습니다.";
export const ERR_WRONG_FILE_TYPE =
  "엑셀 파일(.xlsx, .xls)만 올릴 수 있습니다. 홈택스에서 내려받은 파일을 그대로 올려 주세요.";
export const ERR_NEGATIVE = "음수 금액(수정·취소분)은 전표 입력 화면에서 직접 입력하세요.";
export const ERR_SERVICE_CHARGE = "봉사료가 있는 건은 직접 입력하세요.";
export const ERR_BAD_DATE = "날짜를 읽을 수 없습니다.";
export const ERR_BAD_AMOUNT = "금액을 읽을 수 없습니다.";
