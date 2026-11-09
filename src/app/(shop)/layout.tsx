"use client";

import { PageSkeleton } from "@/components/shop/ui";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { ShopProvider } from "@/lib/shop/ShopContext";
import { ShopShell } from "@/components/shop/ShopShell";
import { CartProvider } from "@/modules/clothing/cart";

// Every shop screen: a signed-in shop member (owner, manager, staff, or a Zypher support login for this shop).
// Zypher admins work in the console, never here. The database checks shop, role and branch again on every read and write.
export default function ShopLayout({ children }: { children: ReactNode }) {
  const { profile, shop, isLoading } = useAuth();
  const zypherAdmin = profile?.role === "super_admin";

  useEffect(() => {
    if (zypherAdmin) window.location.replace("/zypher");
  }, [zypherAdmin]);

  if (isLoading || !profile || !shop) {
    return (
      <div className="min-h-screen bg-background lg:pl-64">
        <div className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-sidebar lg:block" aria-hidden="true" />
        <main className="px-4 pt-[calc(4.5rem+env(safe-area-inset-top))] sm:px-6 lg:px-8 lg:pt-8"><PageSkeleton columns={false} /></main>
      </div>
    );
  }
  return (
    <ShopProvider>
      <CartProvider key={`${shop.id}:${profile.id}`} shopId={shop.id}>
        <ShopShell>{children}</ShopShell>
      </CartProvider>
    </ShopProvider>
  );
}
