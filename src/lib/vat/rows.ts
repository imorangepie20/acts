// Row layout of 별지 제21호서식 <개정 2026. 3. 20.> (law.go.kr flSeq=162619805).
// 제1쪽 ① 신고내용 and ⑤ 과세표준명세, 제4쪽 명세. Labels are the form's own wording; a row the
// form prints without a name (업태·종목 entry lines (31)–(33), (85)–(86)) has an empty label.

export type VatRow = { no: number; label: string; rate?: string; shadedAmount?: boolean; computed: boolean };
export type VatRowGroup = { label: string; rows: VatRow[] };

/** Rows acts fills; every other row shows NOT_COMPUTED_TEXT (src/lib/withholding/return-rows.ts). */
export const COMPUTED_VAT_ROWS: readonly number[] = [
  1, 3, 4, 5, 6, 9, 10, 12, 15, 16, 17, 18, 19, 21, 23, 24, 30, 35, 44, 45, 52, 53, 56, 57, 63, 88, 89, 90,
];

const SHADED_AMOUNT: readonly number[] = [11, 19, 26, 27, 28, 48, 49, 50, 51, 57, 58, 59, 60, 61, 62, 63];

function row(no: number, label: string, rate?: string): VatRow {
  const r: VatRow = { no, label, computed: COMPUTED_VAT_ROWS.includes(no) };
  if (rate !== undefined) r.rate = rate;
  if (SHADED_AMOUNT.includes(no)) r.shadedAmount = true;
  return r;
}

const single = (no: number, label: string): VatRowGroup => ({ label, rows: [row(no, label)] });

/** 제1쪽 (1)–(35). 납부(환급)세액 ㉰ (no row number) is rendered between (18) and (19) by the component. */
export const PAGE1_GROUPS: VatRowGroup[] = [
  {
    label: "과세표준 및 매출세액",
    rows: [
      row(1, "과세 세금계산서 발급분", "10/100"),
      row(2, "과세 매입자발행 세금계산서", "10/100"),
      row(3, "과세 신용카드ㆍ현금영수증 발행분", "10/100"),
      row(4, "과세 기타(정규영수증 외 매출분)", "10/100"),
      row(5, "영세율 세금계산서 발급분", "0/100"),
      row(6, "영세율 기타", "0/100"),
      row(7, "예정신고 누락분"),
      row(8, "대손세액 가감"),
      row(9, "합계"),
    ],
  },
  {
    label: "매입세액",
    rows: [
      row(10, "세금계산서 수취분 일반매입"),
      row(11, "세금계산서 수취분 수출기업 수입분 납부유예"),
      row(12, "세금계산서 수취분 고정자산매입"),
      row(13, "예정신고 누락분"),
      row(14, "매입자발행 세금계산서"),
      row(15, "그 밖의 공제매입세액"),
      row(16, "합계 (10)-(11)+(12)+(13)+(14)+(15)"),
      row(17, "공제받지 못할 매입세액"),
      row(18, "차감계 (16)-(17)"),
    ],
  },
  {
    label: "경감ㆍ공제세액",
    rows: [
      row(19, "그 밖의 경감ㆍ공제세액"),
      row(20, "신용카드매출전표등 발행공제 등"),
      row(21, "합계"),
    ],
  },
  single(22, "소규모 개인사업자 부가가치세 감면세액"),
  single(23, "예정신고 미환급세액"),
  single(24, "예정고지세액"),
  single(25, "수시부과세액"),
  single(26, "사업양수자가 대리납부한 세액"),
  single(27, "매입자 납부특례에 따라 납부한 세액"),
  single(28, "신용카드업자가 대리납부한 세액"),
  single(29, "가산세액 계"),
  single(30, "차감ㆍ가감하여 납부할 세액(환급받을 세액)(㉰-㉱-㉲-㉳-㉴-㉵-㉶-㉷-㉸+㉹)"),
  {
    label: "과세표준명세",
    rows: [row(31, ""), row(32, ""), row(33, ""), row(34, "수입금액 제외"), row(35, "합계")],
  },
];

/** 제4쪽 명세 (36)–(90). */
export const PAGE4_GROUPS: VatRowGroup[] = [
  {
    label: "예정신고 누락분 명세",
    rows: [
      row(36, "매출 과세 세금계산서", "10/100"),
      row(37, "매출 과세 기타", "10/100"),
      row(38, "매출 영세율 세금계산서", "0/100"),
      row(39, "매출 영세율 기타", "0/100"),
      row(40, "매출 합계"),
      row(41, "매입 세금계산서"),
      row(42, "매입 그 밖의 공제매입세액"),
      row(43, "매입 합계"),
    ],
  },
  {
    label: "(15) 그 밖의 공제매입세액 명세",
    rows: [
      row(44, "신용카드매출전표등 수령명세서 제출분 일반매입"),
      row(45, "신용카드매출전표등 수령명세서 제출분 고정자산매입"),
      row(46, "의제매입세액", "제5쪽 참조"),
      row(47, "재활용폐자원등 매입세액", "제5쪽 참조"),
      row(48, "과세사업전환 매입세액"),
      row(49, "재고매입세액"),
      row(50, "변제대손세액"),
      row(51, "외국인 관광객에 대한 환급세액"),
      row(52, "합계"),
    ],
  },
  {
    label: "(17) 공제받지 못할 매입세액 명세",
    rows: [
      row(53, "공제받지 못할 매입세액"),
      row(54, "공통매입세액 중 면세사업등 해당 세액"),
      row(55, "대손처분받은 세액"),
      row(56, "합계"),
    ],
  },
  {
    label: "(19) 그 밖의 경감ㆍ공제세액 명세",
    rows: [
      row(57, "전자신고 세액공제"),
      row(58, "전자세금계산서 발급세액 공제"),
      row(59, "일반택시 운송사업자 경감세액"),
      row(60, "대리납부 세액공제"),
      row(61, "현금영수증사업자 세액공제"),
      row(62, "기타"),
      row(63, "합계"),
    ],
  },
  {
    label: "(29) 가산세액 명세",
    rows: [
      row(64, "사업자미등록 등", "제6쪽 참조"),
      row(65, "세금계산서 지연발급 등", "1/100"),
      row(66, "세금계산서 지연수취", "5/1,000"),
      row(67, "세금계산서 미발급 등", "2/100"),
      row(68, "세금계산서 가공 발급ㆍ수취 등", "4/100"),
      row(69, "전자세금계산서 발급명세 전송 지연전송", "3/1,000"),
      row(70, "전자세금계산서 발급명세 전송 미전송", "5/1,000"),
      row(71, "세금계산서합계표 제출 불성실", "5/1,000"),
      row(72, "세금계산서합계표 지연제출", "3/1,000"),
      row(73, "신고 불성실 무신고(일반)", "제6쪽 참조"),
      row(74, "신고 불성실 무신고(부당)", "제6쪽 참조"),
      row(75, "신고 불성실 과소ㆍ초과환급신고(일반)", "제6쪽 참조"),
      row(76, "신고 불성실 과소ㆍ초과환급신고(부당)", "제6쪽 참조"),
      row(77, "납부지연", "제6쪽 참조"),
      row(78, "영세율 과세표준신고 불성실", "5/1,000"),
      row(79, "현금매출명세서 불성실", "1/100"),
      row(80, "부동산임대공급가액명세서 불성실", "1/100"),
      row(81, "매입자 납부특례 거래계좌 미사용", "제6쪽 참조"),
      row(82, "매입자 납부특례 거래계좌 지연입금", "제6쪽 참조"),
      row(83, "신용카드매출전표 등 수령명세서 미제출ㆍ과다기재", "5/1,000"),
      row(84, "합계"),
    ],
  },
  {
    label: "면세사업 수입금액",
    rows: [row(85, ""), row(86, ""), row(87, "수입금액 제외"), row(88, "합계")],
  },
  {
    label: "계산서 발급 및 수취 명세",
    rows: [row(89, "계산서 발급금액"), row(90, "계산서 수취금액")],
  },
];
