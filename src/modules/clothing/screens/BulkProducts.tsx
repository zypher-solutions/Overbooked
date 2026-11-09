"use client";

import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ClipboardPaste, Copy, Download, FileSpreadsheet, ListPlus, PencilLine, Plus, Search, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { createClient } from "@/lib/supabase/client";
import { errorText, plural } from "@/lib/shop/format";
import { useCatalog } from "@/lib/shop/useCatalog";
import type { Product } from "@/lib/shop/types";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { Field, Modal, PageHeader, Panel, StatusBadge, ghostButtonClass, goldButtonClass, inputClass, monoInputClass, tableWrap, theadClass } from "@/components/shop/ui";
import { MONEY_KEYS, cleanMoney, missingCategories, parseTsv, planRows, rowsFromTable, rowsOfProducts, type BulkRow, type Col, type UnitLite } from "../bulk";
import { downloadTemplate, exportProducts, readSheet } from "../sheet";
import { useBulkSetup } from "../useBulkSetup";

// Bulk add & edit: a table like a spreadsheet for adding many products, or changing many at once.
// Rows come from typing, pasting from Excel (Ctrl+V), an Excel or CSV file, or products loaded from the catalog.
// One row is one colour/size of a product. Nothing is saved until "Save all"; the table is kept on this device until then.
export default function BulkProductsPage() {
  return <Suspense fallback={null}><BulkProducts /></Suspense>;
}

const newUid = () => crypto.randomUUID();
const isBlank = (r: BulkRow) => Object.values(r.cells).every((v) => !v.trim());
const cellClass = "w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-border focus:border-neon focus:bg-white focus:ring-2 focus:ring-ring";
const widthOf = (c: Col) => (c.key === "name" ? 200 : c.key === "category" ? 160 : c.key === "sku" ? 130 : c.kind === "attr" ? 110 : c.kind === "pieces" ? 96 : 110);

function BulkProducts() {
  const { shop, categories, templates, attributes, canManage, activeBranches, refresh } = useShop();
  const { cols, loadUnits } = useBulkSetup();
  const { products, reload } = useCatalog({ includeInactive: true });
  const [units, setUnits] = useState<UnitLite[] | null>(null);
  const [rows, setRows] = useState<BulkRow[]>([]);
  // how a loaded row looked, to tell an edited one from an untouched one
  const [orig, setOrig] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [askClear, setAskClear] = useState(false);
  // categories in the rows the shop does not have: asked after a paste or file, and on Save all (then saving goes on)
  const [askCats, setAskCats] = useState<"rows" | "save" | null>(null);
  const [saveNext, setSaveNext] = useState(false);
  const [filter, setFilter] = useState("");
  const [lastSave, setLastSave] = useState<{ added: number; updated: number; failed: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftKey = `ob_bulk_${shop.id}`;
  const restored = useRef(false);

  const refreshUnits = useCallback(async () => {
    try { setUnits(await loadUnits()); } catch (e) { toast.error("Could not load the pieces: " + errorText(e)); setUnits([]); }
  }, [loadUnits]);
  useEffect(() => { void refreshUnits(); }, [refreshUnits]);

  // an unsaved table comes back after a reload or a visit to another page
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = localStorage.getItem(draftKey);
      if (!saved) return;
      const d = JSON.parse(saved) as { rows: BulkRow[]; orig: Record<string, string> };
      if (d.rows?.length) { setRows(d.rows); setOrig(d.orig ?? {}); toast.message(`Your unsaved table was restored (${plural(d.rows.length, "row")}).`); }
    } catch { /* storage unavailable */ }
  }, [draftKey]);
  useEffect(() => {
    if (!restored.current) return;
    try { if (rows.length) localStorage.setItem(draftKey, JSON.stringify({ rows, orig })); else localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }, [rows, orig, draftKey]);

  const changed = useCallback((r: BulkRow) => !r.origin || JSON.stringify(r.cells) !== orig[r.uid], [orig]);
  const toSave = useMemo(() => rows.filter((r) => !isBlank(r) && changed(r)), [rows, changed]);
  const ready = products !== null && units !== null;
  const plan = useMemo(() => (ready ? planRows(toSave, { cols, categories, products: products!, units: units!, branches: activeBranches.map((b) => ({ id: b.id, name: b.name })), attributes }) : null),
    [ready, toSave, cols, categories, products, units, activeBranches, attributes]);
  const newCats = useMemo(() => missingCategories(toSave, categories), [toSave, categories]);
  const problems = (uid: string) => [...(checked ? plan?.errors[uid] ?? [] : []), ...(serverErrors[uid] ? [serverErrors[uid]] : [])];
  const problemCount = rows.filter((r) => problems(r.uid).length).length;
  const counts = { added: rows.filter((r) => !r.origin && !isBlank(r)).length, edited: rows.filter((r) => r.origin && changed(r)).length };

  // leaving the page with unsaved rows asks first
  useEffect(() => {
    if (!toSave.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [toSave.length]);

  const addRows = (n: number) => setRows((rs) => [...rs, ...Array.from({ length: n }, () => ({ uid: newUid(), cells: {} }))]);
  const setCell = useCallback((uid: string, key: string, value: string) => {
    setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, cells: { ...r.cells, [key]: value } } : r)));
    setServerErrors((s) => (s[uid] ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== uid)) : s));
  }, []);
  const copyRow = useCallback((uid: string) => setRows((rs) => {
    const i = rs.findIndex((r) => r.uid === uid);
    // a copy is a new colour/size of the same product: same product, without the pieces
    const cells = Object.fromEntries(Object.entries(rs[i].cells).filter(([k]) => !k.startsWith("pieces:")));
    return [...rs.slice(0, i + 1), { uid: newUid(), cells }, ...rs.slice(i + 1)];
  }), []);
  const removeRow = useCallback((uid: string) => setRows((rs) => rs.filter((r) => r.uid !== uid)), []);

  // rows of a table (pasted, or from a file): with headers they are added at the end; without, they fill the grid from the cell
  const putTable = useCallback((table: string[][], at?: { uid: string; key: string }) => {
    const { rows: got, unknownHeaders, headed } = rowsFromTable(table, cols, at?.key);
    if (!got.length) return 0;
    setRows((rs) => {
      const start = at && !headed ? rs.findIndex((r) => r.uid === at.uid) : -1;
      if (start < 0) return [...rs.filter((r) => !isBlank(r)), ...got.map((cells) => ({ uid: newUid(), cells }))];
      const next = [...rs];
      got.forEach((cells, i) => {
        const r = next[start + i];
        if (r) next[start + i] = { ...r, cells: { ...r.cells, ...cells } };
        else next.push({ uid: newUid(), cells });
      });
      return next;
    });
    setChecked(true);
    setAskCats("rows");
    if (unknownHeaders.length) toast.warning(`Columns left out (not known here): ${unknownHeaders.join(", ")}`);
    return got.length;
  }, [cols]);

  // Ctrl+V anywhere on the page: Excel copies cells as text with tabs
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text.includes("\t") && !text.trim().includes("\n")) return; // one value: the normal paste into the box
      const target = e.target as HTMLElement | null;
      const cell = target?.closest<HTMLElement>("[data-cell]");
      if (!cell && target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return; // another box (search, a dialog)
      e.preventDefault();
      const n = putTable(parseTsv(text), cell ? { uid: cell.dataset.row!, key: cell.dataset.cell! } : undefined);
      if (n) toast.success(`Pasted ${plural(n, "row")}`);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [putTable]);

  const openFile = async (file: File) => {
    try {
      const n = putTable(await readSheet(file));
      toast[n ? "success" : "error"](n ? `Opened ${file.name}: ${plural(n, "row")}` : `${file.name} has no rows we could read.`);
    } catch (e) {
      toast.error("Could not read the file: " + errorText(e));
    }
  };

  const loadProducts = useCallback((ids: string[]) => {
    if (!products || !units) return;
    const present = new Set(rows.map((r) => r.origin?.variationId).filter(Boolean));
    const fresh = rowsOfProducts(products.filter((p) => ids.includes(p.id)), { cols, categories, units }, newUid).filter((r) => !present.has(r.origin!.variationId));
    setRows((rs) => [...rs.filter((r) => !isBlank(r)), ...fresh]);
    setOrig((o) => ({ ...o, ...Object.fromEntries(fresh.map((r) => [r.uid, JSON.stringify(r.cells)])) }));
    toast.success(fresh.length ? `Loaded ${plural(fresh.length, "row")} to edit` : "Those products are already in the table.");
  }, [products, units, rows, cols, categories]);

  // ?load=<product ids>: "Edit in bulk" from the product list
  const askedLoad = useSearchParams().get("load");
  const didLoad = useRef(false);
  useEffect(() => {
    if (!askedLoad || didLoad.current || !ready || !restored.current) return;
    didLoad.current = true;
    loadProducts(askedLoad.split(","));
  }, [askedLoad, ready, loadProducts]);

  const saveAll = async () => {
    setChecked(true);
    if (!plan) return toast.error("Still loading the products. Try again in a moment.");
    if (!toSave.length) return toast.message("Nothing to save yet: there are no new or changed rows.");
    if (newCats.length) { setAskCats("save"); return; }
    if (!plan.items.length) return toast.error("Fix the rows marked in red first.");
    const failed: Record<string, string> = {};
    const savedUids = new Set<string>();
    let added = 0; let updated = 0;
    // one product at a time, so a mistake in one never stops the others
    for (const [i, it] of plan.items.entries()) {
      setBusy(`Saving ${i + 1} of ${plan.items.length}...`);
      try {
        await call("import_catalog", { p: { items: [it.item] } });
        it.uids.forEach((u) => savedUids.add(u));
        if (it.isNew) added++; else updated++;
      } catch (e) {
        for (const u of it.uids) failed[u] = errorText(e);
      }
    }
    setBusy(null);
    setServerErrors(failed);
    // saved rows leave the table, with the untouched rows of the same products (their product-wide figures, like the
    // deposit, may have just changed); load them again to see the saved values
    const savedSkus = new Set(plan.items.filter((it) => it.uids.some((u) => savedUids.has(u))).map((it) => it.sku));
    const skuOf = new Map((products ?? []).map((p) => [p.id, p.sku]));
    setRows((rs) => rs.filter((r) => !savedUids.has(r.uid) && !(r.origin && !changed(r) && savedSkus.has(skuOf.get(r.origin.productId) ?? ""))));
    const failedProducts = plan.items.length - added - updated;
    setLastSave({ added, updated, failed: failedProducts });
    if (added + updated) toast.success(`Saved: ${added} new, ${updated} updated`);
    if (failedProducts) toast.error(`${plural(failedProducts, "product")} could not be saved. See the rows marked in red.`);
    else if (Object.keys(plan.errors).length) toast.warning("The rows marked in red were not saved. Fix them and press Save all again.");
    else setChecked(false);
    await Promise.all([reload(), refreshUnits()]);
  };

  // adds the missing categories (as clothing categories with their base SKUs); a name added meanwhile is left as it is
  const addCategories = async () => {
    const then = askCats;
    setAskCats(null);
    const template_key = templates.find((t) => t.kind === "wearable")?.key;
    if (!template_key) return toast.error("This shop has no clothing business type to add categories to.");
    const supabase = createClient();
    let added = 0;
    for (const c of newCats) {
      const { error } = await supabase.from("categories").insert({ shop_id: shop.id, name: c.name, template_key, sku_prefix: c.sku_prefix });
      if (!error) added++;
      else if (error.code !== "23505") return toast.error(`Could not add ${c.name}: ${errorText(error)}`);
    }
    await refresh();
    toast.success(`Added ${added} ${added === 1 ? "category" : "categories"}`);
    if (then === "save") setSaveNext(true);
  };
  // after the categories are added on Save all, saving goes on once the table sees them
  useEffect(() => {
    if (!saveNext || newCats.length) return;
    setSaveNext(false);
    void saveAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveNext, newCats.length]);

  const exportAll = async () => {
    if (!products || !units) return;
    try { const n = await exportProducts(products, { cols, categories, units }); toast.success(`Exported ${plural(n, "row")}`); } catch (e) { toast.error(errorText(e)); }
  };
  const template = () => {
    const cat = categories[0];
    const example: Record<string, string> = { category: cat?.name ?? "", name: "Example lehenga", rate: "2500", deposit: "1000", mrp: "25000", purchase: "18000" };
    for (const c of cols) {
      if (c.kind === "attr") example[c.key] = attributes.find((f) => f.key === c.key.slice(5))?.shop_attribute_values[0]?.value ?? "";
      if (c.kind === "pieces") example[c.key] = c === cols.find((x) => x.kind === "pieces") ? "2" : "";
    }
    void downloadTemplate(cols, example);
  };

  const suggestions = useMemo(() => Object.fromEntries(cols.filter((c) => c.kind === "attr").map((c) => [c.key,
    attributes.find((f) => f.key === c.key.slice(5))?.shop_attribute_values.map((v) => v.value) ?? []])), [cols, attributes]);
  const term = filter.trim().toLowerCase();
  const shown = term ? rows.filter((r) => Object.values(r.cells).join(" ").toLowerCase().includes(term)) : rows;

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Only owners and managers can add or change products.</p></Panel>;
  return (
    <>
      <PageHeader title="Bulk add & edit"
        subtitle="Add many products, or change many at once, in a table like Excel. One row is one colour and size of a product."
        actions={<>
          <button className={ghostButtonClass} onClick={template}><Download className="h-4 w-4" /> Excel template</button>
          <button className={ghostButtonClass} disabled={!ready} onClick={() => void exportAll()}><FileSpreadsheet className="h-4 w-4" /> Export all products</button>
        </>} />

      <input ref={fileRef} type="file" className="sr-only" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ""; }} />

      {rows.length === 0 ? (
        <Panel>
          <h2 className="text-base font-semibold">How do you want to start?</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StartCard icon={<ClipboardPaste className="h-5 w-5" />} title="Paste from Excel" text="Copy the cells in Excel or Google Sheets, then press Ctrl+V on this page. Include the header row and the columns are matched by name." />
            <StartCard icon={<FileSpreadsheet className="h-5 w-5" />} title="Open an Excel or CSV file" text="Use our Excel template, or your own sheet with similar headers." onClick={() => fileRef.current?.click()} />
            <StartCard icon={<PencilLine className="h-5 w-5" />} title="Edit products you have" text="Load products from your catalog to change prices, deposits or pieces for many at once." onClick={() => setLoadOpen(true)} disabled={!ready} />
            <StartCard icon={<ListPlus className="h-5 w-5" />} title="Type them in" text="Start with 10 empty rows. Category and name are enough to begin." onClick={() => addRows(10)} />
          </div>
          {lastSave ? <p className="mt-4 text-sm text-emerald">Last save: {lastSave.added} new and {lastSave.updated} updated {lastSave.added + lastSave.updated === 1 ? "product" : "products"}. <Link href="/catalog" className="underline">See them in All Products</Link>.</p> : null}
        </Panel>
      ) : (
        <>
          <div className="glass mb-3 flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button className={ghostButtonClass} onClick={() => addRows(10)}><Plus className="h-4 w-4" /> Add 10 rows</button>
              <button className={ghostButtonClass} disabled={!ready} onClick={() => setLoadOpen(true)}><PencilLine className="h-4 w-4" /> Load products to edit</button>
              <button className={ghostButtonClass} onClick={() => fileRef.current?.click()}><FileSpreadsheet className="h-4 w-4" /> Open file</button>
              <button className={ghostButtonClass} onClick={() => setFillOpen(true)}><Wand2 className="h-4 w-4" /> Fill a column</button>
              <button className={cn(ghostButtonClass, "text-rust")} onClick={() => setAskClear(true)}><Trash2 className="h-4 w-4" /> Clear table</button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {counts.added ? `${counts.added} new` : ""}{counts.added && counts.edited ? " · " : ""}{counts.edited ? `${counts.edited} edited` : ""}
                {!counts.added && !counts.edited ? "No changes yet" : ""}
                {problemCount ? <span className="text-rust"> · {plural(problemCount, "row")} to fix</span> : null}
              </span>
              <button className={goldButtonClass} disabled={!!busy || !toSave.length} onClick={() => void saveAll()}>{busy ?? `Save all (${toSave.length})`}</button>
            </div>
          </div>

          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Tip: copy cells in Excel and press Ctrl+V in a cell here. Leave SKU blank to have it numbered for you. Rows with the same SKU, or the same category and name, become one product.</p>
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input className={cn(inputClass, "pl-9")} placeholder="Find in the table" aria-label="Find in the table" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </div>

          <datalist id="bulk-categories">{categories.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          {Object.entries(suggestions).map(([k, list]) => <datalist key={k} id={`bulk-${k}`}>{list.map((v) => <option key={v} value={v} />)}</datalist>)}

          <div className={cn(tableWrap, "max-h-[68dvh] overflow-auto")}>
            <table className="w-max min-w-full text-left text-xs">
              <thead className={cn(theadClass, "sticky top-0 z-10")}>
                <tr>
                  <th className="px-2 py-2.5" style={{ minWidth: 92 }}>Row</th>
                  {cols.map((c) => (
                    <th key={c.key} className="px-2 py-2.5" style={{ minWidth: widthOf(c) }}>
                      {c.label}{c.required ? <span className="text-rust"> *</span> : null}
                    </th>
                  ))}
                  <th className="px-2 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((r) => (
                  <GridRow key={r.uid} row={r} index={rows.indexOf(r)} cols={cols} problems={problems(r.uid)} note={plan?.notes[r.uid]}
                    state={!r.origin ? (isBlank(r) ? "empty" : "new") : changed(r) ? "edited" : "loaded"}
                    onCell={setCell} onCopy={copyRow} onRemove={removeRow} />
                ))}
              </tbody>
            </table>
          </div>
          {term && !shown.length ? <p className="mt-2 text-sm text-muted-foreground">No rows match &ldquo;{filter}&rdquo;.</p> : null}
          <button className={cn(ghostButtonClass, "mt-3")} onClick={() => addRows(10)}><Plus className="h-4 w-4" /> Add 10 more rows</button>
          {activeBranches.length > 1 ? <p className="mt-2 text-xs text-muted-foreground">Pieces: how many each branch should hold. New pieces get codes for their QR tags; to remove pieces, retire them on the product&apos;s Pieces tab.</p> : null}
        </>
      )}

      <LoadProducts open={loadOpen} onClose={() => setLoadOpen(false)} onLoad={(ids) => { loadProducts(ids); setLoadOpen(false); }}
        products={products ?? []} loaded={new Set(rows.map((r) => r.origin?.productId).filter((x): x is string => !!x))} />
      <FillColumn open={fillOpen} cols={cols} onClose={() => setFillOpen(false)} onApply={(key, fn) => {
        setRows((rs) => rs.map((r) => (isBlank(r) ? r : { ...r, cells: { ...r.cells, [key]: fn(r.cells[key] ?? "") } })));
        setFillOpen(false);
      }} />
      <ConfirmDialog open={askCats !== null && newCats.length > 0} title="New categories" confirmLabel={`Add ${newCats.length === 1 ? "it" : "them"}`} cancelLabel="Not now"
        message={[
          `${newCats.length === 1 ? "This category is" : "These categories are"} not in the system yet:`,
          ...newCats.map((c) => `${c.name} (base SKU ${c.sku_prefix})`),
          "",
          `Add ${newCats.length === 1 ? "it" : "them"} to your categories?${askCats === "save" ? " The products are saved right after." : ""} You can change a base SKU later on the Categories page.`,
        ].join("\n")}
        onCancel={() => setAskCats(null)} onConfirm={() => void addCategories()} />
      <ConfirmDialog open={askClear} tone="danger" title="Clear the table?" confirmLabel="Clear" cancelLabel="Keep it"
        message="Rows that are not saved are lost. Products already saved stay in your catalog."
        onCancel={() => setAskClear(false)} onConfirm={() => { setRows([]); setOrig({}); setServerErrors({}); setChecked(false); setAskClear(false); }} />
    </>
  );
}

function StartCard({ icon, title, text, onClick, disabled }: { icon: React.ReactNode; title: string; text: string; onClick?: () => void; disabled?: boolean }) {
  const body = <>
    <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-gold/10 text-gold">{icon}</span>
    <span className="block text-sm font-semibold text-foreground">{title}</span>
    <span className="mt-1 block text-xs text-muted-foreground">{text}</span>
  </>;
  return onClick ? (
    <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl border border-border bg-white p-4 text-left transition-colors hover:border-gold/40 hover:bg-accent disabled:opacity-60">{body}</button>
  ) : <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">{body}</div>;
}

const GridRow = memo(function GridRow({ row, index, cols, problems, note, state, onCell, onCopy, onRemove }: {
  row: BulkRow; index: number; cols: Col[]; problems: string[]; note?: string; state: "empty" | "new" | "edited" | "loaded";
  onCell: (uid: string, key: string, value: string) => void; onCopy: (uid: string) => void; onRemove: (uid: string) => void;
}) {
  const bad = problems.length > 0;
  return (
    <>
      <tr className={cn("align-top", bad ? "bg-rust/[0.04]" : "hover:bg-black/[0.015]")}>
        <td className={cn("px-2 py-1.5", bad && "border-l-2 border-rust")}>
          <span className="flex items-center gap-1.5">
            <span className="tabular-nums text-muted-foreground">{index + 1}</span>
            {state === "new" ? <StatusBadge tone="emerald">New</StatusBadge> : state === "edited" ? <StatusBadge tone="accent">Edited</StatusBadge> : state === "loaded" ? <StatusBadge tone="muted">Saved</StatusBadge> : null}
          </span>
          {note && state !== "loaded" && state !== "empty" ? <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{note}</span> : null}
        </td>
        {cols.map((c) => (
          <td key={c.key} className="px-0.5 py-0.5" data-cell={c.key} data-row={row.uid}>
            <input className={c.kind === "money" || c.kind === "pieces" ? cn(cellClass, "text-right tabular-nums") : c.key === "sku" ? cn(cellClass, "font-mono uppercase") : cellClass}
              aria-label={`Row ${index + 1}: ${c.label}`} value={row.cells[c.key] ?? ""}
              list={c.key === "category" ? "bulk-categories" : c.kind === "attr" ? `bulk-${c.key}` : undefined}
              inputMode={c.kind === "money" ? "decimal" : c.kind === "pieces" ? "numeric" : undefined}
              placeholder={c.key === "sku" ? "Auto" : c.kind === "pieces" ? "0" : undefined}
              onChange={(e) => onCell(row.uid, c.key, e.target.value)}
              onBlur={(e) => { if ((c.kind === "money" || c.kind === "pieces") && e.target.value !== cleanMoney(e.target.value)) onCell(row.uid, c.key, cleanMoney(e.target.value)); }} />
          </td>
        ))}
        <td className="whitespace-nowrap px-1 py-1">
          <button type="button" title="Copy row (another colour or size)" aria-label={`Copy row ${index + 1}`} className="rounded p-1.5 text-muted-foreground hover:bg-black/5 hover:text-foreground" onClick={() => onCopy(row.uid)}><Copy className="h-3.5 w-3.5" /></button>
          <button type="button" title="Remove row from the table" aria-label={`Remove row ${index + 1}`} className="rounded p-1.5 text-muted-foreground hover:bg-rust/10 hover:text-rust" onClick={() => onRemove(row.uid)}><Trash2 className="h-3.5 w-3.5" /></button>
        </td>
      </tr>
      {bad ? (
        <tr className="bg-rust/[0.04]">
          <td colSpan={cols.length + 2} className="border-l-2 border-rust px-3 pb-2 pt-0">
            <ul className="space-y-0.5 text-xs text-rust">
              {problems.map((p) => <li key={p} className="flex items-start gap-1.5"><AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />{p}</li>)}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
});

function LoadProducts({ open, onClose, onLoad, products, loaded }: {
  open: boolean; onClose: () => void; onLoad: (ids: string[]) => void; products: Product[]; loaded: Set<string>;
}) {
  const { categories } = useShop();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const term = q.trim().toLowerCase();
  const list = products.filter((p) => !p.is_set && (!cat || p.category_id === cat) && (!term || `${p.name} ${p.sku}`.toLowerCase().includes(term)));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = list.length > 0 && list.every((p) => picked.has(p.id));
  return (
    <Modal open={open} onClose={onClose} wide title="Load products to edit" description="Tick the products to change. Each colour and size becomes a row in the table."
      footer={<>
        <button className={ghostButtonClass} onClick={onClose}>Cancel</button>
        <button className={goldButtonClass} disabled={!picked.size} onClick={() => { onLoad(Array.from(picked)); setPicked(new Set()); }}>Load {plural(picked.size, "product")}</button>
      </>}>
      <div className="flex flex-wrap gap-2">
        <input className={cn(inputClass, "flex-1")} placeholder="Search by name or SKU" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
        {categories.length > 1 ? (
          <select className={cn(inputClass, "w-auto")} aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={allPicked} onChange={(e) => setPicked((s) => { const n = new Set(s); for (const p of list) { if (e.target.checked) n.add(p.id); else n.delete(p.id); } return n; })} />
        Select all {list.length} shown
      </label>
      <ul className="max-h-[45dvh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {list.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent/40">
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              {p.image_url ? <img src={p.image_url} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="h-8 w-8 rounded bg-muted/70" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block font-mono text-xs text-muted-foreground">{p.sku} · {categories.find((c) => c.id === p.category_id)?.name ?? "—"} · {plural((p.product_variations ?? []).filter((v) => v.is_enabled).length, "variation")}</span>
              </span>
              {loaded.has(p.id) ? <StatusBadge tone="muted">In the table</StatusBadge> : !p.is_active ? <StatusBadge tone="muted">Switched off</StatusBadge> : null}
            </label>
          </li>
        ))}
        {!list.length ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">No products match.</li> : null}
      </ul>
    </Modal>
  );
}

// one value for a whole column, or prices up or down by a percentage
function FillColumn({ open, cols, onClose, onApply }: { open: boolean; cols: Col[]; onClose: () => void; onApply: (key: string, fn: (v: string) => string) => void }) {
  const fillable = cols.filter((c) => c.key !== "sku" && c.key !== "name");
  const [key, setKey] = useState("rate");
  const [mode, setMode] = useState<"set" | "percent">("set");
  const [value, setValue] = useState("");
  const col = fillable.find((c) => c.key === key) ?? fillable[0];
  const money = (MONEY_KEYS as readonly string[]).includes(col?.key ?? "");
  const apply = () => {
    const v = value.trim();
    if (mode === "percent" && money) {
      const pct = Number(v.replace("%", ""));
      if (!v || Number.isNaN(pct) || pct <= -100 || pct > 1000) return toast.error("Type a percentage such as 10 or -15.");
      onApply(col.key, (old) => (old.trim() && !Number.isNaN(Number(old)) ? String(Math.round(Number(old) * (1 + pct / 100))) : old));
    } else onApply(col.key, () => (col.kind === "money" || col.kind === "pieces" ? cleanMoney(v) : v));
    setValue("");
  };
  return (
    <Modal open={open} onClose={onClose} title="Fill a column" description="Changes every row in the table. Nothing is saved until you press Save all."
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} onClick={apply}>Apply to every row</button></>}>
      <Field label="Column">
        <select className={inputClass} value={col?.key} onChange={(e) => { setKey(e.target.value); setMode("set"); }}>
          {fillable.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </Field>
      {money ? (
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "set"} onChange={() => setMode("set")} /> Set to an amount</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "percent"} onChange={() => setMode("percent")} /> Raise or lower by %</label>
        </div>
      ) : null}
      <Field label={mode === "percent" ? "Change (%)" : "Value"} hint={mode === "percent" ? "10 raises by 10%, -10 lowers by 10%. Rounded to whole rupees." : col?.key === "category" ? "Use a category name exactly as on the Categories page." : undefined}>
        <input className={money || col?.kind === "pieces" ? monoInputClass : inputClass} value={value} onChange={(e) => setValue(e.target.value)}
          list={col?.key === "category" ? "bulk-categories" : col?.kind === "attr" ? `bulk-${col.key}` : undefined} placeholder={mode === "percent" ? "10" : ""} />
      </Field>
    </Modal>
  );
}
