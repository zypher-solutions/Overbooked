"use client";

import { useCallback, useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import { useCart } from "@/lib/shop/cart";
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

// One product: each size / colour, and for each branch Total / Avail / Rented with Add to Cart.
// Staff and managers can add only from their own branch; the others are view only.
export function StockCard({ product, stock, highlight }: { product: Product; stock: Map<string, StockRow> | null; highlight?: string }) {
  const { activeBranches, myBranchId } = useShop();
  const cart = useCart();
  const variations = (product.product_variations ?? []).filter((v) => v.is_enabled);
  const price = variations.map((v) => headlinePrice(v)?.amount).filter((x): x is number => x !== undefined);
  const lo = price.length ? Math.min(...price) : 0;
  const hi = price.length ? Math.max(...price) : 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex gap-4">
        {product.image_url ? <img src={product.image_url} alt="" className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover sm:h-28 sm:w-28" /> : null}
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold sm:text-2xl">{product.name}</h2>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{product.sku}</p>
          <p className="mt-2 font-mono text-gold">{price.length ? (lo === hi ? rupees(lo) : `${rupees(lo)} – ${rupees(hi)}`) : "No price"}/day</p>
          <span className="mt-2 inline-block rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold">
            {variations.length} {variations.length === 1 ? "variant" : "variants"}
          </span>
        </div>
      </div>

      {product.is_set ? <p className="mt-3 text-xs text-muted-foreground">A set is free when every piece in it is free; checkout checks it for the dates.</p> : null}
      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
        {variations.map((v) => (
          <li key={v.id} className={cn("p-3", highlight === v.id && "bg-gold/5")}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{v.name}{Object.values(v.attributes ?? {}).length ? <span className="ml-2 text-xs text-muted-foreground">{Object.values(v.attributes).join(" · ")}</span> : null}</span>
              <span className="font-mono text-xs text-gold">{headlinePrice(v) ? `${rupees(headlinePrice(v)!.amount)}/day` : ""} · <span className="text-muted-foreground">{v.sku}</span></span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {activeBranches.map((b) => {
                const s = stock?.get(`${v.id}:${b.id}`);
                const inCart = cart.branchId === b.id ? cart.lines.find((l) => l.variation_id === v.id)?.qty ?? 0 : 0;
                const avail = Math.max(0, (s?.available_now ?? 0) - inCart);
                const canBook = !myBranchId || myBranchId === b.id;
                return (
                  <div key={b.id} className="flex flex-col justify-between rounded-lg border border-border bg-background/40 p-2">
                    <p className="mb-1.5 truncate border-b border-border/60 pb-1 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{b.name}</p>
                    <div className="mb-2 grid grid-cols-3 text-center">
                      <Stat n={s?.total ?? 0} label="Total" />
                      <Stat n={avail} label="Avail" tone={avail > 0 ? "text-emerald" : undefined} />
                      <Stat n={s?.out_now ?? 0} label="Rented" tone={s?.out_now ? "text-gold" : undefined} />
                    </div>
                    {canBook ? (
                      <button type="button" disabled={avail <= 0 && !product.is_set} onClick={() => { cart.add(b.id, v.id); toast.success(`${product.name} ${v.name !== product.name ? v.name : ""} added to the cart`); }}
                        aria-label={`Add ${v.name} at ${b.name} to cart`}
                        className="inline-flex w-full items-center justify-center gap-1 rounded bg-gold px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-white hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-40">
                        <ShoppingBag className="h-3 w-3" /> Add to Cart
                      </button>
                    ) : (
                      <p className="rounded border border-border/50 py-1.5 text-center text-[10px] uppercase tracking-wider text-muted-foreground/70">View only</p>
                    )}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
        {variations.length === 0 ? <li className="p-4 text-center text-sm text-muted-foreground">No bookable variations.</li> : null}
      </ul>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className={cn("text-sm font-semibold leading-tight", tone ?? (n ? "text-foreground" : "text-muted-foreground/60"))}>{n}</span>
      <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}
