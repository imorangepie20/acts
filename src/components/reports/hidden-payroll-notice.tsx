import { hiddenPayrollNotice } from "@/lib/reports/hidden-payroll";

/** Shown on a ledger when payroll vouchers were left out for a user without `payroll:manage`. */
export function HiddenPayrollNotice({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <p className="w-fit rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      {hiddenPayrollNotice(count)}
    </p>
  );
}
