"use client";

import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { errorText, rupees } from "@/lib/shop/format";
import { useCatalog } from "@/lib/shop/useCatalog";
import { Empty, PageHeader, Panel, StatusBadge, ghostButtonClass, inputClass, ListSkeleton, tableWrap, theadClass } from "@/components/shop/ui";
import { downloadSheet } from "../sheet";

// Earnings by product: how often each product went out, what it earned, and whether it has paid back what it cost.
// Counted as on a product's Business figures tab: picked-up bookings, and line amounts of returned ones.
type Figures = { times: number; earned: number };
type Sort = "earned" | "times" | "payback" | "name";

export default function ProductEarnings() {
  const { categories, canManage } = useShop();
  const { products } = useCatalog({ includeInactive: true });
  const [figures, setFigures] = useState<Map<string, Figures> | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState<Sort>("earned");

  useEffect(() => {
    void createClient().rpc("product_earnings" as never).then(({ data, error }) => {
      if (error) { setFailed(true); return; }
      const rows = (data ?? []) as { product_id: string; times_rented: number; earned: number }[];
      setFigures(new Map(rows.map((r) => [r.product_id, { times: Number(r.times_rented), earned: Number(r.earned) }])));
    });
  }, []);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (products ?? []).filter((p) => !p.is_set && (!cat || p.category_id === cat) && (!term || `${p.name} ${p.sku}`.toLowerCase().includes(term)))
      .map((p) => {
        const f = figures?.get(p.id) ?? { times: 0, earned: 0 };
        const cost = Number(p.purchase_price) || 0;
        return { p, ...f, cost, payback: cost > 0 ? f.earned / cost : null };
      });
    const by: Record<Sort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      earned: (a, b) => b.earned - a.earned, times: (a, b) => b.times - a.times,
      payback: (a, b) => (b.payback ?? -1) - (a.payback ?? -1), name: (a, b) => a.p.name.localeCompare(b.p.name),
    };
    return list.sort(by[sort]);
  }, [products, figures, q, cat, sort]);
  const total = rows.reduce((s, r) => s + r.earned, 0);
  const paidBack = rows.filter((r) => r.payback !== null && r.payback >= 1).length;
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";

  const exportRows = async () => {
    try {
      await downloadSheet(`earnings-${new Date().toISOString().slice(0, 10)}.xlsx`,
        ["Product", "SKU", "Category", "Times rented", "Earned", "Purchase price", "Earned back (%)"],
        rows.map((r) => [r.p.name, r.p.sku, catName(r.p.category_id), r.times, r.earned, r.cost || "", r.payback === null ? "" : Math.round(r.payback * 100)]), "Earnings");
    } catch (e) { toast.error(errorText(e)); }
  };

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Only owners and managers can see earnings.</p></Panel>;
  return (
    <>
      <PageHeader title="Earnings by product" subtitle="Times rented and money earned for every product, and whether it has paid back its purchase price."
        actions={<button className={ghostButtonClass} disabled={!figures || !products} onClick={() => void exportRows()}><FileSpreadsheet className="h-4 w-4" /> Export to Excel</button>} />

      {failed ? (
        <Panel><p role="alert" className="text-sm text-muted-foreground">The earnings could not be loaded. If this is the first time, the database update for this report (migration 029) may not be applied yet.</p></Panel>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Stat label="Earned (returned rentals)" value={figures ? rupees(total) : "…"} />
            <Stat label="Products rented at least once" value={figures ? String(rows.filter((r) => r.times > 0).length) : "…"} />
            <Stat label="Paid for themselves" value={figures ? `${paidBack} of ${rows.filter((r) => r.cost > 0).length} with a purchase price` : "…"} />
          </div>
          <div className="glass mb-3 flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input className={cn(inputClass, "pl-9")} placeholder="Search by name or SKU" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.length > 1 ? (
                <select className={cn(inputClass, "w-auto")} aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
                  <option value="">All categories</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : null}
              <select className={cn(inputClass, "w-auto")} aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="earned">Most earned first</option><option value="times">Most rented first</option>
                <option value="payback">Best paid back first</option><option value="name">By name</option>
              </select>
            </div>
          </div>
          {products === null || figures === null ? <ListSkeleton /> : rows.length === 0 ? <Panel><Empty>No products match.</Empty></Panel> : (
            <div className={tableWrap}>
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className={theadClass}>
                  <tr>
                    <th className="px-4 py-3">Product</th><th className="px-4 py-3">Category</th><th className="px-4 py-3 text-right">Times rented</th>
                    <th className="px-4 py-3 text-right">Earned</th><th className="px-4 py-3 text-right">Purchase price</th><th className="px-4 py-3">Paid back</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(({ p, times, earned, cost, payback }) => (
                    <tr key={p.id} className="hover:bg-accent/40">
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-3">
                          {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-lg bg-muted/70" />}
                          <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block font-mono text-xs text-muted-foreground">{p.sku}</span></span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{catName(p.category_id)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{times}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{rupees(earned)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{cost ? rupees(cost) : "—"}</td>
                      <td className="px-4 py-2.5">
                        {payback === null ? <span className="text-xs text-muted-foreground">No purchase price</span>
                          : payback >= 1 ? <StatusBadge tone="emerald">Paid back · {Math.round(payback * 100)}%</StatusBadge>
                          : (
                            <span className="flex items-center gap-2">
                              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-black/10"><span className="block h-full bg-gold" style={{ width: `${Math.round(payback * 100)}%` }} /></span>
                              <span className="text-xs tabular-nums text-muted-foreground">{Math.round(payback * 100)}%</span>
                            </span>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
