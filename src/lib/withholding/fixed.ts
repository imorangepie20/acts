import iconv from "iconv-lite";

const ENCODING = "euc-kr";
export const RECORD_BYTES = 190;

function encodeChar(ch: string): Buffer {
  const b = iconv.encode(ch, ENCODING);
  // iconv-lite's euc-kr is CP949: it substitutes "?" for unmappable characters
  // and encodes Hangul outside KS X 1001 to extended bytes. Accept printable
  // ASCII or a 2-byte KS X 1001 code only.
  const ascii = b.length === 1 && b[0] >= 0x20 && b[0] <= 0x7e;
  const wide =
    b.length === 2 && b[0] >= 0xa1 && b[0] <= 0xfe && b[1] >= 0xa1 && b[1] <= 0xfe;
  if (!(ascii && (b[0] !== 0x3f || ch === "?")) && !wide) {
    throw new Error(`EUC-KR로 표현할 수 없는 문자: ${ch}`);
  }
  return b;
}

/** X field: EUC-KR, left-aligned, space-padded, cut on a character boundary. */
export function x(value: string, len: number): Buffer {
  const out = Buffer.alloc(len, 0x20);
  let pos = 0;
  for (const ch of value) {
    const b = encodeChar(ch);
    if (pos + b.length > len) break;
    b.copy(out, pos);
    pos += b.length;
  }
  return out;
}

/** 9 field: ASCII digits, right-aligned, zero-padded, no sign. */
export function n(value: number, len: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`숫자 항목은 0 이상의 정수여야 합니다: ${value}`);
  }
  const s = String(value);
  if (s.length > len) {
    throw new Error(`숫자 항목이 ${len}자리를 넘습니다: ${value}`);
  }
  return Buffer.from(s.padStart(len, "0"), "ascii");
}

/** Joins fields into one record; must be exactly 190 bytes. */
export function record(parts: Buffer[]): Buffer {
  const b = Buffer.concat(parts);
  if (b.length !== RECORD_BYTES) {
    throw new Error(`레코드 길이가 ${RECORD_BYTES}바이트가 아닙니다: ${b.length}`);
  }
  return b;
}
