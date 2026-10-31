/** Payroll settings fields and their labels (pure, shared with the settings screen). */
export const SETTING_CODE_FIELDS = [
  "pensionCompanyCode",
  "insuranceCompanyCode",
  "withholdingCode",
  "companyPayableCode",
  "netPayCode",
  "executiveCode",
  "staffCode",
] as const;
export const SETTING_PARTNER_FIELDS = [
  "pensionPartnerId",
  "healthPartnerId",
  "employmentPartnerId",
  "taxPartnerId",
  "localTaxPartnerId",
] as const;

export type SettingCodeField = (typeof SETTING_CODE_FIELDS)[number];
export type SettingPartnerField = (typeof SETTING_PARTNER_FIELDS)[number];

export type PayrollSettingsInput = Record<SettingCodeField, string> & Record<SettingPartnerField, number | null>;

/** Korean labels, also used in error messages. */
export const SETTING_LABELS: Record<SettingCodeField | SettingPartnerField, string> = {
  pensionCompanyCode: "사업주 국민연금",
  insuranceCompanyCode: "사업주 건강·장기요양·고용보험",
  withholdingCode: "예수금(근로자 부담분·소득세)",
  companyPayableCode: "사업주 부담 4대보험 미지급",
  netPayCode: "실지급액",
  executiveCode: "임원급여",
  staffCode: "직원급여",
  pensionPartnerId: "국민연금공단",
  healthPartnerId: "국민건강보험공단",
  employmentPartnerId: "근로복지공단",
  taxPartnerId: "관할 세무서",
  localTaxPartnerId: "지방자치단체",
};
