"use client";

import { useShop } from "@/lib/shop/ShopContext";
import { shopModules } from "@/modules/registry";
import { PageSkeleton } from "@/components/shop/ui";

// each module opens on its own home screen (bridal and groom: the TRENDZ dashboard; others: Today)
export default function Home() {
  const { businessModule, loading } = useShop();
  if (loading) return <PageSkeleton columns={false} />;
  const { Home: ModuleHome } = shopModules[businessModule];
  return <ModuleHome />;
}
