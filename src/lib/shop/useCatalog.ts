"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { errorText } from "./format";
import type { Product, Variation } from "./types";

// Products with their variations and rates, paged so a big catalog is never cut at 1,000 rows.
export function useCatalog({ includeInactive = false } = {}) {
  const [products, setProducts] = useState<Product[] | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const all: Product[] = [];
    for (let from = 0; ; from += 500) {
      let q = supabase.from("products")
        .select("*, product_variations!product_variations_shop_product_fkey(*, variation_rates!variation_rates_shop_variation_fkey(rate_type, amount))")
        .order("name").range(from, from + 499);
      if (!includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) {
        toast.error("Could not load the catalog: " + errorText(error));
        break;
      }
      all.push(...((data as Product[]) ?? []));
      if (!data || data.length < 500) break;
    }
    for (const p of all) {
      p.product_variations = (p.product_variations ?? []).sort((a, b) => a.sku.localeCompare(b.sku));
      for (const v of p.product_variations) v.variation_rates = (v.variation_rates ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));
    }
    setProducts(all);
  }, [includeInactive]);

  useEffect(() => { void load(); }, [load]);
  return { products, reload: load };
}

export function rateOf(v: Pick<Variation, "variation_rates">, type: string) {
  return v.variation_rates?.find((r) => r.rate_type === type)?.amount;
}

// the main price of a variation, for lists: "₹2,500 / day"
export function headlinePrice(v: Pick<Variation, "variation_rates">) {
  for (const [type, unit] of [["night", "night"], ["day", "day"], ["hour", "hour"]] as const) {
    const amount = rateOf(v, type);
    if (amount !== undefined) return { amount, unit };
  }
  return null;
}

export function variationLabel(p: Pick<Product, "name">, v: Pick<Variation, "name">) {
  return v.name && v.name !== p.name ? `${p.name} · ${v.name}` : p.name;
}
