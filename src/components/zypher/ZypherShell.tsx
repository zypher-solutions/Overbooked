"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Store,
  Wallet,
  Layers,
  ScrollText,
  LogOut,
  Menu,
  Settings,
  Users,
  X,
  ChevronDown,
  Settings2,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV_GROUPS = [
  {
    title: "Operations",
    items: [
      {
        href: "/zypher",
        label: "Overview",
        icon: LayoutDashboard,
        exact: true,
      },
      { href: "/zypher/shops", label: "Shops", icon: Store, exact: true },
      { href: "/zypher/billing", label: "Billing", icon: Wallet },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/zypher/templates", label: "Business types", icon: Layers },
      { href: "/zypher/audit", label: "Audit log", icon: ScrollText },
      { href: "/zypher/team", label: "Zypher team", icon: Users },
      { href: "/zypher/settings", label: "Settings", icon: Settings },
    ],
  },
];
const NAV = NAV_GROUPS.flatMap((group) => group.items);

export function ZypherShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const isActive = (item: (typeof NAV)[number]) =>
    item.exact
      ? pathname === item.href ||
        (item.href === "/zypher/shops" &&
          /^\/zypher\/shops\/(?!new$)[^/]+$/.test(pathname))
      : pathname.startsWith(item.href);

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="px-5 pb-4 pt-6">
        <p className="font-display text-xl font-semibold text-foreground">
          Zypher
        </p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          Overbooked console
        </p>
      </div>
      <div className="flex-1 space-y-5 px-3">
        {NAV_GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h2 className="mb-1 px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
              {group.title}
            </h2>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(item) ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150",
                      isActive(item)
                        ? "bg-gold/10 font-medium text-foreground"
                        : "text-muted-foreground hover:bg-black/5 hover:text-foreground",
                    )}
                  >
                    <item.icon
                      className={cn("h-4 w-4", isActive(item) && "text-gold")}
                    />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="border-t border-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Open profile menu"
              className="group flex min-h-12 w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors duration-150 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gold/25 bg-gold/10 text-gold">
                <UserRound className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {profile?.full_name?.trim() || "Account holder"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  Zypher team
                </span>
              </span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                aria-hidden="true"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-56"
          >
            <DropdownMenuItem asChild className="min-h-10">
              <Link href="/zypher/settings" onClick={() => setOpen(false)}>
                <Settings2 aria-hidden="true" /> Account settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setConfirmSignOut(true)}
              className="min-h-10 text-rust focus:text-rust"
            >
              <LogOut aria-hidden="true" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-x-0 top-0 z-20 flex min-h-14 items-center border-b border-border bg-surface px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <button
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-md hover:bg-black/5"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="ml-2 font-display font-semibold">Zypher console</span>
      </div>
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 border-r border-border bg-sidebar transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="absolute right-2 top-3 rounded-md p-2 hover:bg-black/5 lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
        {nav}
      </aside>
      <main className="min-w-0 px-4 pb-16 pt-[calc(4.5rem+env(safe-area-inset-top))] sm:px-6 lg:ml-64 lg:px-8 lg:pt-8">
        <div className="mx-auto max-w-[1480px]">{children}</div>
      </main>
      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out of Overbooked?"
        message="You will be signed out of this device. You can sign in again at any time."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        tone="danger"
        onConfirm={() => {
          setConfirmSignOut(false);
          void signOut();
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}
