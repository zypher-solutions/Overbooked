"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { ShopProvider } from "@/lib/shop/ShopContext";
import { ShopShell } from "@/components/shop/ShopShell";
import { CartProvider } from "@/lib/shop/cart";

const SETUP_PAGES = ["/branches", "/staff", "/stock-locations"];

// Every shop screen: a signed-in shop member, or Zypher staff who opened a shop.
// The database checks shop, role and branch again on every read and write.
export default function ShopLayout({ children }: { children: ReactNode }) {
  const { profile, shop, isLoading } = useAuth();
  const pathname = usePathname();
  const zypherWithoutShop = profile?.role === "super_admin" && !shop;
  // Zypher reaches only the setup pages of an opened shop; every other shop screen sends it to Branch Management
  const zypherOutsideSetup = profile?.role === "super_admin" && !!shop && !SETUP_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  useEffect(() => {
    if (zypherWithoutShop) window.location.replace("/zypher");
    else if (zypherOutsideSetup) window.location.replace("/branches");
  }, [zypherWithoutShop, zypherOutsideSetup]);

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
