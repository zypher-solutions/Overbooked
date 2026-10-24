"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useShop } from "@/lib/shop/ShopContext";
import { ProductEditor } from "@/components/shop/ProductEditor";
import { Panel } from "@/components/shop/ui";

export default function NewProduct() {
  const { canManage, categories, loading } = useShop();
  if (loading) return null;
  return (
    <>
      <Link href="/catalog" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Catalog</Link>
      {!canManage ? <Panel><p className="text-sm text-muted-foreground">Only owners and managers can add items.</p></Panel>
        : categories.length === 0 ? <Panel><p className="text-sm text-muted-foreground">Add a category first (Catalog, Categories).</p></Panel>
        : <ProductEditor />}
    </>
  );
}
