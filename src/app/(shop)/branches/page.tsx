"use client";

import { useEffect } from "react";
import { useShop } from "@/lib/shop/ShopContext";
import { BranchManagement } from "@/components/shop/BranchManagement";

export default function BranchesPage() {
  const { refresh } = useShop();
  // the rest of the app picks up added or closed branches when leaving this page
  useEffect(() => () => { void refresh(); }, [refresh]);
  return <BranchManagement />;
}
