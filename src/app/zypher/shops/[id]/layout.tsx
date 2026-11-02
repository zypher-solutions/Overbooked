"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// One shop's pages in the console: its overview and billing, its branches (with stock counts) and its staff.
// Everything here names the shop in the address, so nothing is "opened" and two tabs can work on two shops.
export default function ShopLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const base = `/zypher/shops/${id}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/branches`, label: "Branches" },
    { href: `${base}/staff`, label: "Staff" },
  ];
  return (
    <>
      <Link href="/zypher/shops" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> Shops
      </Link>
      <nav aria-label="Shop sections" className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border">
        {tabs.map((t) => {
          const on = pathname === t.href;
          return (
            <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
              className={cn("-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors",
                on ? "border-gold font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </>
  );
}
