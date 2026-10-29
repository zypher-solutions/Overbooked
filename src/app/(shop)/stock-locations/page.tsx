"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { ChevronDown, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import { useCatalog, variationLabel } from "@/lib/shop/useCatalog";
import { useStock } from "@/components/shop/StockCard";
import { PageHeader, Panel, StatusBadge, ghostButtonClass, tableWrap, theadClass } from "@/components/shop/ui";

// Stock Locations, as in TRENDZ: each branch with its contact details and how many pieces it holds,
// free, out, in service or lost; open a branch to see the count of every item there.
export default function StockLocationsPage() {
  const { role } = useShop();
  return role === "super_admin" ? <SetupStockLocations /> : <StockLocations />;
}

// Zypher's setup view: how many pieces each branch holds. Counts only, no bookings, customers or prices.
function SetupStockLocations() {
  const { branches } = useShop();
  const [counts, setCounts] = useState<Map<string, { pieces: number; available: number; maintenance: number; lost: number }> | null>(null);
  useEffect(() => {
    void createClient().rpc("setup_branch_stock").then(({ data }) => {
      setCounts(new Map(((data ?? []) as { branch_id: string; pieces: number; available: number; maintenance: number; lost: number }[]).map((r) => [r.branch_id, { pieces: Number(r.pieces), available: Number(r.available), maintenance: Number(r.maintenance), lost: Number(r.lost) }])));
    });
  }, []);
  return (
    <>
      <PageHeader title="Stock Locations" subtitle="Where this shop keeps its pieces (counts only)"
        actions={<Link href="/branches" className={ghostButtonClass}>Edit branches</Link>} />
      <div className={tableWrap}>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className={theadClass}>
            <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3 text-right">Pieces</th>
              <th className="px-4 py-3 text-right">In service</th><th className="px-4 py-3 text-right">Lost</th><th className="px-4 py-3">Enabled</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {branches.map((b) => {
              const c = counts?.get(b.id);
              return (
                <tr key={b.id}>
                  <td className="px-4 py-2 font-medium">{b.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{b.phone ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono">{counts ? c?.pieces ?? 0 : "…"}</td>
                  <td className="px-4 py-2 text-right font-mono">{c?.maintenance || ""}</td>
                  <td className="px-4 py-2 text-right font-mono text-rust">{c?.lost || ""}</td>
                  <td className="px-4 py-2"><StatusBadge tone={b.is_active ? "emerald" : "rust"}>{b.is_active ? "Active" : "Inactive"}</StatusBadge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StockLocations() {
  const { role, isSupport, branches } = useShop();
  const { stock } = useStock();
  const { products } = useCatalog({ includeInactive: true });
  const [openId, setOpenId] = useState<string | null>(null);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products ?? []) for (const v of p.product_variations ?? []) m.set(v.id, variationLabel(p, v));
    return m;
  }, [products]);
  const rows = useMemo(() => Array.from(stock?.values() ?? []), [stock]);
  const totals = (branchId: string) => rows.filter((r) => r.branch_id === branchId).reduce((t, r) => ({
    total: t.total + r.total, free: t.free + r.available_now, out: t.out + r.out_now, service: t.service + Number(r.maintenance), lost: t.lost + Number(r.lost),
  }), { total: 0, free: 0, out: 0, service: 0, lost: 0 });

  if (!isSupport) return <Panel><p className="text-sm text-muted-foreground">Stock locations are set up by the Zypher team.</p></Panel>;

  return (
    <>
      <PageHeader title="Stock Locations" subtitle="Where every piece is kept"
        actions={<>
          <Link href="/print/tags" className={ghostButtonClass}><QrCode className="h-4 w-4" /> Print tags</Link>
          <Link href="/branches" className={ghostButtonClass}>Edit branches</Link>
        </>} />
      <div className={tableWrap}>
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className={theadClass}>
            <tr>
              <th className="px-4 py-3">Name</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Address</th>
              <th className="px-4 py-3 text-right">Pieces</th><th className="px-4 py-3 text-right">Free</th><th className="px-4 py-3 text-right">Out</th>
              <th className="px-4 py-3 text-right">Service</th><th className="px-4 py-3 text-right">Lost</th><th className="px-4 py-3">Enabled</th><th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {branches.map((b) => {
              const t = totals(b.id);
              const open = openId === b.id;
              const items = rows.filter((r) => r.branch_id === b.id).sort((x, y) => (names.get(x.variation_id) ?? "").localeCompare(names.get(y.variation_id) ?? ""));
              return [
                <tr key={b.id}>
                  <td className="px-4 py-2 font-medium">{b.name}{b.email ? <span className="block text-xs font-normal text-muted-foreground">{b.email}</span> : null}</td>
                  <td className="px-4 py-2 font-mono text-xs">{b.phone ?? "—"}</td>
                  <td className="max-w-[14rem] truncate px-4 py-2 text-muted-foreground">{b.address ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono">{stock ? t.total : "…"}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald">{stock ? t.free : ""}</td>
                  <td className="px-4 py-2 text-right font-mono text-gold">{stock ? t.out : ""}</td>
                  <td className="px-4 py-2 text-right font-mono">{t.service || ""}</td>
                  <td className="px-4 py-2 text-right font-mono text-rust">{t.lost || ""}</td>
                  <td className="px-4 py-2"><StatusBadge tone={b.is_active ? "emerald" : "rust"}>{b.is_active ? "Active" : "Inactive"}</StatusBadge></td>
                  <td className="px-4 py-2 text-right">
                    <button className={cn(ghostButtonClass, "px-2 py-1 text-xs")} aria-expanded={open} onClick={() => setOpenId(open ? null : b.id)}>
                      Items <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
                    </button>
                  </td>
                </tr>,
                open ? (
                  <tr key={b.id + "-items"}>
                    <td colSpan={10} className="bg-muted/30 px-4 py-3">
                      {items.length === 0 ? <p className="text-sm text-muted-foreground">No pieces in this branch yet.</p> : (
                        <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                          {items.map((r) => (
                            <li key={r.variation_id} className="flex justify-between gap-2 rounded border border-border bg-surface px-2 py-1">
                              <span className="truncate">{names.get(r.variation_id) ?? "…"}</span>
                              <span className="shrink-0 font-mono text-xs"><span className="text-emerald">{r.available_now}</span> / {r.total}{r.out_now ? <span className="text-gold"> · {r.out_now} out</span> : null}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Free / total pieces right now. To add or remove pieces, open the product in All Products.</p>
    </>
  );
}
