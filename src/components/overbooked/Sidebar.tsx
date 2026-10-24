import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { BarChart3, ClipboardList, LayoutGrid, ScanLine, Upload, ChevronDown, Plus, Tag, LogOut, KeyRound, Calendar, Building2, Users, X, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOverbooked } from "@/lib/overbooked/store";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { hasActiveRentalDraft } from "@/lib/overbooked/draftStorage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type PageKey = "scan" | "products" | "dashboard" | "rentals" | "bookings" | "stock" | "categories" | "import" | "add-product" | "branches" | "staff" | "zypher";

export function Sidebar({
  active,
  onChange,
  isOpen,
  onClose,
}: {
  active: PageKey;
  onChange: (key: PageKey) => void;
  isOpen?: boolean;
  onClose?: () => void;
}) {
  const { categories, locations, cart } = useOverbooked();
  const { profile, shop, signOut } = useAuth();
  const isZypher = profile?.role === "super_admin";
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    "Rental Management": true,
    Products: true,
  });
  
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const changePassword = async () => {
    if (pw.length < 8) return toast.error("Password must be at least 8 characters.");
    if (pw !== pw2) return toast.error("Passwords do not match.");
    setPwBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) return toast.error(error.message || "Could not change password.");
    toast.success("Password changed.");
    setPwOpen(false);
    setPw("");
    setPw2("");
  };

  const toggleGroup =(title: string) => {
    setOpenGroups((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const toggleCategory = (cat: string) => {
    setOpenCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const navGroups = [
    {
      title: "Rental Management",
      items: [
        { key: "scan" as PageKey, label: "Inventory Search", icon: ScanLine },
        { key: "bookings" as PageKey, label: "Bookings", icon: Calendar },
        { key: "rentals" as PageKey, label: "All Rentals", icon: ClipboardList },
      ],
    },
    {
      title: "Products",
      items: [
        { key: "products" as PageKey, label: "All Products", icon: LayoutGrid },
        { key: "add-product" as PageKey, label: "Add New Product", icon: Plus, managementOnly: true },
        { key: "categories" as PageKey, label: "Categories", icon: Tag, managementOnly: true },
        { key: "branches" as PageKey, label: "Branch Management", icon: Building2, ownerOnly: true },
        { key: "staff" as PageKey, label: "Staff Management", icon: Users, ownerOnly: true },
        { key: "stock" as PageKey, label: "Stock Locations", icon: LayoutGrid, ownerOnly: true },
        { key: "import" as PageKey, label: "CSV Import", icon: Upload, managementOnly: true },
      ].filter(item => {
        if ((item as any).ownerOnly) return profile?.role === "super_admin" || profile?.role === "owner";
        if ((item as any).managementOnly) return profile?.role === "super_admin" || profile?.role === "owner" || profile?.role === "manager";
        return true;
      }),
    },
  ];

  return (
    <aside className={cn(
      "fixed top-0 left-0 z-40 flex h-dvh w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar overflow-y-auto overscroll-contain transition-transform duration-300 lg:w-64 lg:translate-x-0 lg:max-w-none",
      isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
    )} aria-label="Main navigation">
      <div className="px-6 pt-7 pb-6 flex justify-between items-center">
        <div>
          <h1 className="font-display text-2xl leading-none font-semibold text-foreground">
            {shop?.name ?? "Overbooked"}
          </h1>
          <p className="mt-1.5 text-[10px] tracking-[0.22em] text-gold uppercase">
            {isZypher ? "Zypher view" : "Powered by Overbooked"}
          </p>
        </div>
        {isOpen && (
          <button onClick={onClose} aria-label="Close menu" className="lg:hidden h-11 w-11 text-muted-foreground hover:bg-black/5 rounded-full flex items-center justify-center">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex flex-col gap-4 px-3 pb-8">
        {/* Top-level standalone items */}
        <div className="flex flex-col gap-1 mb-2">
          {isZypher && (
            <button
              onClick={() => onChange("zypher")}
              aria-current={active === "zypher" ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-3 lg:py-2.5 text-sm transition-all duration-200",
                active === "zypher"
                  ? "bg-white/[0.06] text-foreground"
                  : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full transition-all duration-200",
                  active === "zypher" ? "bg-gold" : "bg-transparent",
                )}
              />
              <Store className={cn("h-4 w-4", active === "zypher" && "text-gold")} />
              Zypher Console
            </button>
          )}
          {shop && (
          <button
            onClick={() => onChange("dashboard")}
            aria-current={active === "dashboard" ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-md px-3 py-3 lg:py-2.5 text-sm transition-all duration-200",
              active === "dashboard"
                ? "bg-white/[0.06] text-foreground"
                : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full transition-all duration-200",
                active === "dashboard" ? "bg-gold" : "bg-transparent",
              )}
            />
            <BarChart3 className={cn("h-4 w-4", active === "dashboard" && "text-gold")} />
            Dashboard
          </button>
          )}
        </div>

        {shop && navGroups.map((group) => {
          const isOpen = openGroups[group.title];
          return (
            <div key={group.title} className="flex flex-col">
              <button
                onClick={() => toggleGroup(group.title)}
                className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                {group.title}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-200",
                    isOpen ? "rotate-180" : ""
                  )}
                />
              </button>
              
              <div
                className={cn(
                  "flex flex-col gap-1 overflow-hidden transition-all duration-200",
                  isOpen ? "mt-1 opacity-100" : "max-h-0 opacity-0"
                )}
                style={{ maxHeight: isOpen ? "1000px" : "0px" }}
              >
                {group.items.map((item) => {
                  const isActive = item.key === active;
                  return (
                    <button
                      key={item.key}
                      onClick={() => onChange(item.key)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-md px-3 py-3 lg:py-2.5 text-sm transition-all duration-200",
                        isActive
                          ? "bg-white/[0.06] text-foreground"
                          : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full transition-all duration-200",
                          isActive ? "bg-gold" : "bg-transparent",
                        )}
                      />
                      <item.icon className={cn("h-4 w-4", isActive && "text-gold")} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="mt-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-[11px] leading-relaxed text-muted-foreground">
        {profile ? (
          <div className="mb-4">
            <p className="text-foreground/80 font-medium">{profile.full_name}</p>
            <p className="mt-1 uppercase tracking-widest text-[9px] text-gold">{isZypher ? "Zypher" : profile.role}</p>
            <p className="mt-1 text-muted-foreground/80">
              {(profile.role === "super_admin" || profile.role === "owner")
                ? "All Branches" 
                : (locations.find(l => l.id === profile.branch_id)?.name || "Loading Branch...")}
            </p>
            <button
              onClick={() => setPwOpen(true)}
              className="mt-3 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Change password
            </button>
            <button
              onClick={() => (cart.length > 0 || hasActiveRentalDraft(profile.id) ? setConfirmSignOut(true) : signOut())}
              className="mt-3 flex items-center gap-2 text-rust hover:text-rust/80 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </div>
        ) : (
          <div className="mb-4">
            <p className="text-foreground/80 font-medium">Loading Profile...</p>
          </div>
        )}
        <p className="mt-3 font-mono text-[10px] text-muted-foreground/70">
          Staff panel v1.1
        </p>
      </div>
      <AlertDialog open={confirmSignOut} onOpenChange={setConfirmSignOut}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out with an unfinished booking?</AlertDialogTitle>
            <AlertDialogDescription>
              The booking you are filling in will be discarded. Stay signed in to keep it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay signed in</AlertDialogCancel>
            <AlertDialogAction onClick={signOut}>Sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={pwOpen} onOpenChange={setPwOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change password</AlertDialogTitle>
            <AlertDialogDescription>Use at least 8 characters.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2">
            <Input type="password" autoComplete="new-password" placeholder="New password" aria-label="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <Input type="password" autoComplete="new-password" placeholder="Confirm new password" aria-label="Confirm new password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pwBusy} onClick={(e) => { e.preventDefault(); void changePassword(); }}>Change password</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
