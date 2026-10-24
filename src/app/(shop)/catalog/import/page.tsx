"use client";

import { useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { ChevronLeft, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { errorText } from "@/lib/shop/format";
import { PageHeader, Panel, ghostButtonClass, goldButtonClass, tableWrap, theadClass } from "@/components/shop/ui";

// One row per variation. Rows with the same item SKU become one item.
// units: codes separated by "|" (room numbers, registrations) or a number of pieces (codes made for you).
type Row = Record<string, string>;

export default function ImportCatalog() {
  const { categories, templates, activeBranches, canManage } = useShop();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ products: number; variations: number; units: number } | null>(null);

  const rateCols = Array.from(new Set(templates.flatMap((t) => t.rate_types)));
  const fieldCols = Array.from(new Set(templates.flatMap((t) => t.variation_fields.map((f) => f.key))));
  const columns = ["category", "item_name", "item_sku", "variation_name", "variation_sku", ...fieldCols, ...rateCols,
    "base_occupancy", "max_occupancy", "km_included_per_day", "turnaround_hours", "replacement_value", "branch", "units"];

  const sample = () => {
    const example = (t: (typeof templates)[number]) => {
      const cat = categories.find((c) => c.template_key === t.key)?.name ?? t.name;
      const row: Row = { category: cat, item_name: "Example " + (t.labels.item ?? "item").toLowerCase(), item_sku: "EX-" + t.key.toUpperCase().slice(0, 3),
        variation_name: "", variation_sku: "EX-" + t.key.toUpperCase().slice(0, 3) + "-1", branch: activeBranches[0]?.name ?? "",
        units: t.kind === "wearable" ? "2" : t.kind === "room" ? "101|102" : "KL-07-XX-0001" };
      t.rate_types.forEach((r) => { row[r] = r === "day" || r === "night" ? "1000" : ""; });
      return row;
    };
    const csv = Papa.unparse({ fields: columns, data: templates.map((t) => columns.map((c) => example(t)[c] ?? "")) });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "catalog-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const read = (file: File) => {
    Papa.parse<Row>(file, {
      header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (res) => { setRows(res.data); setResult(null); },
      error: (e) => toast.error("Could not read the file: " + e.message),
    });
  };

  const items = () => {
    const bySku = new Map<string, { category: string; name: string; sku: string; replacement_value?: string; variations: unknown[] }>();
    for (const r of rows ?? []) {
      const sku = (r.item_sku ?? "").trim().toUpperCase();
      if (!sku || !r.item_name?.trim() || !r.category?.trim()) throw new Error("Every row needs category, item_name and item_sku.");
      const item = bySku.get(sku) ?? { category: r.category.trim(), name: r.item_name.trim(), sku, replacement_value: r.replacement_value, variations: [] };
      const vSku = (r.variation_sku || `${sku}-${item.variations.length + 1}`).trim().toUpperCase();
      const unitsText = (r.units ?? "").trim();
      const codes = /^\d+$/.test(unitsText)
        ? Array.from({ length: Math.min(200, Number(unitsText)) }, (_, i) => `${vSku}-${i + 1}`)
        : unitsText.split("|").map((c) => c.trim()).filter(Boolean);
      item.variations.push({
        sku: vSku, name: r.variation_name?.trim() || item.name,
        attributes: Object.fromEntries(fieldCols.filter((k) => r[k]?.trim()).map((k) => [k, r[k].trim()])),
        rates: Object.fromEntries(rateCols.filter((k) => r[k]?.trim()).map((k) => [k, r[k].trim()])),
        base_occupancy: r.base_occupancy || null, max_occupancy: r.max_occupancy || null,
        km_included_per_day: r.km_included_per_day || null, turnaround_hours: r.turnaround_hours || null,
        units: codes.map((code) => ({ branch: (r.branch || activeBranches[0]?.name || "").trim(), code })),
      });
      bySku.set(sku, item);
    }
    return Array.from(bySku.values());
  };

  const run = async () => {
    setBusy(true);
    try {
      setResult(await call("import_catalog", { p: { items: items() } }));
      toast.success("Imported");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Only owners and managers can import.</p></Panel>;
  return (
    <>
      <Link href="/catalog" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Catalog</Link>
      <PageHeader title="Import the catalog" subtitle="Add many items at once from a spreadsheet. Importing again updates names and prices; it never removes anything." />
      <Panel>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          <li>Download the sample and fill it in Excel or Google Sheets. One row per size, room type or model.</li>
          <li><span className="font-mono">units</span>: a number of pieces (codes are made for you), or room numbers / registrations separated by <span className="font-mono">|</span>.</li>
          <li>Categories and branches must already exist; use their exact names.</li>
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={ghostButtonClass} onClick={sample}><Download className="h-4 w-4" /> Download sample</button>
          <label className={goldButtonClass + " cursor-pointer"}>
            <Upload className="h-4 w-4" /> Choose CSV file
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }} />
          </label>
        </div>
      </Panel>

      {rows ? (
        <Panel className="mt-4" title={`${rows.length} rows`} actions={<button className={goldButtonClass} disabled={busy || rows.length === 0} onClick={run}>{busy ? "Importing..." : "Import"}</button>}>
          <div className={tableWrap}>
            <table className="w-full text-left text-xs">
              <thead className={theadClass}><tr>{["category", "item_name", "item_sku", "variation_sku", "branch", "units"].map((c) => <th key={c} className="px-3 py-2">{c}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>{["category", "item_name", "item_sku", "variation_sku", "branch", "units"].map((c) => <td key={c} className="px-3 py-1.5">{r[c]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 50 ? <p className="mt-2 text-xs text-muted-foreground">Showing the first 50 rows.</p> : null}
          {result ? <p className="mt-3 text-sm text-emerald">Done: {result.products} items, {result.variations} variations, {result.units} new units.</p> : null}
        </Panel>
      ) : null}
    </>
  );
}
