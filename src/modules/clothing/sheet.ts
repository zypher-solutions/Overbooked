// Excel (.xlsx) and CSV files for the product screens, through SheetJS. Loaded only when a file is opened or saved,
// so the other screens never download it.
import type { Category, Product } from "@/lib/shop/types";
import { rowsOfProducts, type Col, type UnitLite } from "./bulk";

/** the first sheet named like "Products", else the first sheet, as rows of text cells */
export async function readSheet(file: File): Promise<string[][]> {
  const XLSX = await import("xlsx");
  const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const name = book.SheetNames.find((n) => /product|item|stock/i.test(n)) ?? book.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false });
  return rows.map((r) => r.map((c) => String(c ?? "")));
}

/** saves a sheet with a header row; the columns are as wide as their longest text */
export async function downloadSheet(fileName: string, header: string[], rows: (string | number)[][], sheetName = "Products") {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet["!cols"] = header.map((h, i) => ({ wch: Math.min(40, Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)) + 2) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  XLSX.writeFile(book, fileName, { compression: true });
}

/** money and piece cells as numbers, so Excel can add them up */
const asRow = (cols: Col[], cells: Record<string, string>) => cols.map((c) => {
  const v = cells[c.key] ?? "";
  return (c.kind === "money" || c.kind === "pieces") && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v;
});

/** the products in the same columns as Bulk add & edit, so the file can be changed in Excel and opened there again */
export async function exportProducts(products: Product[], ctx: { cols: Col[]; categories: Category[]; units: UnitLite[] }, fileName?: string) {
  const rows = rowsOfProducts(products, ctx, () => "").map((r) => asRow(ctx.cols, r.cells));
  const day = new Date().toISOString().slice(0, 10);
  await downloadSheet(fileName ?? `products-${day}.xlsx`, ctx.cols.map((c) => c.label), rows);
  return rows.length;
}

/** an empty file with the headers and one example row */
export async function downloadTemplate(cols: Col[], example: Record<string, string>) {
  await downloadSheet("products-template.xlsx", cols.map((c) => c.label), [asRow(cols, example)]);
}
