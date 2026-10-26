"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, QrCode, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { BASIS_LABELS, errorText, num, rupees } from "@/lib/shop/format";
import { headlinePrice, useCatalog, variationLabel } from "@/lib/shop/useCatalog";
import type { AddOn, AddOnBasis, Category, Product, Unit } from "@/lib/shop/types";
import {
  Empty, Field, Modal, PageHeader, Panel, StatusBadge, ghostButtonClass, goldButtonClass, inputClass, monoInputClass, tableWrap, theadClass,
} from "@/components/shop/ui";

type Tab = "items" | "extras" | "categories";

export default function CatalogPage() {
  return <Suspense fallback={null}><Catalog /></Suspense>;
}

function Catalog() {
  const { canManage, word, feature, templates, trendz } = useShop();
  // ?tab=categories: the sidebar's Categories item
  const asked = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(asked === "categories" || asked === "extras" ? asked : "items");
  useEffect(() => { setTab(asked === "categories" || asked === "extras" ? asked : "items"); }, [asked]);
  return (
    <>
      <PageHeader title={trendz ? (tab === "categories" ? "Categories" : "All Products") : word("items", "Catalog")}
        actions={canManage ? <>
          <Link href="/print/tags" className={ghostButtonClass}><QrCode className="h-4 w-4" /> Print tags</Link>
          <Link href="/catalog/import" className={ghostButtonClass}><Upload className="h-4 w-4" /> Import</Link>
          {feature("sets") && templates.some((t) => t.kind === "wearable") ? (
            <Link href="/catalog/new?set=1" className={ghostButtonClass}><Plus className="h-4 w-4" /> New set</Link>
          ) : null}
          <Link href="/catalog/new" className={goldButtonClass}><Plus className="h-4 w-4" /> Add {word("item").toLowerCase()}</Link>
        </> : null} />
      <div className="mb-4 flex gap-1.5" role="tablist">
        {([["items", word("items")], ["extras", "Extras"], ["categories", "Categories"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("rounded-full border px-3 py-1 text-xs", tab === k ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}>
            {label}
          </button>
        ))}
      </div>
      {tab === "items" ? <Items /> : tab === "extras" ? <Extras /> : <Categories />}
    </>
  );
}

function Items() {
  const { categories, branches, templateOf, word, trendz } = useShop();
  const { products } = useCatalog({ includeInactive: true });
  const [units, setUnits] = useState<Pick<Unit, "variation_id" | "branch_id" | "status">[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const all: Pick<Unit, "variation_id" | "branch_id" | "status">[] = [];
      for (let from = 0; ; from += 1000) {
        // paging needs a fixed order, or rows can repeat or go missing between pages
        const { data, error } = await supabase.from("units").select("variation_id, branch_id, status").order("id").range(from, from + 999);
        if (error) { toast.error(errorText(error)); break; }
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      setUnits(all);
    })();
  }, []);

  const count = useMemo(() => {
    const m = new Map<string, { total: number; out: number }>();
    for (const u of units) {
      if (u.status === "retired") continue;
      const x = m.get(u.variation_id) ?? { total: 0, out: 0 };
      x.total += 1;
      if (u.status !== "available") x.out += 1;
      m.set(u.variation_id, x);
    }
    return m;
  }, [units]);

  const term = q.trim().toLowerCase();
  const list = (products ?? []).filter((p) => (showInactive || p.is_active) && (!cat || p.category_id === cat)
    && (!term || `${p.name} ${p.sku} ${(p.product_variations ?? []).map((v) => `${v.name} ${v.sku}`).join(" ")}`.toLowerCase().includes(term)));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={inputClass + " pl-9"} placeholder="Name or SKU" aria-label="Search the catalog" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {categories.length > 1 ? (
          <select className={cn(inputClass, "w-auto")} aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : null}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show switched-off
        </label>
      </div>
      {trendz ? <ProductTable list={list} units={units} loading={products === null} /> : (
      <div className={tableWrap}>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className={theadClass}>
            <tr><th className="px-4 py-3">{word("item")}</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Price</th>
              <th className="px-4 py-3 text-right">{word("units")}</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {products === null ? <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
              : list.length === 0 ? <tr><td colSpan={4}><Empty>Nothing here yet.</Empty></td></tr>
              : list.flatMap((p) => (p.product_variations ?? []).filter((v) => showInactive || v.is_enabled).map((v, i) => {
                const price = headlinePrice(v);
                const c = count.get(v.id);
                return (
                  <tr key={v.id} className="hover:bg-black/[0.02]">
                    <td className="px-4 py-2.5">
                      <Link href={`/catalog/${p.id}`} className="flex items-center gap-3">
                        {i === 0 && p.image_url ? <img src={p.image_url} alt="" className="h-9 w-9 rounded object-cover" /> : <span className="w-9" />}
                        <span>
                          <span className="font-medium text-foreground hover:text-gold">{variationLabel(p, v)}</span>
                          <span className="block font-mono text-xs text-muted-foreground">{v.sku}</span>
                        </span>
                        {!p.is_active || !v.is_enabled ? <StatusBadge>Off</StatusBadge> : null}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{categories.find((x) => x.id === p.category_id)?.name ?? templateOf(p.category_id)?.name}</td>
                    <td className="px-4 py-2.5">{price ? `${rupees(price.amount)} / ${price.unit}` : <span className="text-rust">No price</span>}</td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {p.is_set ? <StatusBadge tone="indigo">Set</StatusBadge> : null}
                      {p.is_set ? null : c ? c.total : 0}{c?.out ? <span className="ml-1 text-xs text-rust">({c.out} not available)</span> : null}
                    </td>
                  </tr>
                );
              }))}
          </tbody>
        </table>
      </div>
      )}
      {branches.length > 1 && !trendz ? <p className="mt-2 text-xs text-muted-foreground">Counts cover all branches; open an item to see each branch.</p> : null}
    </>
  );
}

// All Products, as in TRENDZ: one row per product with its variations, rate, stock and branches
function ProductTable({ list, units, loading }: { list: Product[]; units: Pick<Unit, "variation_id" | "branch_id" | "status">[]; loading: boolean }) {
  const { categories, activeBranches, canManage } = useShop();
  const byVariation = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const u of units) {
      if (u.status === "retired") continue;
      const b = m.get(u.variation_id) ?? new Map<string, number>();
      b.set(u.branch_id, (b.get(u.branch_id) ?? 0) + 1);
      m.set(u.variation_id, b);
    }
    return m;
  }, [units]);
  const perBranch = (p: Product, branchId: string) => (p.product_variations ?? []).reduce((s, v) => s + (byVariation.get(v.id)?.get(branchId) ?? 0), 0);

  return (
    <div className={tableWrap}>
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className={theadClass}>
          <tr>
            <th className="w-14 px-4 py-3" /><th className="px-4 py-3">Name</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Variations</th>
            <th className="px-4 py-3">Daily rate</th><th className="px-4 py-3 text-right">Total stock</th><th className="px-4 py-3">Branches</th>
            <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {loading ? <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
            : list.length === 0 ? <tr><td colSpan={9}><Empty>No products yet. Add one with Add New Product.</Empty></td></tr>
            : list.map((p) => {
              const vars = (p.product_variations ?? []).filter((v) => v.is_enabled);
              const rates = vars.map((v) => headlinePrice(v)?.amount).filter((x): x is number => x !== undefined);
              const total = activeBranches.reduce((s, b) => s + perBranch(p, b.id), 0);
              return (
                <tr key={p.id} className="hover:bg-black/[0.02]">
                  <td className="px-4 py-2">{p.image_url ? <img src={p.image_url} alt="" className="h-10 w-10 rounded object-cover" /> : null}</td>
                  <td className="px-4 py-2">
                    <Link href={`/catalog/${p.id}`} className="font-medium hover:text-gold">{p.name}</Link>
                    <span className="block font-mono text-xs text-muted-foreground">{p.sku}</span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{categories.find((c) => c.id === p.category_id)?.name}</td>
                  <td className="px-4 py-2">{p.is_set ? <StatusBadge tone="indigo">Set</StatusBadge> : vars.length}</td>
                  <td className="px-4 py-2 font-mono text-gold">{rates.length ? (Math.min(...rates) === Math.max(...rates) ? rupees(rates[0]) : `${rupees(Math.min(...rates))} – ${rupees(Math.max(...rates))}`) : <span className="text-rust">No price</span>}</td>
                  <td className="px-4 py-2 text-right font-mono">{p.is_set ? "—" : total}</td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap gap-1">
                      {activeBranches.map((b) => <span key={b.id} className="rounded-md border border-border px-1.5 py-0.5 text-[10px]">{b.name} {perBranch(p, b.id)}</span>)}
                    </span>
                  </td>
                  <td className="px-4 py-2"><StatusBadge tone={p.is_active ? "emerald" : "rust"}>{p.is_active ? "Active" : "Inactive"}</StatusBadge></td>
                  <td className="px-4 py-2 text-right"><Link href={`/catalog/${p.id}`} className={ghostButtonClass}>{canManage ? "Edit" : "View"}</Link></td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

function Extras() {
  const { shop, addOns, templates, canManage, refresh } = useShop();
  const [edit, setEdit] = useState<(Partial<AddOn> & { amountText: string }) | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!edit) return;
    if (!edit.name?.trim()) return toast.error("Name the extra.");
    setBusy(true);
    const row = { name: edit.name.trim(), basis: edit.basis ?? "per_rental", amount: num(edit.amountText), template_keys: edit.template_keys ?? [], is_active: edit.is_active ?? true };
    const supabase = createClient();
    const { error } = edit.id ? await supabase.from("add_ons").update(row).eq("id", edit.id) : await supabase.from("add_ons").insert({ ...row, shop_id: shop.id });
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? "An extra with this name exists." : errorText(error));
    toast.success("Saved");
    setEdit(null);
    await refresh();
  };

  return (
    <Panel title="Extras offered with a booking" actions={canManage ? (
      <button className={ghostButtonClass} onClick={() => setEdit({ basis: "per_rental", amountText: "", template_keys: [], is_active: true })}><Plus className="h-4 w-4" /> Add extra</button>
    ) : null}>
      {addOns.length === 0 ? <Empty>No extras yet.</Empty> : (
        <ul className="divide-y divide-border">
          {addOns.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div>
                <span className="font-medium">{a.name}</span> {!a.is_active ? <StatusBadge>Off</StatusBadge> : null}
                <p className="text-xs text-muted-foreground">{rupees(a.amount)} {BASIS_LABELS[a.basis]}
                  {a.template_keys.length ? ` · ${a.template_keys.map((k) => templates.find((t) => t.key === k)?.name ?? k).join(", ")}` : " · all types"}</p>
              </div>
              {canManage ? <button className={ghostButtonClass} onClick={() => setEdit({ ...a, amountText: String(a.amount) })}>Edit</button> : null}
            </li>
          ))}
        </ul>
      )}
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? "Edit extra" : "New extra"}
        footer={<><button className={ghostButtonClass} onClick={() => setEdit(null)}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button></>}>
        {edit ? <>
          <Field label="Name"><input className={inputClass} value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (₹)"><input className={monoInputClass} inputMode="decimal" value={edit.amountText} onChange={(e) => setEdit({ ...edit, amountText: e.target.value })} /></Field>
            <Field label="Charged">
              <select className={inputClass} value={edit.basis} onChange={(e) => setEdit({ ...edit, basis: e.target.value as AddOnBasis })}>
                {Object.entries(BASIS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          {templates.length > 1 ? (
            <Field label="Offered for">
              <div className="flex flex-wrap gap-3 text-sm">
                {templates.map((t) => (
                  <label key={t.key} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={edit.template_keys?.includes(t.key) ?? false}
                      onChange={(e) => setEdit({ ...edit, template_keys: e.target.checked ? [...(edit.template_keys ?? []), t.key] : (edit.template_keys ?? []).filter((k) => k !== t.key) })} />
                    {t.name}
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Offered now</label>
        </> : null}
      </Modal>
    </Panel>
  );
}

function Categories() {
  const { shop, categories, templates, canManage, refresh } = useShop();
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!edit?.name?.trim() || !edit.template_key) return toast.error("Name the category and choose its type.");
    const prefix = (edit.sku_prefix ?? "").trim().toUpperCase();
    if (prefix && !/^[A-Z]{2,6}$/.test(prefix)) return toast.error("The SKU prefix needs 2 to 6 capital letters.");
    setBusy(true);
    const row = { name: edit.name.trim(), template_key: edit.template_key, sku_prefix: prefix || null };
    const supabase = createClient();
    const { error } = edit.id ? await supabase.from("categories").update(row).eq("id", edit.id) : await supabase.from("categories").insert({ ...row, shop_id: shop.id });
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? "A category with this name exists." : errorText(error));
    toast.success("Saved");
    setEdit(null);
    await refresh();
  };

  return (
    <Panel title="Categories" actions={canManage ? <button className={ghostButtonClass} onClick={() => setEdit({ template_key: templates[0]?.key })}><Plus className="h-4 w-4" /> Add category</button> : null}>
      <ul className="divide-y divide-border">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span><span className="font-medium">{c.name}</span> <span className="text-xs text-muted-foreground">· {templates.find((t) => t.key === c.template_key)?.name}{c.sku_prefix ? ` · SKUs start ${c.sku_prefix}-` : ""}</span></span>
            {canManage ? <button className={ghostButtonClass} onClick={() => setEdit(c)}>Edit</button> : null}
          </li>
        ))}
      </ul>
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? "Edit category" : "New category"}
        description="The type decides how items in it are priced and handed over."
        footer={<><button className={ghostButtonClass} onClick={() => setEdit(null)}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button></>}>
        {edit ? <>
          <Field label="Name"><input className={inputClass} value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Type" hint={edit.id ? "Fixed once items exist in it" : undefined}>
            <select className={inputClass} value={edit.template_key} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, template_key: e.target.value })}>
              {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="SKU prefix (optional)" hint="2 to 6 capital letters, e.g. LEH">
            <input className={monoInputClass} maxLength={6} value={edit.sku_prefix ?? ""} onChange={(e) => setEdit({ ...edit, sku_prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} />
          </Field>
        </> : null}
      </Modal>
    </Panel>
  );
}
