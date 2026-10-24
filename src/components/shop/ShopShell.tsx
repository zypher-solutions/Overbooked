"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  Building2, CalendarDays, CalendarPlus, ClipboardList, Home, KeyRound, LayoutGrid, LineChart, LogOut, Menu, Settings, Store, Users, UserSquare, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { useShop } from "@/lib/shop/ShopContext";
import { OfflineBanner } from "@/components/overbooked/OfflineBanner";
import { Field, Modal, goldButtonClass, ghostButtonClass, inputClass } from "./ui";
import { SubscriptionBanner } from "./Subscription";

export function ShopShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { shop, role, isOwner, canManage, branches, myBranchId, word } = useShop();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const nav = [
    { href: "/", label: "Today", icon: Home, show: true },
    { href: "/book", label: "New booking", icon: CalendarPlus, show: true },
    { href: "/rentals", label: "Bookings", icon: ClipboardList, show: true },
    { href: "/calendar", label: "Calendar", icon: CalendarDays, show: true },
    { href: "/customers", label: "Customers", icon: UserSquare, show: true },
    { href: "/catalog", label: word("items", "Catalog"), icon: LayoutGrid, show: true },
    { href: "/dashboard", label: "Money and reports", icon: LineChart, show: canManage },
    { href: "/branches", label: "Branches", icon: Building2, show: isOwner },
    { href: "/staff", label: "Staff", icon: Users, show: isOwner },
    { href: "/settings", label: "Shop settings", icon: Settings, show: isOwner },
  ].filter((n) => n.show);

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const myBranch = branches.find((b) => b.id === myBranchId)?.name;

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-x-0 top-0 z-20 flex min-h-14 items-center border-b border-border bg-surface px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-md hover:bg-black/5">
          <Menu className="h-5 w-5" />
        </button>
        <span className="ml-2 truncate font-display font-semibold">{shop.name}</span>
      </div>
      {open ? <div className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} /> : null}

      <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-64 max-w-[85vw] flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar transition-transform lg:translate-x-0",
        open ? "translate-x-0 shadow-2xl" : "-translate-x-full")} aria-label="Main navigation">
        <div className="flex items-start justify-between px-5 pb-4 pt-6">
          <div className="min-w-0">
            <p className="truncate font-display text-xl font-semibold text-foreground">{shop.name}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-gold">{role === "super_admin" ? "Zypher view" : "Overbooked"}</p>
          </div>
          <button aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-md p-2 hover:bg-black/5 lg:hidden"><X className="h-4 w-4" /></button>
        </div>
        <nav className="flex-1 px-3">
          {role === "super_admin" ? (
            <a href="/zypher" className="mb-2 flex items-center gap-3 rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-sm text-foreground hover:bg-gold/10">
              <Store className="h-4 w-4 text-gold" /> Zypher console
            </a>
          ) : null}
          <ul className="space-y-0.5">
            {nav.map((n) => (
              <li key={n.href}>
                <Link href={n.href} onClick={() => setOpen(false)} aria-current={active(n.href) ? "page" : undefined}
                  className={cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors lg:py-2",
                    active(n.href) ? "bg-gold/10 font-medium text-foreground" : "text-muted-foreground hover:bg-black/5 hover:text-foreground")}>
                  <n.icon className={cn("h-4 w-4", active(n.href) && "text-gold")} />
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="space-y-2 border-t border-border p-4 text-xs">
          <div>
            <p className="truncate font-medium text-foreground">{profile?.full_name}</p>
            <p className="capitalize text-muted-foreground">{role === "super_admin" ? "Zypher" : role}{myBranch ? ` · ${myBranch}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => setPwOpen(true)} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <KeyRound className="h-3.5 w-3.5" /> Password
            </button>
            <button onClick={signOut} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 px-4 pb-24 pt-[calc(4.5rem+env(safe-area-inset-top))] sm:px-6 lg:ml-64 lg:px-8 lg:pb-12 lg:pt-8">
        <div className="mx-auto max-w-6xl">
          <OfflineBanner />
          <SubscriptionBanner />
          {children}
        </div>
      </main>

      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (pw.length < 8) return toast.error("Password must be at least 8 characters.");
    if (pw !== pw2) return toast.error("Passwords do not match.");
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message || "Could not change password.");
    toast.success("Password changed.");
    setPw("");
    setPw2("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Change password"
      footer={<>
        <button className={ghostButtonClass} onClick={onClose}>Cancel</button>
        <button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Change password"}</button>
      </>}>
      <Field label="New password"><input type="password" autoComplete="new-password" className={inputClass} value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label="Repeat it"><input type="password" autoComplete="new-password" className={inputClass} value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
    </Modal>
  );
}
