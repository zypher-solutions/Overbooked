import type { Category, Product } from "@/lib/shop/types";

type Row = Record<string, string>;

// bridal and groom SKUs, as in TRENDZ: BR-001, BR-001-GOLD-M
export const SKU_PATTERN = /^[A-Z]{2,6}-[0-9]{3,4}(-[A-Za-z0-9]+)*$/;

/** SKUs for a CSV import, as in TRENDZ: an item without a SKU gets its category's base SKU and the next number
 *  (an item that already exists keeps its own); typed SKUs must follow the pattern */
export function importSkus(products: Product[], categories: Category[], fieldCols: string[]) {
  const highest = new Map<string, number>();
  const knownSku = new Map<string, string>();
  for (const p of products) {
    knownSku.set(`${categories.find((c) => c.id === p.category_id)?.name.toLowerCase()}|${p.name.toLowerCase()}`, p.sku);
    const m = /^([A-Z]{2,6})-(\d+)/.exec(p.sku);
    if (m) highest.set(m[1], Math.max(highest.get(m[1]) ?? 0, Number(m[2])));
  }
  return {
    itemSku: (r: Row) => {
      const typed = (r.item_sku ?? "").trim().toUpperCase();
      if (typed) return typed;
      const key = `${(r.category ?? "").trim().toLowerCase()}|${(r.item_name ?? "").trim().toLowerCase()}`;
      const known = knownSku.get(key);
      if (known) return known;
      const prefix = categories.find((c) => c.name.toLowerCase() === (r.category ?? "").trim().toLowerCase())?.sku_prefix;
      if (!prefix) throw new Error(`The category "${r.category}" has no base SKU. Set it on the Categories page first.`);
      const next = (highest.get(prefix) ?? 0) + 1;
      highest.set(prefix, next);
      const sku = `${prefix}-${String(next).padStart(3, "0")}`;
      knownSku.set(key, sku);
      return sku;
    },
    /** the variation's part of its SKU, from its fields: BR-001-GOLD-M */
    variationPart: (r: Row) => fieldCols.map((k) => (r[k] ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")).filter(Boolean).join("-"),
    check: (sku: string, vSku: string) => {
      if (!(SKU_PATTERN.test(sku) && SKU_PATTERN.test(vSku))) {
        throw new Error(`SKU ${SKU_PATTERN.test(sku) ? vSku : sku} is not allowed: 2 to 6 capital letters, a hyphen, then 3 or 4 digits (e.g. BR-001), with more parts after hyphens for variations (e.g. BR-001-GOLD).`);
      }
    },
  };
}
