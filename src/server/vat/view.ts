import { buildVatReturn } from "@/lib/vat/return";
import { parseVatParams, vatPeriod, type VatSelection } from "@/lib/vat/periods";
import type { VatReturn } from "@/lib/vat/return";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { getCompany } from "@/server/company/service";
import type { Db } from "@/server/db/client";
import { loadVatEntries } from "./entries";

export type VatView = {
  selection: VatSelection;
  period: { from: string; to: string };
  company: { name: string; businessNumber: string | null; representative: string | null; businessType: "corporation" | "individual" };
  result: VatReturn;
};

export async function loadVatView(db: Db, sp: Record<string, string | string[] | undefined>): Promise<VatView> {
  const company = await getCompany(db);
  const selection = parseVatParams(sp, { today: todayInSeoul(), businessType: company.businessType });
  const period = vatPeriod(selection);
  const entries = await loadVatEntries(db, period.from, period.to);
  return {
    selection,
    period,
    company: {
      name: company.name,
      businessNumber: company.businessNumber,
      representative: company.representative,
      businessType: company.businessType,
    },
    result: buildVatReturn(entries, selection),
  };
}
