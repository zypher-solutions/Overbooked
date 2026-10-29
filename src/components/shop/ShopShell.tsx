"use client";

import { PasswordField, passwordIsStrong } from "@/components/overbooked/PasswordField";
import { Suspense, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  BarChart3, Boxes, Building2, Calendar, CalendarClock, CalendarDays, CalendarPlus, ChevronDown, ClipboardList, Home, KeyRound, LayoutGrid, LineChart,
  LogOut, Menu, Plus, ScanLine, Settings, ShoppingBag, Store, Tag, Upload, Users, UserSquare, Wallet, X, type LucideIcon,
} from "lucide-react";
import { useCart } from "@/modules/clothing/cart";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { useShop } from "@/lib/shop/ShopContext";
import { OfflineBanner } from "@/components/overbooked/OfflineBanner";
import { Field, Modal, goldButtonClass, ghostButtonClass, inputClass } from "./ui";
import { SubscriptionBanner } from "./Subscription";
import { clothingNav } from "@/modules/clothing/nav";
import { standardNav, type NavGroup } from "@/lib/shop/nav";


export function ShopShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { shop, role, isSupport, isOwner, canManage, branches, myBranchId, word, feature, trendz, loading } = useShop();
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const navCtx = { isOwner, canManage, isSupport, feature, word };
  const groups: NavGroup[] = loading ? [] : trendz ? clothingNav(navCtx) : standardNav(navCtx);
  const visible = groups.map((g) => ({ ...g, items: g.items.filter((n) => n.show) })).filter((g) => g.items.length);

  const myBranch = branches.find((b) => b.id === myBranchId)?.name;
  const leave = () => (cart.count > 0 ? setConfirmSignOut(true) : void signOut());

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
            <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-gold">{isSupport ? "Zypher support" : trendz ? "Rental Studio" : "Overbooked"}</p>
          </div>
          <button aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-md p-2 hover:bg-black/5 lg:hidden"><X className="h-4 w-4" /></button>
        </div>
        <nav className="flex-1 px-3 pb-4">
          {/* which item is active depends on ?tab= too (Categories), so it reads the address in its own boundary */}
          <Suspense fallback={<NavGroups groups={visible} pathname={pathname} tab={null} onPick={() => setOpen(false)} />}>
            <NavWithTab groups={visible} pathname={pathname} onPick={() => setOpen(false)} />
          </Suspense>
        </nav>
        <div className="space-y-2 border-t border-border p-4 text-xs">
          <div>
            <p className="truncate font-medium text-foreground">{profile?.full_name}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-gold">{isSupport ? "Zypher support" : role}</p>
            <p className="text-muted-foreground">{myBranch ?? "All branches"}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => setPwOpen(true)} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <KeyRound className="h-3.5 w-3.5" /> Change password
            </button>
            <button onClick={leave} className="inline-flex items-center gap-1.5 text-rust hover:text-rust/80">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
          {trendz ? <p className="font-mono text-[10px] text-muted-foreground/70">Staff panel v2.0</p> : null}
        </div>
      </aside>

      <main className="min-w-0 px-4 pb-24 pt-[calc(4.5rem+env(safe-area-inset-top))] sm:px-6 lg:ml-64 lg:px-8 lg:pb-12 lg:pt-8">
        <div className="mx-auto max-w-6xl">
          <OfflineBanner />
          <SubscriptionBanner />
          {children}
        </div>
      </main>

      {/* the cart's way to checkout, on every screen but the booking form itself */}
      {cart.count > 0 && pathname !== "/book" ? (
        <Link href="/book" className={cn(goldButtonClass, "fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-30 px-5 py-3 text-sm shadow-xl")}>
          <ShoppingBag className="h-4 w-4" /> Checkout ({cart.count})
        </Link>
      ) : null}

      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      <Modal open={confirmSignOut} onClose={() => setConfirmSignOut(false)} title="Sign out with items in the cart?"
        description="The cart and the booking you are filling in will be discarded. Stay signed in to keep them."
        footer={<>
          <button className={ghostButtonClass} onClick={() => setConfirmSignOut(false)}>Stay signed in</button>
          <button className={goldButtonClass} onClick={() => { cart.clear(); try { sessionStorage.removeItem(`ob_booking_${shop.id}`); } catch { /* ignore */ } void signOut(); }}>Sign out</button>
        </>}>
        <span />
      </Modal>
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
              className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
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
                      className={cn("relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors lg:py-2",
                        on ? "bg-gold/10 font-medium text-foreground" : "text-muted-foreground hover:bg-black/5 hover:text-foreground")}>
                      <span className={cn("absolute bottom-1.5 left-0 top-1.5 w-[2px] rounded-full", on ? "bg-gold" : "bg-transparent")} />
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

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!passwordIsStrong(pw)) return toast.error("Follow every password rule in the list.");
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
      <PasswordField id="new-pw" label="New password" value={pw} onChange={setPw} autoComplete="new-password" rules icon={false} autoFocus />
      <PasswordField id="new-pw2" label="Repeat it" value={pw2} onChange={setPw2} autoComplete="new-password" icon={false} />
      <a href="/mfa" className="mt-3 block text-xs text-gold hover:underline">Set up two-step sign-in with an authenticator app</a>
    </Modal>
  );
}
