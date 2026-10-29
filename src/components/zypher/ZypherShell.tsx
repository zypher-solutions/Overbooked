"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Store, PlusCircle, Wallet, Layers, ScrollText, LogOut, Menu, Settings, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/overbooked/AuthContext";

const NAV = [
  { href: "/zypher", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/zypher/shops", label: "Shops", icon: Store, exact: true },
  { href: "/zypher/shops/new", label: "New shop", icon: PlusCircle, exact: true },
  { href: "/zypher/billing", label: "Billing", icon: Wallet },
  { href: "/zypher/templates", label: "Business types", icon: Layers },
  { href: "/zypher/audit", label: "Audit log", icon: ScrollText },
  { href: "/zypher/team", label: "Zypher team", icon: Users },
  { href: "/zypher/settings", label: "Settings", icon: Settings },
];

export function ZypherShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const isActive = (item: (typeof NAV)[number]) =>
    item.exact
      ? pathname === item.href || (item.href === "/zypher/shops" && /^\/zypher\/shops\/(?!new$)[^/]+$/.test(pathname))
      : pathname.startsWith(item.href);

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="px-5 pb-4 pt-6">
        <p className="font-display text-lg font-semibold text-foreground">Zypher</p>
        <p className="text-[11px] uppercase tracking-[0.14em] text-gold">Overbooked console</p>
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {NAV.map((item) => (
          <li key={item.href}>
            <Link href={item.href} onClick={() => setOpen(false)} aria-current={isActive(item) ? "page" : undefined}
              className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive(item) ? "bg-gold/10 font-medium text-foreground" : "text-muted-foreground hover:bg-black/5 hover:text-foreground")}>
              <item.icon className={cn("h-4 w-4", isActive(item) && "text-gold")} />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="space-y-2 border-t border-border p-4 text-xs">
        <p className="truncate text-muted-foreground">{profile?.full_name}</p>
        <button onClick={signOut} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-x-0 top-0 z-20 flex min-h-14 items-center border-b border-border bg-surface px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-md hover:bg-black/5">
          <Menu className="h-5 w-5" />
        </button>
        <span className="ml-2 font-display font-semibold">Zypher console</span>
      </div>
      {open ? <div className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} /> : null}
      <aside className={cn("fixed inset-y-0 left-0 z-40 w-60 border-r border-border bg-sidebar transition-transform lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full")}>
        <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute right-2 top-3 rounded-md p-2 hover:bg-black/5 lg:hidden">
          <X className="h-4 w-4" />
        </button>
        {nav}
      </aside>
      <main className="min-w-0 px-4 pb-16 pt-[calc(4.5rem+env(safe-area-inset-top))] sm:px-6 lg:ml-60 lg:px-8 lg:pt-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
