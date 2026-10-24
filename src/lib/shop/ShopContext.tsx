"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth, type Shop } from "@/lib/overbooked/AuthContext";
import { DEFAULT_TZ } from "./format";
import type { AddOn, Branch, Category, Role, Template } from "./types";

// What every shop screen needs and rarely changes: the shop, who is signed in, branches,
// categories with their business types, extras. Loaded once; screens call refresh() after edits.
interface ShopContextValue {
  shop: Shop;
  role: Role;
  /** the signed-in person's branch (managers and staff); null for owners and Zypher */
  myBranchId: string | null;
  canManage: boolean; // owner, manager, Zypher
  isOwner: boolean; // owner or Zypher
  tz: string;
  branches: Branch[];
  activeBranches: Branch[];
  categories: Category[];
  templates: Template[];
  addOns: AddOn[];
  templateOf: (categoryId: string | null | undefined) => Template | undefined;
  feature: (key: string) => boolean;
  /** shop-level policy with a default */
  setting: <T>(key: string, fallback: T) => T;
  /** wording for the whole shop: one business type uses its own words, mixed shops use neutral ones */
  word: (key: "item" | "items" | "unit" | "units" | "start" | "end", fallback?: string) => string;
  loading: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<ShopContextValue | null>(null);

const NEUTRAL: Record<string, string> = { item: "Item", items: "Items", unit: "Unit", units: "Units", start: "Pickup", end: "Return" };

export function ShopProvider({ children }: { children: ReactNode }) {
  const { profile, shop } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [b, c, t, a] = await Promise.all([
      supabase.from("branches").select("id, name, slug, is_active, phone, address, email").order("created_at"),
      supabase.from("categories").select("id, name, template_key, sku_prefix").order("name"),
      supabase.from("business_templates").select("*").order("sort"),
      supabase.from("add_ons").select("id, name, basis, amount, template_keys, is_active").order("name"),
    ]);
    const err = b.error ?? c.error ?? t.error ?? a.error;
    if (err) toast.error("Could not load the shop setup: " + err.message);
    setBranches((b.data as Branch[]) ?? []);
    setCategories((c.data as Category[]) ?? []);
    setTemplates((t.data as Template[]) ?? []);
    setAddOns(((a.data as AddOn[]) ?? []).map((x) => ({ ...x, amount: Number(x.amount) })));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (shop?.id) void refresh();
  }, [shop?.id, refresh]);

  const value = useMemo<ShopContextValue | null>(() => {
    if (!shop || !profile) return null;
    const role = profile.role as Role;
    const shopTemplates = templates.filter((t) => shop.business_types.includes(t.key));
    const templateOf = (categoryId: string | null | undefined) => {
      const cat = categories.find((c) => c.id === categoryId);
      return templates.find((t) => t.key === cat?.template_key);
    };
    const feature = (key: string) => {
      const own = shop.settings?.features?.[key];
      if (typeof own === "boolean") return own;
      return shopTemplates.some((t) => t.features?.[key] === true);
    };
    const setting = <T,>(key: string, fallback: T): T => (shop.settings?.[key] ?? fallback) as T;
    const word = (key: keyof typeof NEUTRAL, fallback?: string) => {
      const labels = shopTemplates.map((t) => t.labels?.[key]).filter(Boolean);
      return labels.length > 0 && labels.every((l) => l === labels[0]) ? labels[0] : fallback ?? NEUTRAL[key];
    };
    return {
      shop,
      role,
      myBranchId: role === "manager" || role === "staff" ? profile.branch_id : null,
      canManage: role !== "staff",
      isOwner: role === "owner" || role === "super_admin",
      tz: shop.timezone || DEFAULT_TZ,
      branches,
      activeBranches: branches.filter((b) => b.is_active),
      categories,
      templates: shopTemplates,
      addOns,
      templateOf,
      feature,
      setting,
      word,
      loading,
      refresh,
    };
  }, [shop, profile, branches, categories, templates, addOns, loading, refresh]);

  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShop() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShop must be used inside the shop app");
  return v;
}
