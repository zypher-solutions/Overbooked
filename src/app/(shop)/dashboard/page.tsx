"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { METHOD_LABELS, PAYMENT_LABELS, addDays, dayRange, errorText, fmtDate, fmtDateTime, plural, rupees, todayLocal } from "@/lib/shop/format";
import { useCatalog, variationLabel } from "@/lib/shop/useCatalog";
import type { Payment } from "@/lib/shop/types";
import { Panel, PageHeader, SummaryCard, ghostButtonClass, inputClass, tableWrap, theadClass } from "@/components/shop/ui";

interface Summary {
  rentals: number; revenue: number; balance_due: number; collected: number; deposit_kept: number; deposits_held_now: number;
  by_method: Record<string, number>;
}
interface Stock { variation_id: string; branch_id: string; total: number; available_now: number; out_now: number; reserved_ahead: number; maintenance: number; lost: number }
type LedgerRow = Payment & { rentals: { token: string; branch_id: string; customers: { full_name: string } | null } | null };

const SHOWN = 300;
const PRESETS = ["today", "week", "month", "last_month", "custom"] as const;
const PRESET_LABELS: Record<(typeof PRESETS)[number], string> = { today: "Today", week: "Last 7 days", month: "This month", last_month: "Last month", custom: "Pick dates" };

export default function Dashboard() {
  const { tz, canManage, myBranchId, activeBranches, branches } = useShop();
  const today = todayLocal(tz);
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>("month");
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [branch, setBranch] = useState(myBranchId ?? "");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stock, setStock] = useState<Stock[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [ledgerCount, setLedgerCount] = useState(0);
  const { products } = useCatalog({ includeInactive: true });

  useEffect(() => {
    if (preset === "custom") return;
    if (preset === "today") { setFrom(today); setTo(today); }
    if (preset === "week") { setFrom(addDays(today, -6)); setTo(today); }
    if (preset === "month") { setFrom(today.slice(0, 8) + "01"); setTo(today); }
    if (preset === "last_month") {
      const firstThis = today.slice(0, 8) + "01";
      const lastPrev = addDays(firstThis, -1);
      setFrom(lastPrev.slice(0, 8) + "01");
      setTo(lastPrev);
    }
  }, [preset, today]);

  const load = useCallback(async () => {
    if (!canManage || !from || !to || to < from) return;
    try {
      const [s, st] = await Promise.all([
        call<Summary>("dashboard_summary", { p_from: from, p_to: to, p_branch_id: branch || null }),
        call<Stock[]>("inventory_status"),
      ]);
      setSummary(s);
      setStock(st);
    } catch (e) {
      toast.error(errorText(e));
    }
    // the latest 300 money records on screen; the CSV export fetches them all
    const { rows, count } = await fetchLedger(SHOWN);
    setLedger(rows);
    setLedgerCount(count);
  }, [canManage, from, to, branch, tz]); // eslint-disable-line react-hooks/exhaustive-deps

  // money records of the period (all of them, page by page, when limit is undefined)
  async function fetchLedger(limit?: number) {
    const supabase = createClient();
    const rows: LedgerRow[] = [];
    let count = 0;
    for (let i = 0; ; i += 1000) {
      const size = limit ? Math.min(limit, 1000) : 1000;
      let q = supabase.from("payments")
        .select("*, rentals!payments_shop_rental_fkey!inner(token, branch_id, customers!rentals_shop_customer_fkey(full_name))", i === 0 ? { count: "exact" } : undefined)
        .gte("paid_at", dayRange(from, tz).from).lt("paid_at", dayRange(to, tz).to).order("paid_at", { ascending: false }).order("id").range(i, i + size - 1);
      if (branch) q = q.eq("rentals.branch_id", branch);
      const { data, error, count: c } = await q;
      if (error) { toast.error(errorText(error)); break; }
      if (i === 0) count = c ?? 0;
      rows.push(...((data as unknown as LedgerRow[]) ?? []));
      if (limit || !data || data.length < size) break;
    }
    return { rows, count };
  }
  useEffect(() => { void load(); }, [load]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products ?? []) for (const v of p.product_variations ?? []) m.set(v.id, variationLabel(p, v));
    return m;
  }, [products]);

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Money and reports are for owners and managers.</p></Panel>;

  const exportCsv = async () => {
    const { rows: all } = await fetchLedger();
    // escapeFormulae: a note starting with = + - or @ must not run as a formula in Excel
    const csv = Papa.unparse(all.map((r) => ({
      date: fmtDateTime(r.paid_at, tz), booking: r.rentals?.token, customer: r.rentals?.customers?.full_name, type: PAYMENT_LABELS[r.kind],
      method: r.method ? METHOD_LABELS[r.method] : "", amount: (r.kind === "refund" || r.kind === "deposit_refund" ? -1 : 1) * Number(r.amount),
      branch: branches.find((b) => b.id === r.rentals?.branch_id)?.name, note: r.note ?? "",
    })), { escapeFormulae: true });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `money-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stockRows = stock.filter((s) => !branch || s.branch_id === branch);
  return (
    <>
      <PageHeader title="Money and reports" subtitle={`${fmtDate(from)} to ${fmtDate(to)}`} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p} aria-pressed={preset === p} onClick={() => setPreset(p)}
              className={cn("rounded-full border px-3 py-1 text-xs", preset === p ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}>
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        {preset === "custom" ? <>
          <input type="date" className={cn(inputClass, "w-auto")} aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className={cn(inputClass, "w-auto")} aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        </> : null}
        {!myBranchId && activeBranches.length > 1 ? (
          <select className={cn(inputClass, "w-auto")} aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>
            {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <SummaryCard label="Money in (net)" value={summary ? rupees(summary.collected) : "—"} tone="emerald" hint="Payments minus refunds, by date received" />
        <SummaryCard label="Booked value" value={summary ? rupees(summary.revenue) : "—"} tone="gold" hint={summary ? `${plural(summary.rentals, "booking")} starting in the period` : undefined} />
        <SummaryCard label="Still owed" value={summary ? rupees(summary.balance_due) : "—"} tone={summary?.balance_due ? "rust" : "default"} hint="On those bookings" />
        <SummaryCard label="Deposits held now" value={summary ? rupees(summary.deposits_held_now) : "—"} hint="Customers' money, to return" />
        <SummaryCard label="Deposit kept" value={summary ? rupees(summary.deposit_kept) : "—"} hint="Towards charges, in the period" />
        <Panel title="By payment method">
          {summary && Object.keys(summary.by_method).length ? (
            <ul className="space-y-1 text-sm">
              {Object.entries(summary.by_method).map(([m, v]) => (
                <li key={m} className="flex justify-between"><span>{METHOD_LABELS[m] ?? m}</span><span className="font-mono">{rupees(v)}</span></li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Nothing yet.</p>}
          <p className="mt-2 text-[11px] text-muted-foreground">Cash drawer check: includes deposits in and out.</p>
        </Panel>
      </div>

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Money records ({ledgerCount})</h2>
        <button className={ghostButtonClass} disabled={!ledger?.length} onClick={() => void exportCsv()}><Download className="h-4 w-4" /> Export CSV</button>
      </div>
      <div className={tableWrap}>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className={theadClass}><tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Booking</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Method</th><th className="px-4 py-3 text-right">Amount</th></tr></thead>
          <tbody className="divide-y divide-border">
            {ledger === null ? <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
              : ledger.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No money moved in this period.</td></tr>
              : ledger.map((r) => {
                const out = r.kind === "refund" || r.kind === "deposit_refund";
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-2">{fmtDateTime(r.paid_at, tz)}</td>
                    <td className="px-4 py-2"><Link href={`/rentals/${r.rental_id}`} className="font-mono text-xs text-gold hover:underline">{r.rentals?.token}</Link> <span className="text-xs text-muted-foreground">{r.rentals?.customers?.full_name}</span></td>
                    <td className="px-4 py-2">{PAYMENT_LABELS[r.kind]}</td>
                    <td className="px-4 py-2">{r.method ? METHOD_LABELS[r.method] : "—"}</td>
                    <td className={cn("px-4 py-2 text-right font-mono", out && "text-rust")}>{out ? "−" : ""}{rupees(r.amount)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {ledgerCount > SHOWN ? <p className="mt-2 text-xs text-muted-foreground">Showing the latest {SHOWN}; the CSV has all {ledgerCount}.</p> : null}

      <h2 className="mb-2 mt-6 text-sm font-semibold">Stock right now</h2>
      <div className={tableWrap}>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className={theadClass}><tr><th className="px-4 py-3">Item</th>{activeBranches.length > 1 ? <th className="px-4 py-3">Branch</th> : null}
            <th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Free now</th><th className="px-4 py-3 text-right">Out</th>
            <th className="px-4 py-3 text-right">Booked ahead</th><th className="px-4 py-3 text-right">Service</th><th className="px-4 py-3 text-right">Lost</th></tr></thead>
          <tbody className="divide-y divide-border">
            {stockRows.map((s) => (
              <tr key={s.variation_id + s.branch_id}>
                <td className="px-4 py-2">{names.get(s.variation_id) ?? "…"}</td>
                {activeBranches.length > 1 ? <td className="px-4 py-2 text-muted-foreground">{branches.find((b) => b.id === s.branch_id)?.name}</td> : null}
                <td className="px-4 py-2 text-right font-mono">{s.total}</td>
                <td className="px-4 py-2 text-right font-mono text-emerald">{s.available_now}</td>
                <td className="px-4 py-2 text-right font-mono">{s.out_now}</td>
                <td className="px-4 py-2 text-right font-mono">{s.reserved_ahead}</td>
                <td className="px-4 py-2 text-right font-mono">{s.maintenance || ""}</td>
                <td className="px-4 py-2 text-right font-mono text-rust">{s.lost || ""}</td>
              </tr>
            ))}
            {stockRows.length === 0 ? <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">No units yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
