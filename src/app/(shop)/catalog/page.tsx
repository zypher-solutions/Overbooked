"use client";

import { businessNameError, moneyError } from "@/lib/validate";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Pencil, Plus, QrCode, Search, Sheet, Tag, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { ProductTable } from "@/modules/clothing/components/ProductTable";
import AllProducts from "@/modules/clothing/screens/AllRentals";
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
  const { canManage, word, feature, templates, businessModule } = useShop();
  const clothing = businessModule === "clothing";
  // ?tab=categories: the sidebar's Categories item
  const asked = useSearchParams().get("tab");
  const [adding, setAdding] = useState(0);
  const [tab, setTab] = useState<Tab>(asked === "categories" || asked === "extras" ? asked : "items");
  useEffect(() => { setTab(asked === "categories" || asked === "extras" ? asked : "items"); }, [asked]);
  return (
    <>
      <PageHeader title={clothing ? (tab === "categories" ? "Categories" : tab === "extras" ? "Accessories" : "All Products") : word("items", "Catalog")}
        subtitle={clothing && tab === "extras" ? "Safas, malas, chunnis and other pieces offered with an outfit. At booking they show unticked, for the customer to take or leave." : undefined}
        actions={!canManage || tab === "extras" ? null : tab === "categories" ? (
          <button className={goldButtonClass} onClick={() => setAdding((n) => n + 1)}><Plus className="h-4 w-4" /> Add Category</button>
        ) : <>
          {tab === "items" ? <Link href="/print/tags" className={ghostButtonClass}><QrCode className="h-4 w-4" /> Print tags</Link> : null}
          {clothing
            ? <Link href="/catalog/bulk" className={ghostButtonClass}><Sheet className="h-4 w-4" /> Bulk add & edit</Link>
            : <Link href="/catalog/import" className={ghostButtonClass}><Upload className="h-4 w-4" /> Import</Link>}
          {feature("sets") && templates.some((t) => t.kind === "wearable") ? (
            <Link href="/catalog/new?set=1" className={ghostButtonClass}><Plus className="h-4 w-4" /> New set</Link>
          ) : null}
          <Link href="/catalog/new" className={goldButtonClass}><Plus className="h-4 w-4" /> Add {word("item").toLowerCase()}</Link>
        </>} />
      <div className={cn("mb-4 flex gap-1.5", clothing && "hidden")} role="tablist">
        {([["items", word("items")], ["extras", "Extras"], ["categories", "Categories"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("rounded-full border px-3 py-1 text-xs", tab === k ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}>
            {label}
          </button>
        ))}
      </div>
      {tab === "items" ? (clothing ? <AllProducts /> : <Items />) : tab === "extras" ? <Extras /> : <Categories addSignal={adding} />}
    </>
  );
}

function Items() {
  const { categories, branches, templateOf, word, businessModule } = useShop();
  const clothing = businessModule === "clothing";
  const { products, reload } = useCatalog({ includeInactive: true });
  const [units, setUnits] = useState<Pick<Unit, "variation_id" | "branch_id" | "status">[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [stockFilter, setStockFilter] = useState<"" | "in" | "out">("");
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
  const stockOf = (p: Product) => (p.product_variations ?? []).filter((v) => v.is_enabled).reduce((s, v) => s + (count.get(v.id)?.total ?? 0), 0);
  const list = (products ?? []).filter((p) => (showInactive || p.is_active || clothing) && (!cat || p.category_id === cat)
    && (!stockFilter || p.is_set || (stockFilter === "in") === (stockOf(p) > 0))
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
        {clothing ? (
          <select className={cn(inputClass, "w-auto")} aria-label="Stock status" value={stockFilter} onChange={(e) => setStockFilter(e.target.value as typeof stockFilter)}>
            <option value="">Filter by stock status</option><option value="in">In stock</option><option value="out">Out of stock</option>
          </select>
        ) : (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show switched-off
          </label>
        )}
      </div>
      {clothing ? <ProductTable list={list} units={units} loading={products === null} reload={reload} /> : (
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
      {branches.length > 1 && !clothing ? <p className="mt-2 text-xs text-muted-foreground">Counts cover all branches; open an item to see each branch.</p> : null}
    </>
  );
}

function Extras() {
  const { shop, addOns, templates, categories, canManage, refresh, businessModule } = useShop();
  const clothing = businessModule === "clothing";
  const noun = clothing ? "accessory" : "extra";
  const [edit, setEdit] = useState<(Partial<AddOn> & { amountText: string; quantityText: string }) | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!edit) return;
    // an accessory may be free (blank price); an extra of the other shops keeps its required price
    const bad = businessNameError(edit.name ?? "", `${noun}'s name`, 40)
      ?? moneyError(edit.amountText ?? "", { label: "price", required: !clothing, max: 1_000_000 })
      ?? (edit.quantityText.trim() && !/^\d{1,5}$/.test(edit.quantityText.trim()) ? "How many you have must be a whole number." : null);
    if (bad) return toast.error(bad);
    setBusy(true);
    const row = {
      name: (edit.name ?? "").trim().replace(/\s+/g, " "), basis: edit.basis ?? "per_rental", amount: num(edit.amountText), template_keys: edit.template_keys ?? [], is_active: edit.is_active ?? true,
      // the columns of migration 029 are only sent when used, so extras still save before it is applied
      ...(clothing ? { category_ids: edit.category_ids ?? [], quantity: edit.quantityText.trim() ? Number(edit.quantityText) : null } : {}),
    };
    const supabase = createClient();
    const { error } = edit.id ? await supabase.from("add_ons").update(row).eq("id", edit.id) : await supabase.from("add_ons").insert({ ...row, shop_id: shop.id });
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? `An ${noun} with this name exists.` : errorText(error));
    toast.success("Saved");
    setEdit(null);
    await refresh();
  };
  const catNames = (ids: string[] | undefined) => (ids?.length ? ids.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean).join(", ") : "every category");

  return (
    <Panel title={clothing ? "Accessories offered with an outfit" : "Extras offered with a booking"} actions={canManage ? (
      <button className={ghostButtonClass} onClick={() => setEdit({ basis: "per_rental", amountText: "", quantityText: "", template_keys: [], category_ids: [], is_active: true })}><Plus className="h-4 w-4" /> Add {noun}</button>
    ) : null}>
      {addOns.length === 0 ? <Empty>{clothing ? "No accessories yet. Add safas, malas, chunnis and the like, and link them to the categories they go with." : "No extras yet."}</Empty> : (
        <ul className="divide-y divide-border">
          {addOns.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div>
                <span className="font-medium">{a.name}</span> {!a.is_active ? <StatusBadge>Off</StatusBadge> : null}
                <p className="text-xs text-muted-foreground">{Number(a.amount) > 0 ? `${rupees(a.amount)} ${BASIS_LABELS[a.basis]}` : "Free"}
                  {clothing ? ` · with ${catNames(a.category_ids)}${a.quantity != null ? ` · ${a.quantity} in the shop` : ""}`
                    : a.template_keys.length ? ` · ${a.template_keys.map((k) => templates.find((t) => t.key === k)?.name ?? k).join(", ")}` : " · all types"}</p>
              </div>
              {canManage ? <button className={ghostButtonClass} onClick={() => setEdit({ ...a, amountText: Number(a.amount) ? String(a.amount) : "", quantityText: a.quantity != null ? String(a.quantity) : "" })}>Edit</button> : null}
            </li>
          ))}
        </ul>
      )}
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${noun}` : `New ${noun}`}
        footer={<><button className={ghostButtonClass} onClick={() => setEdit(null)}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button></>}>
        {edit ? <>
          <Field label="Name" error={edit.name?.trim() ? businessNameError(edit.name ?? "", `${noun}'s name`, 40) ?? undefined : undefined}><input className={inputClass} maxLength={40} value={edit.name ?? ""} placeholder={clothing ? "e.g. Safa, Mala, Dupatta" : undefined} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (₹)" hint={clothing ? "Leave blank if it comes free" : undefined} error={edit.amountText?.trim() ? moneyError(edit.amountText, { label: "price", max: 1_000_000 }) ?? undefined : undefined}><input className={monoInputClass} inputMode="decimal" maxLength={10} placeholder={clothing ? "Free" : undefined} value={edit.amountText} onChange={(e) => setEdit({ ...edit, amountText: e.target.value })} /></Field>
            <Field label="Charged">
              <select className={inputClass} value={edit.basis} onChange={(e) => setEdit({ ...edit, basis: e.target.value as AddOnBasis })}>
                {Object.entries(BASIS_LABELS).filter(([k]) => !clothing || k === "per_rental" || k === "per_day").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          {clothing ? <>
            <Field label="How many you have" hint="Optional. Shown to staff at booking.">
              <input className={monoInputClass} inputMode="numeric" maxLength={5} placeholder="Not counted" value={edit.quantityText} onChange={(e) => setEdit({ ...edit, quantityText: e.target.value })} />
            </Field>
            <fieldset>
              <legend className="mb-1.5 block text-xs font-semibold tracking-wide text-muted-foreground">Suggest it with</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                {categories.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={edit.category_ids?.includes(c.id) ?? false}
                      onChange={(e) => setEdit({ ...edit, category_ids: e.target.checked ? [...(edit.category_ids ?? []), c.id] : (edit.category_ids ?? []).filter((x) => x !== c.id) })} />
                    {c.name}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">None ticked: suggested with every outfit.</p>
            </fieldset>
          </> : templates.length > 1 ? (
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

function Categories({ addSignal }: { addSignal: number }) {
  const { shop, categories, templates, canManage, refresh, businessModule } = useShop();
  const clothing = businessModule === "clothing";
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  // the page header's "Add Category" button counts up; each count opens the new-category form
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (addSignal > 0) setEdit({ template_key: templates[0]?.key }); }, [addSignal]);

  const remove = async (c: Category) => {
    const { error } = await createClient().from("categories").delete().eq("id", c.id);
    if (error) return toast.error(error.code === "23503" ? `Products are still in ${c.name}. Move or delete them first.` : errorText(error));
    toast.success(`${c.name} deleted`);
    await refresh();
  };
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!edit?.template_key) return toast.error("Choose the category's type.");
    const nameBad = businessNameError(edit?.name ?? "", "category name", 40);
    if (nameBad) return toast.error(nameBad);
    const prefix = (edit.sku_prefix ?? "").trim().toUpperCase();
    // bridal and groom shops number their products from the category's base SKU, as in TRENDZ
    if (clothing && !prefix) return toast.error("Enter the base SKU: 2 to 6 capital letters, e.g. BR.");
    if (prefix && !/^[A-Z]{2,6}$/.test(prefix)) return toast.error("The SKU prefix needs 2 to 6 capital letters.");
    setBusy(true);
    const row = { name: (edit.name ?? "").trim().replace(/s+/g, " "), template_key: edit.template_key, sku_prefix: prefix || null };
    const supabase = createClient();
    const { error } = edit.id ? await supabase.from("categories").update(row).eq("id", edit.id) : await supabase.from("categories").insert({ ...row, shop_id: shop.id });
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? "A category with this name exists." : errorText(error));
    toast.success("Saved");
    setEdit(null);
    await refresh();
  };

  return (
    <>
      <div className={tableWrap}>
        <table className="w-full text-left text-sm">
          <thead className={theadClass}>
            <tr><th className="px-6 py-3">Name</th>{clothing ? null : <th className="px-6 py-3">Type</th>}<th className="px-6 py-3">Base SKU</th>{canManage ? <th className="px-6 py-3 text-right">Actions</th> : null}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {categories.map((c) => (
              <tr key={c.id}>
                <td className="px-6 py-3">
                  <span className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gold/10 text-gold"><Tag className="h-4 w-4" /></span>
                    <span className="font-medium">{c.name}</span>
                  </span>
                </td>
                {clothing ? null : <td className="px-6 py-3 text-muted-foreground">{templates.find((t) => t.key === c.template_key)?.name}</td>}
                <td className="px-6 py-3">{c.sku_prefix ? <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{c.sku_prefix}</span> : <span className="text-muted-foreground">-</span>}</td>
                {canManage ? (
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-1">
                      <button className="rounded-md p-2 text-muted-foreground hover:bg-black/5 hover:text-foreground" aria-label={`Edit ${c.name}`} title="Edit" onClick={() => setEdit(c)}><Pencil className="h-4 w-4" /></button>
                      <button className="rounded-md p-2 text-muted-foreground hover:bg-black/5 hover:text-rust" aria-label={`Delete ${c.name}`} title="Delete" onClick={() => setDeleting(c)}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {categories.length === 0 ? <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No categories yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <ConfirmDialog open={!!deleting} message={`Delete ${deleting?.name}?\n\nA category that still has products cannot be deleted.`}
        onCancel={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting); setDeleting(null); }} />
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? "Edit category" : "New category"}
        description={templates.length > 1 ? "The type decides how items in it are priced and handed over." : undefined}
        footer={<><button className={ghostButtonClass} onClick={() => setEdit(null)}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button></>}>
        {edit ? <>
          <Field label="Name" error={edit.name?.trim() ? businessNameError(edit.name ?? "", "category name", 40) ?? undefined : undefined}><input className={inputClass} maxLength={40} value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          {templates.length > 1 ? (
            <Field label="Type" hint={edit.id ? "Fixed once items exist in it" : undefined}>
              <select className={inputClass} value={edit.template_key} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, template_key: e.target.value })}>
                {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label={clothing ? "Base SKU" : "SKU prefix (optional)"}
            hint={clothing ? "2 to 6 capital letters, e.g. BR. Products in this category are numbered BR-001, BR-002..." : "2 to 6 capital letters, e.g. LEH"}>
            <input className={monoInputClass} maxLength={6} value={edit.sku_prefix ?? ""} onChange={(e) => setEdit({ ...edit, sku_prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} />
          </Field>
        </> : null}
      </Modal>
    </>
  );
}
