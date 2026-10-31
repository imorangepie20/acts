import { listSites, listDepartments } from "@/server/sites/service";
import type { Db } from "@/server/db/client";
import { listItems } from "./items";

/** Choices for the employee form; an inactive site, department or item stays when the employee uses it. */
export async function getEmployeeFormOptions(
  db: Db,
  current?: { siteId: number; departmentId: number | null; defaultAmounts: Record<string, number> },
) {
  const [s, d, items] = await Promise.all([listSites(db), listDepartments(db), listItems(db)]);
  return {
    sites: s.filter((x) => x.isActive || x.id === current?.siteId).map(({ id, name }) => ({ id, name })),
    departments: d.filter((x) => x.isActive || x.id === current?.departmentId).map(({ id, name }) => ({ id, name })),
    items: items
      .filter((i) => i.isActive || (current?.defaultAmounts[i.code] ?? 0) > 0)
      .map(({ code, name }) => ({ code, name })),
  };
}
