import ExcelJS from "exceljs";

export type SheetColumn = { header: string; key: string; width: number; money?: boolean };

export type SheetSpec = {
  /** File name without the .xlsx extension. */
  fileName: string;
  title: string;
  /** Lines under the title. */
  meta: string[];
  columns: SheetColumn[];
  rows: Record<string, string | number | null>[];
  /** Data-row indexes rendered bold. */
  emphasis?: number[];
};

export const MONEY_FORMAT = "#,##0;-#,##0";

/** Renders one worksheet into `wb`: title, meta lines, a blank row, a frozen bold header, then data rows. */
function addSheet(wb: ExcelJS.Workbook, spec: SheetSpec): void {
  const ws = wb.addWorksheet(spec.title.slice(0, 31));
  spec.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  ws.getCell(1, 1).value = spec.title;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  spec.meta.forEach((line, i) => {
    ws.getCell(2 + i, 1).value = line;
  });

  const headerRowNo = spec.meta.length + 3; // title + meta + blank row
  const header = ws.getRow(headerRowNo);
  spec.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true };
    cell.border = { bottom: { style: "thin" } };
    if (c.money) cell.alignment = { horizontal: "right" };
  });

  const bold = new Set(spec.emphasis ?? []);
  spec.rows.forEach((row, r) => {
    const excelRow = ws.getRow(headerRowNo + 1 + r);
    spec.columns.forEach((c, i) => {
      const v = row[c.key] ?? null;
      const cell = excelRow.getCell(i + 1);
      if (v !== null) cell.value = v;
      if (c.money) cell.numFmt = MONEY_FORMAT;
      if (bold.has(r)) cell.font = { bold: true };
    });
  });

  ws.views = [{ state: "frozen", ySplit: headerRowNo }];
}

/** One sheet per spec, named by its title (max 31 characters). */
export async function renderWorkbook(specs: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const spec of specs) addSheet(wb, spec);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const renderXlsx = (spec: SheetSpec): Promise<Buffer> => renderWorkbook([spec]);

