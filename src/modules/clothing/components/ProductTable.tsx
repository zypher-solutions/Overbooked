"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { errorText, rupees } from "@/lib/shop/format";
import { headlinePrice } from "@/lib/shop/useCatalog";
import type { Product, Unit } from "@/lib/shop/types";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { Empty, StatusBadge, ghostButtonClass, tableWrap, theadClass } from "@/components/shop/ui";

// All Products, as in TRENDZ: one row per product with its variations, rate, stock and branches
export function ProductTable({ list, units, loading, reload }: { list: Product[]; units: Pick<Unit, "variation_id" | "branch_id" | "status">[]; loading: boolean; reload: () => Promise<void> }) {
  const { categories, activeBranches, canManage, isOwner } = useShop();
  const [deleting, setDeleting] = useState<Product | null>(null);
  const reactivate = async (p: Product) => {
    try {
      await call("reactivate_product", { p_product_id: p.id });
      toast.success(`${p.name} is active again`);
      await reload();
    } catch (e) { toast.error(errorText(e)); }
  };
  const remove = async (p: Product) => {
    try {
      const res = await call<{ result: string }>("delete_or_deactivate_product", { p_product_id: p.id });
      toast.success(res.result === "deleted" ? "Deleted" : "Switched off (it has rental history)");
      await reload();
    } catch (e) { toast.error(errorText(e)); }
  };
  const actions = (p: Product, full = false) => (
    <span className={cn("flex flex-wrap items-center gap-2", full ? "mt-auto border-t border-border/50 pt-2" : "justify-end")}>
      <Link href={`/catalog/${p.id}`} className={cn(ghostButtonClass, full && "flex-1")}>{canManage ? "Edit" : "View"}</Link>
      {canManage && !p.is_active ? <button className={ghostButtonClass} onClick={() => void reactivate(p)}>Reactivate</button> : null}
      {isOwner ? <button className={dangerIconClass} title="Delete product" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}><Trash2 className="h-4 w-4" /></button> : null}
    </span>
  );
  const byVariation = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const u of units) {
      if (u.status === "retired") continue;
      const b = m.get(u.variation_id) ?? new Map<string, number>();
      b.set(u.branch_id, (b.get(u.branch_id) ?? 0) + 1);
      m.set(u.variation_id, b);
    }
    return m;
  }, [units]);
  const perBranch = (p: Product, branchId: string) => (p.product_variations ?? []).reduce((s, v) => s + (byVariation.get(v.id)?.get(branchId) ?? 0), 0);

  const rateText = (p: Product) => {
    const rates = (p.product_variations ?? []).filter((v) => v.is_enabled).map((v) => headlinePrice(v)?.amount).filter((x): x is number => x !== undefined);
    if (!rates.length) return <span className="text-rust">No price</span>;
    return Math.min(...rates) === Math.max(...rates) ? rupees(rates[0]) : `${rupees(Math.min(...rates))} – ${rupees(Math.max(...rates))}`;
  };

  return (
    <>
    <div className={cn(tableWrap, "hidden xl:block")}>
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className={theadClass}>
          <tr>
            <th className="w-14 px-4 py-3" /><th className="px-4 py-3">Name</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Variations</th>
            <th className="px-4 py-3">Daily rate</th><th className="px-4 py-3 text-right">Total stock</th><th className="px-4 py-3">Branches</th>
            <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {loading ? <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
            : list.length === 0 ? <tr><td colSpan={9}><Empty>No products yet. Add one with Add New Product.</Empty></td></tr>
            : list.map((p) => {
              const vars = (p.product_variations ?? []).filter((v) => v.is_enabled);
              const rates = vars.map((v) => headlinePrice(v)?.amount).filter((x): x is number => x !== undefined);
              const total = activeBranches.reduce((s, b) => s + perBranch(p, b.id), 0);
              return (
                <tr key={p.id} className="hover:bg-black/[0.02]">
                  <td className="px-4 py-2">{p.image_url ? <img src={p.image_url} alt="" className="h-10 w-10 rounded object-cover" /> : null}</td>
                  <td className="px-4 py-2">
                    <Link href={`/catalog/${p.id}`} className="font-medium hover:text-gold">{p.name}</Link>
                    <span className="block font-mono text-xs text-muted-foreground">{p.sku}</span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{categories.find((c) => c.id === p.category_id)?.name}</td>
                  <td className="px-4 py-2">{p.is_set ? <StatusBadge tone="indigo">Set</StatusBadge> : vars.length}</td>
                  <td className="px-4 py-2 font-mono text-gold">{rates.length ? (Math.min(...rates) === Math.max(...rates) ? rupees(rates[0]) : `${rupees(Math.min(...rates))} – ${rupees(Math.max(...rates))}`) : <span className="text-rust">No price</span>}</td>
                  <td className="px-4 py-2 text-right font-mono">{p.is_set ? "—" : total}</td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap gap-1">
                      {activeBranches.map((b) => <span key={b.id} className="rounded-md border border-border px-1.5 py-0.5 text-[10px]">{b.name} {perBranch(p, b.id)}</span>)}
                    </span>
                  </td>
                  <td className="px-4 py-2"><StatusBadge tone={p.is_active ? "emerald" : "rust"}>{p.is_active ? "Active" : "Inactive"}</StatusBadge></td>
                  <td className="px-4 py-2 text-right">{actions(p)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:hidden">
      {loading ? <p className="col-span-full py-6 text-center text-sm text-muted-foreground">Loading...</p>
        : list.length === 0 ? <div className="col-span-full"><Empty>No products yet. Add one with Add New Product.</Empty></div>
        : list.map((p) => {
          const total = activeBranches.reduce((s, b) => s + perBranch(p, b.id), 0);
          return (
            <div key={p.id} className="glass flex flex-col rounded-xl p-4">
              <div className="mb-3 flex gap-4">
                {p.image_url ? <img src={p.image_url} alt="" className="h-16 w-16 shrink-0 rounded-md border border-border object-cover" /> : <span className="h-16 w-16 shrink-0 rounded-md border border-border bg-muted/60" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate font-semibold">{p.name}</h3>
                    <StatusBadge tone={p.is_active ? "emerald" : "rust"}>{p.is_active ? "Active" : "Inactive"}</StatusBadge>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{p.sku}</p>
                  <p className="mt-1 font-mono text-sm font-medium text-gold">{rateText(p)}</p>
                </div>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/70 p-2.5 text-xs">
                <div><p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Category</p><p className="font-medium text-gold">{categories.find((c) => c.id === p.category_id)?.name ?? "Uncategorized"}</p></div>
                <div className="text-right"><p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Stock</p><p className={cn("font-medium", total > 0 ? "text-emerald" : "text-rust")}>{p.is_set ? "Set" : total > 0 ? `${total} units` : "Out of stock"}</p></div>
                <div className="col-span-2 flex items-start justify-between border-t border-border pt-2">
                  <div className="flex flex-wrap gap-1">
                    {activeBranches.map((b) => <span key={b.id} className="rounded-md border border-border px-1.5 py-0.5 text-[10px]">{b.name} {perBranch(p, b.id)}</span>)}
                  </div>
                  <span className="text-muted-foreground">{p.is_set ? "" : `${(p.product_variations ?? []).filter((v) => v.is_enabled).length} variations`}</span>
                </div>
              </div>
              {actions(p, true)}
            </div>
          );
        })}
    </div>
    <ConfirmDialog open={!!deleting} tone="danger" title={`Delete ${deleting?.name ?? "this product"}?`} confirmLabel="Delete" cancelLabel="Keep it" message="If it has rental or booking history it will be switched off instead of deleted."
      onCancel={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting); setDeleting(null); }} />
    </>
  );
}

const dangerIconClass = "inline-flex items-center justify-center rounded-md border border-rust/40 bg-rust/10 p-2 text-rust transition-colors hover:bg-rust/15";
