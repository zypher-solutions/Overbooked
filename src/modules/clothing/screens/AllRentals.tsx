"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, LayoutGrid, List, Pencil, Search as SearchIcon, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { errorText, rupees } from "@/lib/shop/format";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { headlinePrice, useCatalog } from "@/lib/shop/useCatalog";
import type { Product } from "@/lib/shop/types";
import { StockCard, stockTotals, useStock } from "@/modules/clothing/components/StockCard";
import { ProductDetail } from "@/modules/clothing/components/ProductDetail";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, ghostButtonClass, goldButtonClass, inputClass, ListSkeleton } from "@/components/shop/ui";

// All Products: every product with its stock in each branch. Tap a product for its complete details; Rent asks for the colour
// and size, then shows what is in stock with Rent (adds to the cart). Owners and managers also get Edit; the owner gets Remove.
const SWATCH: Record<string, string> = {
  black: "#111111", white: "#ffffff", red: "#c62828", maroon: "#7b1e3a", wine: "#722f37", pink: "#e8799f", "hot pink": "#e91e8c", peach: "#ffb08a",
  orange: "#ef7d22", yellow: "#f4d03f", mustard: "#c9992b", gold: "#c9a227", green: "#2e8b57", "bottle green": "#0b5d3b", olive: "#6b6b2a", teal: "#1a8a8a",
  blue: "#2a6fd6", "royal blue": "#2646b3", navy: "#17224d", "sky blue": "#7ec0ee", purple: "#7b3fa0", lavender: "#b9a3dd", violet: "#6a3fb5",
  grey: "#8a8f94", gray: "#8a8f94", silver: "#c2c6ca", brown: "#7a5133", beige: "#d9c4a3", cream: "#f3ead2", ivory: "#f7f1e1", rust: "#b5532f",
};
const swatchOf = (name: string) => SWATCH[name.trim().toLowerCase()];

export default function AllRentals() {
  const { activeBranches, myBranchId, tz, branches, canManage, isOwner, categories, templateOf } = useShop();
  const { products, reload } = useCatalog({ includeInactive: canManage });
  const [deleting, setDeleting] = useState<Product | null>(null);
  const remove = async (p: Product) => {
    try {
      const res = await call<{ result: string }>("delete_or_deactivate_product", { p_product_id: p.id });
      toast.success(res.result === "deleted" ? "Deleted" : "Switched off (it has rental history)");
      await reload();
    } catch (e) { toast.error(errorText(e)); }
  };
  const reactivate = async (p: Product) => {
    try { await call("reactivate_product", { p_product_id: p.id }); toast.success(`${p.name} is active again`); await reload(); } catch (e) { toast.error(errorText(e)); }
  };
  const { stock } = useStock();
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState(myBranchId ?? "");
  const [stockFilter, setStockFilter] = useState<"" | "in" | "out">("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [open, setOpen] = useState<Product | null>(null); // the Rent flow: colour and size, then the stock with Rent
  const [detail, setDetail] = useState<Product | null>(null); // the complete details of a product
  // opening a product: first a small card to choose the colour and size, then the stock of what was chosen
  const [step, setStep] = useState<"filter" | "stock">("stock");
  const [pick, setPick] = useState<Record<string, string[]>>({});
  const optionsOf = (p: Product) => {
    const vars = (p.product_variations ?? []).filter((v) => v.is_enabled);
    const order = (templateOf(p.category_id)?.variation_fields ?? []).map((x) => x.key);
    const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
    return Array.from(new Set(vars.flatMap((v) => Object.keys(v.attributes ?? {})))).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((key) => ({ key, values: Array.from(new Set(vars.map((v) => String(v.attributes?.[key] ?? "").trim()).filter(Boolean))) }))
      .filter((o) => o.values.length > 1);
  };
  const openProduct = (p: Product) => { setPick({}); setStep(optionsOf(p).length ? "filter" : "stock"); setOpen(p); };
  const toggle = (key: string, value: string) => setPick((x) => {
    const now = x[key] ?? [];
    return { ...x, [key]: now.includes(value) ? now.filter((y) => y !== value) : [...now, value] };
  });
  // how many variations the current choice matches, so the button can say what Search will show
  const matches = (p: Product) => (p.product_variations ?? []).filter((v) => v.is_enabled)
    .filter((v) => Object.entries(pick).every(([k, vals]) => !vals.length || vals.includes(String(v.attributes?.[k] ?? "").trim()))).length;
  const label = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (products ?? []).filter((p) => {
      if (term) {
        const vars = (p.product_variations ?? []).map((v) => `${v.name} ${v.sku}`).join(" ");
        const hay = `${p.name} ${p.sku} ${vars}`.toLowerCase();
        // a piece code is its variation's SKU plus a number, so it finds the product too
        const byCode = [p.sku, ...(p.product_variations ?? []).map((v) => v.sku)].some((k) => term.startsWith(k.toLowerCase() + "-"));
        if (!hay.includes(term) && !byCode) return false;
      }
      const { total, free } = stockTotals(stock, p, branch || undefined);
      if (p.is_set) return true; // a set has no pieces of its own; checkout checks its pieces
      if (branch && total === 0) return false;
      if (stockFilter === "in" && free <= 0) return false;
      if (stockFilter === "out" && free > 0) return false;
      return true;
    });
  }, [products, stock, q, branch, stockFilter]);

  const price = (p: Product) => {
    const rates = (p.product_variations ?? []).filter((v) => v.is_enabled).map((v) => headlinePrice(v)?.amount).filter((x): x is number => x !== undefined);
    if (!rates.length) return "No price";
    const lo = Math.min(...rates);
    const hi = Math.max(...rates);
    return lo === hi ? rupees(lo) : `${rupees(lo)} – ${rupees(hi)}`;
  };
  const manage = (p: Product, full = false) => (
    <div className={cn("flex items-center gap-2", full ? "border-t border-border/60 px-3 py-2.5" : "shrink-0 self-center pr-3")}>
      {p.is_active ? <button type="button" className={cn(goldButtonClass, "px-4 py-1.5 text-xs", full && "min-h-10 flex-1 text-sm")} onClick={() => openProduct(p)}><ShoppingBag className="h-3.5 w-3.5" /> Rent</button> : null}
      {canManage ? <Link href={`/catalog/${p.id}`} className={cn(ghostButtonClass, full && "flex-1")}><Pencil className="h-3.5 w-3.5" /> Edit</Link> : null}
      {canManage && !p.is_active ? <button type="button" className={ghostButtonClass} onClick={() => void reactivate(p)}>Reactivate</button> : null}
      {isOwner ? <button type="button" title="Remove product" aria-label={`Remove ${p.name}`} onClick={() => setDeleting(p)}
        className="inline-flex items-center justify-center rounded-full border border-rust/40 p-2 text-rust hover:bg-rust/10"><Trash2 className="h-4 w-4" /></button> : null}
    </div>
  );
  // only how many branches hold it: the stock of each branch is in the product's details
  const pills = (p: Product) => {
    if (p.is_set) return <span className="text-muted-foreground">—</span>;
    const n = activeBranches.filter((b) => stockTotals(stock, p, b.id).total > 0).length;
    return <span className="inline-block whitespace-nowrap rounded-full border border-border bg-white px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{n} {n === 1 ? "branch" : "branches"}</span>;
  };

  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">{products ? `${list.length} product${list.length === 1 ? "" : "s"} found` : "Loading..."}</p>
      <div className="glass mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <input className={cn(inputClass, "sm:max-w-xs")} placeholder="Search products by name or SKU..." aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          {!myBranchId && activeBranches.length > 1 ? (
            <select className={cn(inputClass, "w-auto")} aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All branches</option>
              {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : null}
          <select className={cn(inputClass, "w-auto")} aria-label="Stock status" value={stockFilter} onChange={(e) => setStockFilter(e.target.value as typeof stockFilter)}>
            <option value="">All stock status</option><option value="in">In stock</option><option value="out">Out of stock</option>
          </select>
          <div className="flex rounded-md border border-border p-1">
            <button aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cn("rounded p-1.5", view === "grid" ? "bg-black/10" : "text-muted-foreground")}><LayoutGrid className="h-4 w-4" /></button>
            <button aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("rounded p-1.5", view === "list" ? "bg-black/10" : "text-muted-foreground")}><List className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      {products === null ? <ListSkeleton /> : list.length === 0 ? (
        <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed border-border"><p className="text-sm text-muted-foreground">No products match your filters.</p></div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
          {list.map((p) => {
            const { total, free } = stockTotals(stock, p, branch || undefined);
            return (
              <div key={p.id} className="group flex flex-col overflow-hidden glass transition-all hover:border-gold/40 hover:shadow-md">
              <button type="button" onClick={() => setDetail(p)} className="flex flex-1 flex-col text-left">
                <div className="relative aspect-square w-full overflow-hidden bg-muted/60">
                  {p.image_url ? <img src={p.image_url} alt={p.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /> : null}
                  {stock === null ? null : <span className="absolute right-2 top-2">
                    <StatusBadge tone={!p.is_active ? "muted" : free > 0 ? "emerald" : total === 0 ? "muted" : "rust"}>{!p.is_active ? "Switched off" : free > 0 ? "In Stock" : total === 0 ? "No pieces" : "Out"}</StatusBadge>
                  </span>}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <h3 className="line-clamp-2 font-display text-sm font-semibold sm:text-base">{p.name}</h3>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="truncate font-mono text-xs text-muted-foreground">{p.sku}</p>
                  </div>
                  <p className="mb-2 mt-auto pt-3 font-mono text-sm text-gold">{price(p)}/day</p>
                  {pills(p)}
                </div>
              </button>
              {manage(p, true)}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="glass hidden overflow-x-auto xl:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/70 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Product</th><th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Daily rate</th><th className="px-4 py-3 text-right">Total stock</th><th className="px-4 py-3">Branches</th>
                  <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((p) => {
                  const { total, free } = stockTotals(stock, p, branch || undefined);
                  return (
                    <tr key={p.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setDetail(p)}>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-3">
                          {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-lg object-cover" /> : <span className="h-11 w-11 shrink-0 rounded-lg bg-muted/70" />}
                          <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block font-mono text-xs text-muted-foreground">{p.sku}</span></span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{categories.find((c) => c.id === p.category_id)?.name ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-gold">{price(p)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{p.is_set ? "—" : total}</td>
                      <td className="px-4 py-2.5">{pills(p)}</td>
                      <td className="px-4 py-2.5"><StatusBadge tone={!p.is_active ? "muted" : free > 0 ? "emerald" : total === 0 ? "muted" : "rust"}>{!p.is_active ? "Switched off" : free > 0 ? "In stock" : total === 0 ? "No pieces" : "Out"}</StatusBadge></td>
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}><span className="flex justify-end">{manage(p)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="glass divide-y divide-border overflow-hidden xl:hidden">
            {list.map((p) => {
              const { total, free } = stockTotals(stock, p, branch || undefined);
              return (
                <li key={p.id} className="flex items-stretch">
                  <button type="button" onClick={() => setDetail(p)} className="flex min-w-0 flex-1 gap-3 p-3 text-left hover:bg-black/[0.02]">
                    {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-lg object-cover" /> : <span className="h-14 w-14 shrink-0 rounded-lg bg-muted/70" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <StatusBadge tone={!p.is_active ? "muted" : free > 0 ? "emerald" : total === 0 ? "muted" : "rust"}>{!p.is_active ? "Switched off" : free > 0 ? "In stock" : total === 0 ? "No pieces" : "Out"}</StatusBadge>
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.sku} · {categories.find((c) => c.id === p.category_id)?.name ?? "—"}{p.is_set ? "" : ` · ${total} pieces`}</span>
                      <span className="mb-1 mt-1 block font-mono text-xs text-gold">{price(p)}/day</span>
                      {pills(p)}
                    </span>
                  </button>
                  {manage(p)}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ConfirmDialog open={!!deleting} tone="danger" title={`Delete ${deleting?.name ?? "this product"}?`} confirmLabel="Delete" cancelLabel="Keep it" message="If it has rental or booking history it will be switched off instead of deleted."
        onCancel={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting); setDeleting(null); }} />

      {/* the complete details of a product: tap a product; Rent starts the booking */}
      <Dialog open={detail !== null} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-h-[92dvh] gap-6 overflow-y-auto p-5 sm:max-w-4xl sm:rounded-2xl sm:p-8">
          <DialogTitle className="sr-only">{detail?.name ?? "Product"}</DialogTitle>
          <DialogDescription className="sr-only">Everything about this product: stock, who has it, bookings, earnings and every piece.</DialogDescription>
          {detail ? <ProductDetail product={detail} stock={stock}
            onRent={() => { const p = detail; setDetail(null); openProduct(p); }}
            onRemove={() => { setDeleting(detail); setDetail(null); }} /> : null}
        </DialogContent>
      </Dialog>

      {/* step 1: a small card to choose the colour and size */}
      <Dialog open={open !== null && step === "filter"} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto rounded-3xl p-0 sm:max-w-md">
          {open ? <>
            <div className="flex items-center gap-4 bg-accent/60 px-6 pb-5 pt-6 pr-12">
              {open.image_url ? <img src={open.image_url} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
                : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#101715] text-[10px] text-white/60">No image</span>}
              <div className="min-w-0">
                <DialogTitle className="truncate font-display text-xl font-bold">{open.name}</DialogTitle>
                <DialogDescription className="mt-0.5 font-mono text-xs">{open.sku} · {price(open)}/day</DialogDescription>
              </div>
            </div>
            <div className="space-y-5 px-6 py-5">
              <p className="text-sm text-muted-foreground">What does the customer want? Pick a colour and a size and we will show what is in stock.</p>
              {optionsOf(open).map((o) => (
                <div key={o.key}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label(o.key)}</p>
                  <div className="flex flex-wrap gap-2">
                    {o.values.map((val) => {
                      const on = pick[o.key]?.includes(val);
                      const sw = /^colou?r$/i.test(o.key) ? swatchOf(val) : undefined;
                      return (
                        <button key={val} type="button" aria-pressed={on} onClick={() => toggle(o.key, val)}
                          className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 text-sm font-medium transition-all",
                            on ? "border-neon bg-neon/15 text-foreground shadow-sm" : "border-border bg-white hover:border-gold/40")}>
                          {sw ? <span className="h-5 w-5 rounded-full border border-black/15" style={{ background: sw }} /> : null}
                          {val}
                          {on ? <Check className="h-4 w-4 text-gold" aria-hidden="true" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border bg-white px-6 py-4">
              <button type="button" className="text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => { setPick({}); setStep("stock"); }}>Show all</button>
              <button type="button" className={cn(goldButtonClass, "min-h-11 px-6")} onClick={() => setStep("stock")}>
                <SearchIcon className="h-4 w-4" /> Search · {matches(open)} {matches(open) === 1 ? "match" : "matches"}
              </button>
            </div>
          </> : null}
        </DialogContent>
      </Dialog>

      {/* step 2: the product opened, as in TRENDZ: photo, name, code, price, then each size / colour of the choice with its stock per branch */}
      <Dialog open={open !== null && step === "stock"} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-h-[92dvh] gap-6 overflow-y-auto p-5 sm:max-w-4xl sm:rounded-2xl sm:p-8">
          <DialogTitle className="sr-only">{open?.name ?? "Product"}</DialogTitle>
          <DialogDescription className="sr-only">Stock of each size and colour in every branch. Rent adds it to the cart.</DialogDescription>
          {open ? <>
            {Object.values(pick).some((a) => a.length) ? (
              <p className="-mb-2 flex flex-wrap items-center gap-2 pr-8 text-sm text-muted-foreground">
                Showing {Object.values(pick).flat().join(", ")}
                <button type="button" className="font-medium text-gold hover:underline" onClick={() => setStep("filter")}>Change</button>
              </p>
            ) : optionsOf(open).length ? (
              <p className="-mb-2 pr-8 text-sm text-muted-foreground">Showing every variation <button type="button" className="font-medium text-gold hover:underline" onClick={() => setStep("filter")}>Choose colour or size</button></p>
            ) : null}
            <StockCard product={open} stock={stock} pick={pick} />
          </> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
