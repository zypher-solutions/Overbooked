"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useShop } from "@/lib/shop/ShopContext";
import { ProductEditor } from "@/components/shop/ProductEditor";
import { ProductWizard } from "@/modules/clothing/components/ProductWizard";
import { Panel } from "@/components/shop/ui";

export default function NewProductPage() {
  return <Suspense fallback={null}><NewProduct /></Suspense>;
}

function NewProduct() {
  const asSet = useSearchParams().get("set") === "1";
  const { canManage, categories, loading, trendz } = useShop();
  if (loading) return null;
  return (
    <>
      <Link href="/catalog" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> {trendz ? "All Products" : "Catalog"}</Link>
      {!canManage ? <Panel><p className="text-sm text-muted-foreground">Only owners and managers can add items.</p></Panel>
        : categories.length === 0 ? <Panel><p className="text-sm text-muted-foreground">Add a category first (Catalog, Categories).</p></Panel>
        : trendz && !asSet ? <ProductWizard /> : <ProductEditor asSet={asSet} />}
    </>
  );
}
