"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import { useCart } from "@/modules/clothing/cart";
import { call } from "@/lib/shop/api";
import { errorText, rupees } from "@/lib/shop/format";
import { headlinePrice } from "@/lib/shop/useCatalog";
import type { Product } from "@/lib/shop/types";

export interface StockRow { variation_id: string; branch_id: string; total: number; available_now: number; out_now: number; reserved_ahead: number; maintenance: number; lost: number }

// pieces per variation and branch right now (Total / Avail / Rented), as TRENDZ shows them
export function useStock() {
  const [rows, setRows] = useState<Map<string, StockRow> | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await call<StockRow[]>("inventory_status");
      setRows(new Map(data.map((r) => [`${r.variation_id}:${r.branch_id}`, {
        ...r, total: Number(r.total), available_now: Number(r.available_now), out_now: Number(r.out_now),
      }])));
    } catch (e) {
      toast.error(errorText(e));
      setRows(new Map());
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { stock: rows, reload: load };
}

export function stockTotals(stock: Map<string, StockRow> | null, p: Product, branchId?: string) {
  let total = 0;
  let free = 0;
  for (const v of p.product_variations ?? []) {
    if (!v.is_enabled) continue;
    for (const r of stock?.values() ?? []) {
      if (r.variation_id === v.id && (!branchId || r.branch_id === branchId)) { total += r.total; free += r.available_now; }
    }
  }
  return { total, free };
}

// "color" -> "Color": the attribute names of a variation, as TRENDZ writes them ("Color: Black, Size: M")
// (the database keeps attributes alphabetically, so they are put back in the business type's own order: Color, then Size)
const attributeText = (attrs: Record<string, unknown> | null | undefined, order: string[]) => {
  const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  return Object.entries(attrs ?? {}).filter(([, v]) => String(v ?? "").trim())
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([k, v]) => `${k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}: ${String(v)}`).join(", ");
};

// One product, as TRENDZ shows it when a card is opened: the photo, name, code, price, then each size / colour with
// Total / Avail / Rented in every branch and a RENT button (adds to the cart). Staff and managers can rent only from their own
// branch; the other branches are view only.
export function StockCard({ product, stock, highlight, pick, only }: { product: Product; stock: Map<string, StockRow> | null; highlight?: string; pick?: Record<string, string[]>; only?: string }) {
  const { activeBranches, myBranchId, templateOf } = useShop();
  const cart = useCart();
  const attributeOrder = (templateOf(product.category_id)?.variation_fields ?? []).map((f) => f.key);
  const variations = (product.product_variations ?? []).filter((v) => v.is_enabled);
  // the colour / size chosen before this card opened (All Products asks first); nothing chosen shows every variation
  // "only": one exact variation (a typed SKU or a scanned piece) shows just that one
  const shown = only && variations.some((v) => v.id === only) ? variations.filter((v) => v.id === only) : pick && Object.values(pick).some((a) => a.length)
    ? variations.filter((v) => Object.entries(pick).every(([k, vals]) => !vals.length || vals.includes(String(v.attributes?.[k] ?? "").trim())))
    : variations;
  const price = variations.map((v) => headlinePrice(v)?.amount).filter((x): x is number => x !== undefined);
  const lo = price.length ? Math.min(...price) : 0;
  const hi = price.length ? Math.max(...price) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-5 pr-8 sm:flex-row sm:items-start">
        <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-neutral-900 sm:h-36 sm:w-36">
          {product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-cover" />
            : <span className="text-lg font-semibold text-neutral-400">No Image</span>}
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-3xl font-bold leading-tight text-foreground sm:text-4xl">{product.name}</h2>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{product.sku}</p>
          <p className="mt-3 font-mono text-2xl text-gold">{price.length ? (lo === hi ? rupees(lo) : `${rupees(lo)} – ${rupees(hi)}`) : "No price"}/day</p>
          <span className="mt-3 inline-block rounded-full border border-gold/30 bg-gold/10 px-3.5 py-1 text-sm font-semibold text-gold">
            {variations.length > 1 ? "Variable · " : ""}{variations.length} {variations.length === 1 ? "variant" : "variants"}
          </span>
        </div>
      </div>

      {product.is_set ? <p className="text-xs text-muted-foreground">A set is free when every piece in it is free; checkout checks it for the dates.</p> : null}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="hidden grid-cols-[minmax(0,260px)_1fr] gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:grid">
          <span>Variation</span><span>Stock by branch</span>
        </div>
        {shown.map((v, i) => (
          <div key={v.id} className={cn("grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,260px)_1fr] sm:gap-4", i % 2 === 1 ? "bg-muted/50" : "", highlight === v.id && "bg-gold/10")}>
            <div className="self-center">
              <p className="text-base font-medium text-foreground">{attributeText(v.attributes, attributeOrder) || v.name}</p>
              <p className="mt-0.5 font-mono text-sm text-gold">{headlinePrice(v) ? `${rupees(headlinePrice(v)!.amount)}/day` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {activeBranches.map((b) => {
                const s = stock?.get(`${v.id}:${b.id}`);
                const inCart = cart.branchId === b.id ? cart.lines.find((l) => l.variation_id === v.id)?.qty ?? 0 : 0;
                const avail = Math.max(0, (s?.available_now ?? 0) - inCart);
                const canBook = !myBranchId || myBranchId === b.id;
                return (
                  <div key={b.id} className="w-[calc(50%-0.375rem)] glass p-3 shadow-sm sm:w-44">
                    <p className="truncate border-b border-border/70 pb-2 text-center text-xs font-bold uppercase tracking-[0.1em] text-foreground">{b.name}</p>
                    <div className="my-3 grid grid-cols-3 text-center">
                      <Stat n={s?.total ?? 0} label="Total" />
                      <Stat n={avail} label="Avail" tone={avail > 0 ? "text-emerald" : undefined} />
                      <Stat n={s?.out_now ?? 0} label="Rented" tone={s?.out_now ? "text-gold" : undefined} />
                    </div>
                    {canBook ? (
                      <button type="button" disabled={avail <= 0 && !product.is_set}
                        onClick={() => { cart.add(b.id, v.id); toast.success(`${product.name} ${v.name !== product.name ? v.name : ""} added to the cart`); }}
                        aria-label={`Add ${v.name} at ${b.name} to cart`}
                        className="w-full rounded-md bg-gold px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-40">
                        Rent
                      </button>
                    ) : (
                      <p className="rounded-md border border-border/60 py-2 text-center text-[10px] uppercase tracking-wider text-muted-foreground">View only</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {variations.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No bookable variations.</p> : null}
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className={cn("text-lg font-semibold leading-tight", tone ?? (n ? "text-foreground" : "text-muted-foreground/60"))}>{n}</span>
      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}
