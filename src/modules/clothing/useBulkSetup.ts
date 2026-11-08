"use client";

import { useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { bulkColumns, type UnitLite } from "./bulk";

/** the columns of Bulk add & edit and the export for this shop, and a loader of every piece (for counts and new codes) */
export function useBulkSetup() {
  const { categories, templates, activeBranches } = useShop();
  // the attributes of the shop's clothing types (Colour, Size ...), each once, in the order the types list them
  const fields = useMemo(() => {
    const used = new Set(categories.map((c) => c.template_key));
    const out: { key: string; label: string }[] = [];
    for (const t of templates) {
      if (t.kind !== "wearable" || !used.has(t.key)) continue;
      for (const f of t.variation_fields) if (!out.some((x) => x.key === f.key)) out.push({ key: f.key, label: f.label });
    }
    return out;
  }, [categories, templates]);
  const cols = useMemo(() => bulkColumns(fields, activeBranches.map((b) => ({ id: b.id, name: b.name }))), [fields, activeBranches]);

  const loadUnits = useCallback(async (): Promise<UnitLite[]> => {
    const supabase = createClient();
    const all: UnitLite[] = [];
    for (let from = 0; ; from += 1000) {
      // paging needs a fixed order, or rows can repeat or go missing between pages
      const { data, error } = await supabase.from("units").select("code, variation_id, branch_id, status").order("id").range(from, from + 999);
      if (error) throw error;
      all.push(...((data as UnitLite[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    return all;
  }, []);

  return { cols, fields, loadUnits };
}
