"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, LayoutGrid, List, Pencil, QrCode, Sheet, ShoppingBag, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { errorText, rupees } from "@/lib/shop/format";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { headlinePrice, useCatalog } from "@/lib/shop/useCatalog";
import type { Product } from "@/lib/shop/types";
import { stockTotals, useStock } from "@/modules/clothing/components/StockCard";
import { RentProductDialog } from "@/modules/clothing/components/RentProductDialog";
import { ProductDetail } from "@/modules/clothing/components/ProductDetail";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, ghostButtonClass, goldButtonClass, inputClass, ListSkeleton } from "@/components/shop/ui";
import { useBulkSetup } from "@/modules/clothing/useBulkSetup";
import { exportProducts } from "@/modules/clothing/sheet";

// All Products: every product with its stock in each branch. Tap a product for its complete details; Rent asks for the colour
// and size, then shows what is in stock with Rent (adds to the cart). Owners and managers also get Edit; the owner gets Remove.
export default function AllRentals() {
  const { activeBranches, myBranchId, tz, branches, canManage, isOwner, categories } = useShop();
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
  // ticked products, for printing their tags, editing them in bulk or exporting them
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const { cols, loadUnits } = useBulkSetup();
  const exportPicked = async () => {
    try {
      const n = await exportProducts((products ?? []).filter((p) => picked.has(p.id)), { cols, categories, units: await loadUnits() });
      toast.success(`Exported ${n} row${n === 1 ? "" : "s"}`);
    } catch (e) { toast.error(errorText(e)); }
  };
  const pickBox = (p: Product) => (canManage ? (
    <input type="checkbox" aria-label={`Select ${p.name}`} checked={picked.has(p.id)} onClick={(e) => e.stopPropagation()} onChange={() => togglePick(p.id)}
      className="h-4 w-4 shrink-0 cursor-pointer accent-gold" />
  ) : null);
  const allPicked = (list: Product[]) => list.length > 0 && list.every((p) => picked.has(p.id));
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
      {p.is_active ? <button type="button" className={cn(goldButtonClass, "px-4 py-1.5 text-xs", full && "min-h-10 flex-1 text-sm")} onClick={() => setOpen(p)}><ShoppingBag className="h-3.5 w-3.5" /> Rent</button> : null}
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
      <p className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{products ? `${list.length} product${list.length === 1 ? "" : "s"} found` : "Loading..."}</span>
        {canManage && list.length ? (
          <button type="button" className="text-gold hover:underline" onClick={() => setPicked(allPicked(list) ? new Set() : new Set(list.map((p) => p.id)))}>
            {allPicked(list) ? "Unselect all" : `Select all ${list.length}`}
          </button>
        ) : null}
      </p>
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
              <div key={p.id} className={cn("group relative flex flex-col overflow-hidden glass transition-all hover:border-gold/40 hover:shadow-md", picked.has(p.id) && "border-gold/60 ring-2 ring-gold/30")}>
              {canManage ? <span className="absolute left-2 top-2 z-[1] flex rounded-md bg-white/90 p-1 shadow-sm">{pickBox(p)}</span> : null}
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
                  {canManage ? <th className="w-10 py-3 pl-4"><span className="sr-only">Select</span></th> : null}
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
                      {canManage ? <td className="py-2.5 pl-4" onClick={(e) => e.stopPropagation()}>{pickBox(p)}</td> : null}
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
                  {canManage ? <span className="flex items-center pl-3">{pickBox(p)}</span> : null}
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

      {picked.size ? (
        <div role="region" aria-label="Selected products" className="glass sticky bottom-3 z-20 mt-4 flex flex-wrap items-center justify-between gap-2 p-3 shadow-lg">
          <span className="text-sm font-medium">{picked.size} selected</span>
          <div className="flex flex-wrap gap-2">
            <Link href={`/print/tags?products=${Array.from(picked).join(",")}`} className={ghostButtonClass}><QrCode className="h-4 w-4" /> Print tags</Link>
            <Link href={`/catalog/bulk?load=${Array.from(picked).join(",")}`} className={ghostButtonClass}><Sheet className="h-4 w-4" /> Edit in bulk</Link>
            <button type="button" className={ghostButtonClass} onClick={() => void exportPicked()}><FileSpreadsheet className="h-4 w-4" /> Export to Excel</button>
            <button type="button" className={ghostButtonClass} onClick={() => setPicked(new Set())}><X className="h-4 w-4" /> Clear</button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog open={!!deleting} tone="danger" title={`Delete ${deleting?.name ?? "this product"}?`} confirmLabel="Delete" cancelLabel="Keep it" message="If it has rental or booking history it will be switched off instead of deleted."
        onCancel={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting); setDeleting(null); }} />

      {/* the complete details of a product: tap a product; Rent starts the booking */}
      <Dialog open={detail !== null} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto bg-surface p-4 sm:max-w-4xl sm:rounded-2xl sm:p-6">
          <DialogTitle className="sr-only">{detail?.name ?? "Product"}</DialogTitle>
          <DialogDescription className="sr-only">Everything about this product: stock, who has it, bookings, earnings and every piece.</DialogDescription>
          {detail ? <ProductDetail product={detail} stock={stock}
            onRent={() => { const p = detail; setDetail(null); setOpen(p); }}
            onRemove={() => { setDeleting(detail); setDetail(null); }} /> : null}
        </DialogContent>
      </Dialog>

      {open ? <RentProductDialog key={open.id} product={open} stock={stock} dailyPrice={price(open)} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
