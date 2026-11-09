"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ImageOff, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import { useCart } from "@/modules/clothing/cart";
import { call } from "@/lib/shop/api";
import { errorText, plural, rupees } from "@/lib/shop/format";
import { headlinePrice } from "@/lib/shop/useCatalog";
import { StatusBadge, goldButtonClass } from "@/components/shop/ui";
import type { Product, Variation } from "@/lib/shop/types";

export interface StockRow {
  variation_id: string;
  branch_id: string;
  total: number;
  available_now: number;
  out_now: number;
  reserved_ahead: number;
  maintenance: number;
  lost: number;
}

// pieces per variation and branch right now (Total / Avail / Rented), as TRENDZ shows them
export function useStock() {
  const [rows, setRows] = useState<Map<string, StockRow> | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await call<StockRow[]>("inventory_status");
      setRows(
        new Map(
          data.map((r) => [
            `${r.variation_id}:${r.branch_id}`,
            {
              ...r,
              total: Number(r.total),
              available_now: Number(r.available_now),
              out_now: Number(r.out_now),
            },
          ]),
        ),
      );
    } catch (e) {
      toast.error(errorText(e));
      setRows(new Map());
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { stock: rows, reload: load };
}

export function stockTotals(
  stock: Map<string, StockRow> | null,
  p: Product,
  branchId?: string,
) {
  let total = 0;
  let free = 0;
  for (const v of p.product_variations ?? []) {
    if (!v.is_enabled) continue;
    for (const r of stock?.values() ?? []) {
      if (r.variation_id === v.id && (!branchId || r.branch_id === branchId)) {
        total += r.total;
        free += r.available_now;
      }
    }
  }
  return { total, free };
}

// "color" -> "Color": the attribute names of a variation, as TRENDZ writes them ("Color: Black, Size: M")
// (the database keeps attributes alphabetically, so they are put back in the shop's own order: Color, then Size)
const attributeText = (
  attrs: Record<string, unknown> | null | undefined,
  order: string[],
) => {
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i < 0 ? order.length : i;
  };
  return Object.entries(attrs ?? {})
    .filter(([, v]) => String(v ?? "").trim())
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(
      ([k, v]) =>
        `${k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}: ${String(v)}`,
    )
    .join(", ");
};

export function matchingVariations(
  product: Product,
  pick: Record<string, string[]> = {},
): Variation[] {
  return (product.product_variations ?? []).filter(
    (variant) =>
      variant.is_enabled &&
      Object.entries(pick).every(
        ([key, values]) =>
          !values.length ||
          values.includes(String(variant.attributes?.[key] ?? "").trim()),
      ),
  );
}

export function StockCard({
  product,
  stock,
  highlight,
  pick,
  only,
  embedded = false,
}: {
  product: Product;
  stock: Map<string, StockRow> | null;
  highlight?: string;
  pick?: Record<string, string[]>;
  only?: string;
  embedded?: boolean;
}): React.JSX.Element {
  const { activeBranches, myBranchId, attributes } = useShop();
  const cart = useCart();
  const order = attributes.map((field) => field.key);
  const variations = matchingVariations(product);
  // A typed SKU or scanned piece takes precedence over the catalog filters.
  const exact = variations.find((variant) => variant.id === only);
  const shown = exact ? [exact] : matchingVariations(product, pick);
  const rates = variations.flatMap((variant) => {
    const rate = headlinePrice(variant);
    return rate ? [rate.amount] : [];
  });
  const low = Math.min(...rates);
  const high = Math.max(...rates);

  return (
    <div className="space-y-4">
      {!embedded ? (
        <div className="flex items-center gap-4">
          <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <ImageOff aria-hidden="true" className="size-5" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="break-words font-display text-xl font-semibold">
              {product.name}
            </h2>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {product.sku}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {plural(variations.length, "variation")}
              {rates.length
                ? ` · ${low === high ? rupees(low) : `${rupees(low)} – ${rupees(high)}`} / day`
                : ""}
            </p>
          </div>
        </div>
      ) : null}
      {product.is_set ? (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          Checkout verifies whether every piece in the set is available for the
          rental dates.
        </p>
      ) : null}
      {stock === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking branch stock…
        </p>
      ) : null}
      {!shown.length ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
          {variations.length
            ? "No variations match these filters. Try another colour or size."
            : "No bookable variations."}
        </p>
      ) : null}

      <ul className="space-y-3">
        {shown.map((variant) => {
          const name = attributeText(variant.attributes, order) || variant.name;
          const rate = headlinePrice(variant);
          return (
            <li
              key={variant.id}
              className={cn(
                "overflow-hidden rounded-xl border border-border bg-surface",
                highlight === variant.id && "border-gold/50",
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-muted/40 px-4 py-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold">{name}</p>
                  <p className="break-words text-sm text-muted-foreground">
                    {variant.sku}
                  </p>
                </div>
                {rate ? (
                  <p className="text-sm font-semibold text-gold">
                    {rupees(rate.amount)}{" "}
                    <span className="font-normal">/ {rate.unit}</span>
                  </p>
                ) : null}
              </div>
              {activeBranches.length ? (
                <ul className="divide-y divide-border border-t border-border">
                  {activeBranches.map((branch) => {
                    const row = stock?.get(`${variant.id}:${branch.id}`);
                    const inCart =
                      cart.branchId === branch.id
                        ? (cart.lines.find(
                            (line) => line.variation_id === variant.id,
                          )?.qty ?? 0)
                        : 0;
                    const available = Math.max(
                      0,
                      (row?.available_now ?? 0) - inCart,
                    );
                    const canBook = !myBranchId || myBranchId === branch.id;
                    return (
                      <li
                        key={branch.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="break-words text-sm font-semibold">
                              {branch.name}
                            </p>
                            {stock !== null && !product.is_set ? (
                              <StatusBadge
                                tone={available > 0 ? "emerald" : "muted"}
                              >
                                {available} available
                              </StatusBadge>
                            ) : null}
                            {inCart > 0 ? (
                              <StatusBadge tone="accent">
                                In cart: {inCart}
                              </StatusBadge>
                            ) : null}
                          </div>
                          {stock !== null && !product.is_set ? (
                            <p className="text-xs text-muted-foreground">
                              {row?.total ?? 0} total · {row?.out_now ?? 0}{" "}
                              rented
                            </p>
                          ) : null}
                        </div>
                        {canBook ? (
                          <button
                            type="button"
                            disabled={available === 0 && !product.is_set}
                            aria-label={`Add ${name} at ${branch.name} to cart`}
                            className={cn(
                              goldButtonClass,
                              "ml-auto min-h-11 px-4",
                            )}
                            onClick={() => {
                              const added = cart.add(branch.id, variant.id);
                              if (!embedded && added)
                                toast.success(
                                  `${product.name} · ${name} added to the cart`,
                                );
                            }}
                          >
                            <ShoppingBag
                              aria-hidden="true"
                              className="size-4"
                            />{" "}
                            Add to cart
                          </button>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            View only
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                  No active branches.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
