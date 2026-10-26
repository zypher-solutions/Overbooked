"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_LIST_COLUMNS } from "@/lib/shop/api";
import { fmtDateTime, rupees } from "@/lib/shop/format";
import { headlinePrice, useCatalog } from "@/lib/shop/useCatalog";
import type { Product } from "@/lib/shop/types";
import { StockCard, stockTotals, useStock } from "@/components/shop/StockCard";
import type { ListRental } from "@/components/shop/RentalList";
import { Empty, Modal, PageHeader, StatusBadge, ghostButtonClass, goldButtonClass, inputClass } from "@/components/shop/ui";

// All Rentals, as in TRENDZ: every product with its stock in each branch. Tapping one shows each size /
// colour per branch (Total / Avail / Rented) with Add to Cart, and who has it out now.
export default function AllRentals() {
  const { activeBranches, myBranchId, tz, branches } = useShop();
  const { products } = useCatalog();
  const { stock } = useStock();
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState(myBranchId ?? "");
  const [stockFilter, setStockFilter] = useState<"" | "in" | "out">("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [open, setOpen] = useState<Product | null>(null);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (products ?? []).filter((p) => {
      if (term && !`${p.name} ${p.sku}`.toLowerCase().includes(term)) return false;
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
  const pills = (p: Product) => (
    <div className="flex flex-wrap gap-1.5">
      {activeBranches.map((b) => {
        const { total, free } = stockTotals(stock, p, b.id);
        return (
          <span key={b.id} className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-medium", free > 0 ? "border-emerald/40 bg-emerald/10 text-emerald" : "border-border text-muted-foreground")}>
            {b.name} {free}/{total}
          </span>
        );
      })}
    </div>
  );

  return (
    <>
      <PageHeader title="All Rentals" subtitle={products ? `${list.length} product${list.length === 1 ? "" : "s"} found` : "Loading..."} />
      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
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

      {products === null ? <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p> : list.length === 0 ? (
        <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed border-border"><p className="text-sm text-muted-foreground">No products match your filters.</p></div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
          {list.map((p) => {
            const { free } = stockTotals(stock, p, branch || undefined);
            const variants = (p.product_variations ?? []).filter((v) => v.is_enabled).length;
            return (
              <button key={p.id} type="button" onClick={() => setOpen(p)}
                className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface text-left transition-all hover:border-gold/40 hover:shadow-md">
                <div className="relative aspect-square w-full overflow-hidden bg-muted/60">
                  {p.image_url ? <img src={p.image_url} alt={p.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /> : null}
                  <span className="absolute right-2 top-2"><StatusBadge tone={free > 0 ? "emerald" : "rust"}>{free > 0 ? "In Stock" : "Out"}</StatusBadge></span>
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <h3 className="line-clamp-2 font-display text-sm font-semibold sm:text-base">{p.name}</h3>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="truncate font-mono text-xs text-muted-foreground">{p.sku}</p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{variants} variants</span>
                  </div>
                  <p className="mb-2 mt-auto pt-3 font-mono text-sm text-gold">{price(p)}/day</p>
                  {pills(p)}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setOpen(p)} className="flex w-full gap-3 p-3 text-left hover:bg-black/[0.02]">
                {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded object-cover" /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.sku} · {(p.product_variations ?? []).filter((v) => v.is_enabled).length} variants</span>
                  <span className="mb-1 mt-1 block font-mono text-xs text-gold">{price(p)}/day</span>
                  {pills(p)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={open !== null} onClose={() => setOpen(null)} wide title={open?.name ?? ""} description="Add a size or colour to the cart from the branch it will go out from.">
        {open ? <>
          <StockCard product={open} stock={stock} />
          <OutNow product={open} tz={tz} branchName={(id) => branches.find((b) => b.id === id)?.name ?? ""} />
          <div className="flex justify-end gap-2">
            <Link href={`/catalog/${open.id}`} className={ghostButtonClass}>Edit product</Link>
            <button className={goldButtonClass} onClick={() => setOpen(null)}>Done</button>
          </div>
        </> : null}
      </Modal>
    </>
  );
}

function OutNow({ product, tz, branchName }: { product: Product; tz: string; branchName: (id: string) => string }) {
  const [rows, setRows] = useState<ListRental[] | null>(null);
  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const { data: lines } = await supabase.from("rental_lines").select("rental_id").eq("product_id", product.id).limit(1000);
      const ids = Array.from(new Set((lines ?? []).map((l) => l.rental_id))).slice(0, 300);
      if (!ids.length) return setRows([]);
      const { data } = await supabase.from("rentals").select(RENTAL_LIST_COLUMNS).in("id", ids).eq("status", "active").order("end_at");
      setRows((data as unknown as ListRental[]) ?? []);
    })();
  }, [product.id]);
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Active rentals</h3>
      {rows === null ? <p className="text-sm text-muted-foreground">Loading...</p> : rows.length === 0 ? <Empty>None out right now.</Empty> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
              <Link href={`/rentals/${r.id}`} className="min-w-0">
                <p className="text-sm font-medium">{r.customers?.full_name} <span className="ml-1 text-[11px] font-normal text-muted-foreground">({branchName(r.branch_id)})</span></p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Due {fmtDateTime(r.end_at, tz)}</p>
              </Link>
              <Link href={`/rentals/${r.id}?receive=1`} className={cn(goldButtonClass, "px-3 py-1.5 text-xs")}>Return</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
