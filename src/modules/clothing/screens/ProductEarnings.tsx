"use client";

import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { errorText, rupees, todayLocal } from "@/lib/shop/format";
import { useCatalog } from "@/lib/shop/useCatalog";
import { Empty, PageHeader, Panel, StatusBadge, ghostButtonClass, inputClass, ListSkeleton, tableWrap, theadClass } from "@/components/shop/ui";
import { downloadSheet } from "../sheet";
import { FinanceTabs, RangeBar, type Range } from "../components/FinanceBits";

// Product performance: for bookings picked up in the dates and branch, how often each product went out, its rent, its
// share of the booking discounts, and what it earned (returned bookings, after discount). Over all time and every branch,
// also whether it has paid back its purchase price. Summed in the database (product_performance, migration 043).
type Figures = { times: number; pieces: number; rent: number; discount: number; earned: number };
type Sort = "earned" | "times" | "payback" | "name";
const NONE: Figures = { times: 0, pieces: 0, rent: 0, discount: 0, earned: 0 };

export default function ProductEarnings() {
  const { categories, canManage, tz, myBranchId } = useShop();
  const { products } = useCatalog({ includeInactive: true });
  const today = todayLocal(tz);
  const [range, setRange] = useState<Range>({ from: "", to: today, branch: myBranchId ?? "" });
  const allTime = !range.from && !range.branch;
  const [figures, setFigures] = useState<Map<string, Figures> | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState<Sort>("earned");

  useEffect(() => {
    let live = true;
    setFigures(null);
    void createClient().rpc("product_performance" as never, { p_from: range.from || null, p_to: range.from ? range.to : null, p_branch_id: range.branch || null } as never)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) { setFailed(true); return; }
        const rows = (data ?? []) as { product_id: string; bookings: number; pieces: number; rent: number; discount: number; earned: number }[];
        setFigures(new Map(rows.map((r) => [r.product_id, { times: Number(r.bookings), pieces: Number(r.pieces), rent: Number(r.rent), discount: Number(r.discount), earned: Number(r.earned) }])));
      });
    return () => { live = false; };
  }, [range]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (products ?? []).filter((p) => !p.is_set && (!cat || p.category_id === cat) && (!term || `${p.name} ${p.sku}`.toLowerCase().includes(term)))
      .map((p) => {
        const f = figures?.get(p.id) ?? NONE;
        const cost = Number(p.purchase_price) || 0;
        // paid back compares everything it ever earned with what it cost, so only over all time
        return { p, ...f, cost, payback: cost > 0 && allTime ? f.earned / cost : null };
      });
    const by: Record<Sort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      earned: (a, b) => b.earned - a.earned, times: (a, b) => b.times - a.times,
      payback: (a, b) => (b.payback ?? -1) - (a.payback ?? -1), name: (a, b) => a.p.name.localeCompare(b.p.name),
    };
    return list.sort(by[sort]);
  }, [products, figures, q, cat, sort, allTime]);
  const total = rows.reduce((s, r) => s + r.earned, 0);
  const discounts = rows.reduce((s, r) => s + r.discount, 0);
  const paidBack = rows.filter((r) => r.payback !== null && r.payback >= 1).length;
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";

  const exportRows = async () => {
    try {
      await downloadSheet(`product-performance-${range.from || "all-time"}-to-${range.to}.xlsx`,
        ["Product", "SKU", "Category", "Bookings", "Pieces out", "Rent", "Booking discount", "Earned", "Purchase price", "Earned back (%)"],
        rows.map((r) => [r.p.name, r.p.sku, catName(r.p.category_id), r.times, r.pieces, r.rent, r.discount, r.earned, r.cost || "", r.payback === null ? "" : Math.round(r.payback * 100)]), "Products");
    } catch (e) { toast.error(errorText(e)); }
  };

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Only owners and managers can see finance reports.</p></Panel>;
  return (
    <>
      <PageHeader title="Finance" subtitle="How often each product goes out, what it earns, and whether it has paid back its purchase price." />
      <FinanceTabs />
      <RangeBar value={range} onChange={setRange} today={today} allowAllTime>
        <button className={ghostButtonClass} disabled={!figures || !products} onClick={() => void exportRows()}><FileSpreadsheet className="h-4 w-4" /> Excel</button>
      </RangeBar>

      {failed ? (
        <Panel><p role="alert" className="text-sm text-muted-foreground">The report could not be loaded. If this is the first time, the database update for it (migration 043) may not be applied yet.</p></Panel>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Stat label="Earned (returned rentals, after discount)" value={figures ? rupees(total) : "…"} />
            <Stat label="Products that went out" value={figures ? String(rows.filter((r) => r.times > 0).length) : "…"} />
            {allTime
              ? <Stat label="Paid for themselves" value={figures ? `${paidBack} of ${rows.filter((r) => r.cost > 0).length} with a purchase price` : "…"} />
              : <Stat label="Booking discounts given" value={figures ? rupees(discounts) : "…"} />}
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
                <option value="earned">Most earned first</option><option value="times">Most booked first</option>
                {allTime ? <option value="payback">Best paid back first</option> : null}<option value="name">By name</option>
              </select>
            </div>
          </div>
          {products === null || figures === null ? <ListSkeleton /> : rows.length === 0 ? <Panel><Empty>No products match.</Empty></Panel> : (
            <div className={tableWrap}>
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className={theadClass}>
                  <tr>
                    <th className="px-4 py-3">Product</th><th className="px-4 py-3">Category</th><th className="px-4 py-3 text-right">Bookings</th>
                    <th className="px-4 py-3 text-right">Pieces out</th><th className="px-4 py-3 text-right">Rent</th><th className="px-4 py-3 text-right">Discount</th>
                    <th className="px-4 py-3 text-right">Earned</th><th className="px-4 py-3 text-right">Purchase price</th><th className="px-4 py-3">Paid back</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(({ p, times, pieces, rent, discount, earned, cost, payback }) => (
                    <tr key={p.id} className="hover:bg-accent/40">
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-3">
                          {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-lg bg-muted/70" />}
                          <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block font-mono text-xs text-muted-foreground">{p.sku}</span></span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{catName(p.category_id)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{times}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{pieces}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{rupees(rent)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{discount ? `−${rupees(discount)}` : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{rupees(earned)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{cost ? rupees(cost) : "—"}</td>
                      <td className="px-4 py-2.5">
                        {payback === null ? <span className="text-xs text-muted-foreground">{cost && !allTime ? "All time only" : "No purchase price"}</span>
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
