"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  BarChart3, Boxes, Building2, Calendar, CalendarClock, CalendarDays, CalendarPlus, ChevronDown, ClipboardList, Home, LayoutGrid, LineChart,
  LifeBuoy, LogOut, MapPin, Menu, Plus, ScanLine, Settings2, ShoppingBag, Store, Tag, Upload, Users, UserRound, Wallet, X, type LucideIcon,
} from "lucide-react";
import { useCart } from "@/modules/clothing/cart";
import { CartSwitcher } from "@/modules/clothing/components/CartSwitcher";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { useShop } from "@/lib/shop/ShopContext";
import { OfflineBanner } from "@/components/overbooked/OfflineBanner";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusBadge, ghostButtonClass, goldButtonClass } from "./ui";
import { createClient } from "@/lib/supabase/client";

// a Zypher admin visiting this shop as support goes back to the console
async function leaveSupport() {
  const { error } = await createClient().rpc("leave_support");
  if (error) return void toast.error("Could not leave the shop. Check your connection and try again.");
  window.location.href = "/zypher";
}
import { SubscriptionBanner } from "./Subscription";
import { shopModules } from "@/modules/registry";
import type { NavGroup } from "@/lib/shop/nav";


export function ShopShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, user, signOut } = useAuth();
  const { shop, role, isSupport, isOwner, canManage, branches, myBranchId, word, feature, businessModule, loading } = useShop();
  const mod = shopModules[businessModule];

  // An error or warning is about the page it came from: it is cleared when the person moves to another page
  // (otherwise "Enter the product name." follows them to Inventory Search). Confirmations stay.
  useEffect(() => {
    for (const t of toast.getToasts()) if ("type" in t && (t.type === "error" || t.type === "warning")) toast.dismiss(t.id);
  }, [pathname]);

  // Each kind of shop has its own screens. Typing the address of the other kind's screen goes to the right one,
  // so a bridal shop never lands on the old lists and a car shop never lands on the clothing screens.
  useEffect(() => {
    if (loading) return;
    const otherModules = Object.values(shopModules).filter((m) => m !== mod);
    const to = mod.replace?.(pathname, canManage) ?? (otherModules.some((m) => m.screens.includes(pathname)) ? "/" : null);
    if (to) router.replace(to);
  }, [loading, mod, canManage, pathname, router]);
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const navCtx = { isOwner, canManage, isSupport, feature, word };
  const groups: NavGroup[] = loading ? [] : mod.nav(navCtx);
  const visible = groups.map((g) => ({ ...g, items: g.items.filter((n) => n.show) })).filter((g) => g.items.length);
  // a page hidden from this person's menu (typed or left open in the address bar) sends them to Today;
  // the database refuses its data anyway, this keeps the screen itself away
  const hiddenHere = groups.some((g) => g.items.some((n) => !n.show && n.href === pathname))
    && !visible.some((g) => g.items.some((n) => n.href === pathname));
  useEffect(() => { if (hiddenHere) router.replace("/"); }, [hiddenHere, router]);

  const myBranch = myBranchId
    ? branches.find((b) => b.id === myBranchId)?.name ?? (loading ? "Loading branch…" : "Branch unavailable")
    : role === "staff" || role === "manager" ? "Branch not assigned" : "All branches";

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-x-0 top-0 z-20 flex min-h-14 items-center border-b border-border bg-surface px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-md hover:bg-black/5">
          <Menu className="h-5 w-5" />
        </button>
        <span className="ml-2 truncate font-display font-semibold">{shop.name}</span>
      </div>
      {open ? <div className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} /> : null}

      <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-64 max-w-[85vw] flex-col overflow-y-auto no-scrollbar border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform lg:translate-x-0",
        open ? "translate-x-0 shadow-2xl" : "-translate-x-full")} aria-label="Main navigation">
        <div className="flex items-start justify-between px-5 pb-4 pt-6">
          <div className="min-w-0">
            <p className="truncate font-display text-xl font-semibold text-foreground">{shop.name}</p>
            <p className="mt-1 text-xs font-medium text-muted-foreground">{isSupport ? "Zypher support" : mod.tagline}</p>
          </div>
          <button aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-md p-2 hover:bg-black/5 lg:hidden"><X className="h-4 w-4" /></button>
        </div>
        <nav className="flex-1 px-3 pb-4">
          {/* which item is active depends on ?tab= too (Categories), so it reads the address in its own boundary */}
          <Suspense fallback={<NavGroups groups={visible} pathname={pathname} tab={null} onPick={() => setOpen(false)} />}>
            <NavWithTab groups={visible} pathname={pathname} onPick={() => setOpen(false)} />
          </Suspense>
        </nav>
        <div className="space-y-3 border-t border-sidebar-border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Open profile menu"
                className={cn("group block w-full min-w-0 rounded-xl border border-sidebar-border bg-surface p-3 text-left transition-colors hover:border-gold/35 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold data-[state=open]:border-gold/35 data-[state=open]:bg-sidebar-accent",
                  pathname === "/account" && "border-gold/35 bg-sidebar-accent")}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sidebar-accent text-gold">
                    <UserRound className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{profile?.full_name?.trim() || "Account holder"}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{user?.phone?.trim() || "Phone not set"}</span>
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
                </span>
                <span className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-sidebar-border pt-2">
                  <StatusBadge tone="accent" className="capitalize">{isSupport ? "Zypher support" : role.replace("_", " ")}</StatusBadge>
                  <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">{myBranch}</span>
                  </span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-56">
              <DropdownMenuItem asChild className="min-h-10">
                <Link href="/account" onClick={() => setOpen(false)} aria-current={pathname === "/account" ? "page" : undefined}>
                  <Settings2 aria-hidden="true" /> Account settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setConfirmSignOut(true)} className="min-h-10 text-rust focus:text-rust">
                <LogOut aria-hidden="true" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="px-1 text-xs text-muted-foreground">Overbooked <span className="tabular-nums">v0.1.0</span></p>
        </div>
      </aside>

      <main className="min-w-0 px-4 pb-24 pt-[calc(4.5rem+env(safe-area-inset-top))] sm:px-6 lg:ml-64 lg:px-8 lg:pb-12 lg:pt-8">
        <div className="mx-auto max-w-[1480px]">
          <OfflineBanner />
          {profile?.role === "super_admin" ? (
            <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm">
              <span className="flex min-w-0 items-center gap-2"><LifeBuoy className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                You are in {shop.name} as Zypher support. The owner can see this in their activity log.</span>
              <button type="button" onClick={() => void leaveSupport()} className={cn(ghostButtonClass, "min-h-9")}>Leave shop</button>
            </div>
          ) : null}
          <SubscriptionBanner />
          {hiddenHere ? null : children}
        </div>
      </main>

      {cart.ready && !loading && pathname !== "/book" && pathname !== "/checkout" && (businessModule === "clothing" || cart.count > 0) ? (
        <div className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-30 flex max-w-[calc(100vw-2.5rem)] items-center gap-1.5 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          {businessModule === "clothing" ? <CartSwitcher /> : null}
          <Link href={businessModule === "clothing" ? "/checkout" : "/book"} className={cn(goldButtonClass, "min-h-11 shrink-0")}>
            <ShoppingBag className="h-4 w-4" aria-hidden="true" /> Checkout{cart.count > 0 ? ` (${cart.count})` : ""}
          </Link>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out of Overbooked?"
        message={businessModule === "clothing" || cart.count > 0
          ? "Your open carts and checkout details will be cleared from this device when you sign out."
          : "You will be signed out of this device. You can sign in again at any time."}
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        tone="danger"
        onConfirm={() => { void signOut(); }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}

function NavWithTab(props: { groups: NavGroup[]; pathname: string; onPick: () => void }) {
  const tab = useSearchParams().get("tab");
  return <NavGroups {...props} tab={tab} />;
}

function NavGroups({ groups, pathname, tab, onPick }: { groups: NavGroup[]; pathname: string; tab: string | null; onPick: () => void }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  // the most specific item wins: /catalog/new is "Add New Product", not "All Products"
  const all = groups.flatMap((g) => g.items);
  const score = (href: string) => {
    const [path, query] = href.split("?");
    if (query) return pathname === path && tab === new URLSearchParams(query).get("tab") ? path.length + 1 : -1;
    if (path === "/") return pathname === "/" ? 1 : -1;
    return (pathname === path || pathname.startsWith(path + "/")) && !(path === "/catalog" && tab) ? path.length : -1;
  };
  const best = all.reduce<{ href: string; s: number }>((b, n) => { const s = score(n.href); return s > b.s ? { href: n.href, s } : b; }, { href: "", s: -1 });

  return (
    <div className="space-y-3">
      {groups.map((g, gi) => (
        <div key={g.title ?? gi}>
          {g.title ? (
            <button type="button" onClick={() => setClosed((c) => ({ ...c, [g.title!]: !c[g.title!] }))} aria-expanded={!closed[g.title]}
              className="flex w-full items-center justify-between px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground transition-colors duration-150 hover:text-foreground">
              {g.title}
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !closed[g.title] && "rotate-180")} />
            </button>
          ) : null}
          {g.title && closed[g.title] ? null : (
            <ul className="space-y-0.5">
              {g.items.map((n) => {
                const on = best.href === n.href;
                return (
                  <li key={n.href}>
                    <Link href={n.href} onClick={onPick} aria-current={on ? "page" : undefined}
                      className={cn("relative flex items-center gap-3 min-h-10 rounded-lg px-3 py-2.5 text-sm transition-colors duration-150 lg:py-2",
                        on ? "bg-gold/10 font-semibold text-foreground" : "text-muted-foreground hover:bg-black/5 hover:text-foreground")}>
                      <n.icon className={cn("h-4 w-4", on && "text-gold")} />
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
