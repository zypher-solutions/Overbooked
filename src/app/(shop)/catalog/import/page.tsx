"use client";

import { useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { ChevronLeft, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { errorText } from "@/lib/shop/format";
import { useCatalog } from "@/lib/shop/useCatalog";
import { PageHeader, Panel, ghostButtonClass, goldButtonClass, tableWrap, theadClass } from "@/components/shop/ui";

// One row per variation. Rows with the same item SKU become one item.
// units: codes separated by "|" (room numbers, registrations) or a number of pieces (codes made for you).
type Row = Record<string, string>;
// bridal and groom SKUs, as in TRENDZ: BR-001, BR-001-GOLD-M
const SKU_PATTERN = /^[A-Z]{2,6}-[0-9]{3,4}(-[A-Za-z0-9]+)*$/;

export default function ImportCatalog() {
  const { categories, templates, activeBranches, canManage, trendz } = useShop();
  const { products } = useCatalog({ includeInactive: true });
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
      // bridal and groom: the SKUs are numbered from the category's base SKU, so the sample leaves them empty
      const row: Row = { category: cat, item_name: "Example " + (t.labels.item ?? "item").toLowerCase(), item_sku: trendz ? "" : "EX-" + t.key.toUpperCase().slice(0, 3),
        variation_name: "", variation_sku: trendz ? "" : "EX-" + t.key.toUpperCase().slice(0, 3) + "-1", branch: activeBranches[0]?.name ?? "",
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
    // bridal and groom, as in TRENDZ: an item without a SKU gets its category's base SKU and the next number
    // (an item that already exists keeps its own); typed SKUs must follow the pattern
    const highest = new Map<string, number>();
    const knownSku = new Map<string, string>();
    if (trendz) {
      for (const p of products ?? []) {
        knownSku.set(`${categories.find((c) => c.id === p.category_id)?.name.toLowerCase()}|${p.name.toLowerCase()}`, p.sku);
        const m = /^([A-Z]{2,6})-(\d+)/.exec(p.sku);
        if (m) highest.set(m[1], Math.max(highest.get(m[1]) ?? 0, Number(m[2])));
      }
    }
    const itemSku = (r: Row) => {
      const typed = (r.item_sku ?? "").trim().toUpperCase();
      if (!trendz || typed) return typed;
      const key = `${(r.category ?? "").trim().toLowerCase()}|${(r.item_name ?? "").trim().toLowerCase()}`;
      const known = knownSku.get(key);
      if (known) return known;
      const prefix = categories.find((c) => c.name.toLowerCase() === (r.category ?? "").trim().toLowerCase())?.sku_prefix;
      if (!prefix) throw new Error(`The category "${r.category}" has no base SKU. Set it on the Categories page first.`);
      const next = (highest.get(prefix) ?? 0) + 1;
      highest.set(prefix, next);
      const sku = `${prefix}-${String(next).padStart(3, "0")}`;
      knownSku.set(key, sku);
      return sku;
    };
    for (const r of rows ?? []) {
      const sku = itemSku(r);
      if (!sku || !r.item_name?.trim() || !r.category?.trim()) throw new Error(trendz ? "Every row needs category and item_name." : "Every row needs category, item_name and item_sku.");
      const item = bySku.get(sku) ?? { category: r.category.trim(), name: r.item_name.trim(), sku, replacement_value: r.replacement_value, variations: [] };
      const parts = trendz ? fieldCols.map((k) => (r[k] ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")).filter(Boolean).join("-") : "";
      const vSku = (r.variation_sku || `${sku}-${parts || item.variations.length + 1}`).trim().toUpperCase();
      if (trendz && !(SKU_PATTERN.test(sku) && SKU_PATTERN.test(vSku))) {
        throw new Error(`SKU ${SKU_PATTERN.test(sku) ? vSku : sku} is not allowed: 2 to 6 capital letters, a hyphen, then 3 or 4 digits (e.g. BR-001), with more parts after hyphens for variations (e.g. BR-001-GOLD).`);
      }
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
          {trendz ? <li>Leave <span className="font-mono">item_sku</span> and <span className="font-mono">variation_sku</span> empty: they are numbered for you from the category&apos;s base SKU (BR-001, BR-002...).</li> : null}
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
