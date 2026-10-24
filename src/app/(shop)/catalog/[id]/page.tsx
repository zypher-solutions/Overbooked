"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { errorText } from "@/lib/shop/format";
import type { Product } from "@/lib/shop/types";
import { ProductEditor } from "@/components/shop/ProductEditor";
import { UnitsPanel } from "@/components/shop/UnitsPanel";
import { Panel } from "@/components/shop/ui";

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const { templateOf, loading } = useShop();
  const [p, setP] = useState<Product | null | undefined>(undefined);

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("products")
      .select("*, product_variations!product_variations_shop_product_fkey(*, variation_rates!variation_rates_shop_variation_fkey(rate_type, amount))")
      .eq("id", id).maybeSingle();
    if (error) toast.error(errorText(error));
    const product = (data as Product) ?? null;
    product?.product_variations?.sort((a, b) => a.sku.localeCompare(b.sku));
    setP(product);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (p === undefined || loading) return <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p>;
  if (p === null) return <Panel><p className="text-sm text-muted-foreground">Item not found.</p></Panel>;
  const template = templateOf(p.category_id);

  return (
    <>
      <Link href="/catalog" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Catalog</Link>
      <div className="space-y-4">
        <ProductEditor product={p} onSaved={load} />
        {template && !p.is_set ? <UnitsPanel product={p} template={template} /> : null}
      </div>
    </>
  );
}
