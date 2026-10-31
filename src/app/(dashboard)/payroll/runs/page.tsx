import { NewRunDialog } from "@/components/payroll/runs/new-run-dialog";
import { RunsTable } from "@/components/payroll/runs/runs-table";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { listRuns } from "@/server/payroll/runs";

export default async function Page({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requirePermission("payroll:manage");
  const today = todayInSeoul();
  const raw = (await searchParams).year;
  const year = raw && /^\d{4}$/.test(raw) ? Number(raw) : Number(today.slice(0, 4));
  const rows = await listRuns(db, { year });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">급여 대장</h1>
        <NewRunDialog defaultMonth={today.slice(0, 7)} defaultPayDate={today} />
      </div>
      <RunsTable year={year} rows={rows} />
    </div>
  );
}
