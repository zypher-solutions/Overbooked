"use client";

import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { ShopProvider } from "@/lib/shop/ShopContext";
import { ShopShell } from "@/components/shop/ShopShell";
import { CartProvider } from "@/lib/shop/cart";

// Every shop screen: a signed-in shop member, or Zypher staff who opened a shop.
// The database checks shop, role and branch again on every read and write.
export default function ShopLayout({ children }: { children: ReactNode }) {
  const { profile, shop, isLoading } = useAuth();
  const zypherWithoutShop = profile?.role === "super_admin" && !shop;

  useEffect(() => {
    if (zypherWithoutShop) window.location.replace("/zypher");
  }, [zypherWithoutShop]);

  if (isLoading || !profile || !shop) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading...</div>;
  }
  return (
    <ShopProvider>
      <CartProvider shopId={shop.id}>
        <ShopShell>{children}</ShopShell>
      </CartProvider>
    </ShopProvider>
  );
}
