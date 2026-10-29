import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { ReportFilter, ReportMode } from "@/lib/reports/types";

type Option = { id: number; name: string };

export type ReportFiltersProps = {
  filter: ReportFilter;
  mode: ReportMode;
  sites: Option[];
  departments: Option[];
  showSite: boolean;
  showDepartment: boolean;
  /** Other query params to keep across submits (e.g. account). */
  extraParams?: Record<string, string | undefined>;
  exportHref?: string;
};

export function ReportFilters({
  filter,
  mode,
  sites,
  departments,
  showSite,
  showDepartment,
  extraParams = {},
  exportHref,
}: ReportFiltersProps) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      {Object.entries(extraParams).map(([k, v]) =>
        v === undefined || v === "" ? null : <input key={k} type="hidden" name={k} value={v} />,
      )}
      {mode === "period" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rf-from" className="text-sm font-medium">
            기간
          </label>
          <div className="flex items-center gap-2">
            <Input id="rf-from" name="from" type="date" defaultValue={filter.from} className="w-40" />
            <span aria-hidden>~</span>
            <Input id="rf-to" name="to" type="date" defaultValue={filter.to} className="w-40" aria-label="종료일" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rf-to" className="text-sm font-medium">
            기준일
          </label>
          <Input id="rf-to" name="to" type="date" defaultValue={filter.to} className="w-40" />
        </div>
      )}
      {showSite && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rf-site" className="text-sm font-medium">
            사업장
          </label>
          <NativeSelect id="rf-site" name="site" defaultValue={filter.siteId?.toString() ?? ""}>
            <NativeSelectOption value="">전체</NativeSelectOption>
            {sites.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      {showDepartment && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rf-dept" className="text-sm font-medium">
            부서
          </label>
          <NativeSelect id="rf-dept" name="dept" defaultValue={filter.departmentId?.toString() ?? ""}>
            <NativeSelectOption value="">전체</NativeSelectOption>
            {departments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {d.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      <Button type="submit">조회</Button>
      {exportHref && (
        <Button variant="outline" nativeButton={false} render={<a href={exportHref} download />}>
          엑셀 다운로드
        </Button>
      )}
    </form>
  );
}
