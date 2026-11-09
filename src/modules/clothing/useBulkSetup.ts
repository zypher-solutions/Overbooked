"use client";

import { useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { bulkColumns, type UnitLite } from "./bulk";

/** the columns of Bulk add & edit and the export for this shop, and a loader of every piece (for counts and new codes) */
export function useBulkSetup() {
  const { attributes, activeBranches } = useShop();
  // the shop's attributes in use (Admin > Attributes), in their order
  const fields = useMemo(() => attributes.filter((a) => !a.is_archived).map((a) => ({ key: a.key, label: a.label })), [attributes]);
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
