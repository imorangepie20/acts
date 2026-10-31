import type { EvidenceType, Side, VatType } from "./types";

/**
 * What a template remembers. Date, 사업장 and 부서 are never stored: they come from the entry screen.
 * Everything may be incomplete, so ids and amounts are nullable.
 */
export type TemplateBody =
  | {
      type: "purchase" | "sale";
      description: string;
      mainAccountId: number | null;
      counterAccountId: number | null;
      partnerId: number | null;
      evidenceType: EvidenceType;
      vatType: VatType;
      vatDeductible: boolean;
      supplyAmount: number | null;
      vatAmount: number | null;
    }
  | {
      type: "transfer";
      description: string;
      debitAccountId: number | null;
      creditAccountId: number | null;
      partnerId: number | null;
      evidenceType: EvidenceType;
      amount: number | null;
    }
  | {
      type: "general";
      description: string;
      closing: boolean;
      lines: {
        accountId: number | null;
        side: Side;
        amount: number | null;
        partnerId: number | null;
        description: string;
      }[];
    };

export const MAX_TEMPLATES = 200;
export const MAX_TEMPLATE_NAME = 50;

/** Every account and partner id a body refers to, for existence checks and name lookup. */
export function templateRefs(body: TemplateBody): { accountIds: number[]; partnerIds: number[] } {
  const accounts: (number | null)[] = [];
  const partners: (number | null)[] = [];
  if (body.type === "general") {
    for (const l of body.lines) {
      accounts.push(l.accountId);
      partners.push(l.partnerId);
    }
  } else {
    partners.push(body.partnerId);
    if (body.type === "transfer") accounts.push(body.debitAccountId, body.creditAccountId);
    else accounts.push(body.mainAccountId, body.counterAccountId);
  }
  const uniq = (xs: (number | null)[]) => [...new Set(xs.filter((x): x is number => x !== null))];
  return { accountIds: uniq(accounts), partnerIds: uniq(partners) };
}
