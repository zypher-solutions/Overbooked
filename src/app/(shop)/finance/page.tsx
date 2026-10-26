"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { METHOD_LABELS, PAYMENT_LABELS, addDays, dayRange, errorText, fmtDate, fmtDateTime, rupees, todayLocal } from "@/lib/shop/format";
import type { Payment } from "@/lib/shop/types";
import { PageHeader, Panel, SummaryCard, ghostButtonClass, inputClass } from "@/components/shop/ui";

// Finance, as in TRENDZ: what was earned, what came in, what is still owed and the deposits held,
// a daily close per payment method that matches the cash drawer, and the same per branch.
// Every figure is summed from the payment records and the rentals, so it always matches them.
type PayRow = Pick<Payment, "id" | "rental_id" | "kind" | "amount" | "method" | "paid_at" | "note"> & {
  rentals: { token: string; branch_id: string; customers: { full_name: string } | null } | null;
};
interface RentalMoney {
  id: string; branch_id: string; status: string; total: number; paid: number; cancellation_fee: number;
  actual_start_at: string | null; cancelled_at: string | null; deposit_received: number; deposit_refunded: number; deposit_applied: number;
}

const PRESETS = { month: "This month", today: "Today", week: "Last 7 days", last_month: "Last month", custom: "Pick dates" } as const;
type Preset = keyof typeof PRESETS;
const IN = ["payment"]; // money received for the rental
const OUT = ["refund"];
const DRAWER_IN = ["payment", "deposit"]; // money that physically came in or went out
const DRAWER_OUT = ["refund", "deposit_refund"];
const r2 = (n: number) => Math.round(n * 100) / 100;

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data as T[]) ?? [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export default function Finance() {
  const { tz, canManage, myBranchId, activeBranches, branches } = useShop();
  const today = todayLocal(tz);
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [branch, setBranch] = useState(myBranchId ?? "");
  const [closeDay, setCloseDay] = useState(today);
  const [pays, setPays] = useState<PayRow[] | null>(null);
  const [rentals, setRentals] = useState<RentalMoney[] | null>(null);

  useEffect(() => {
    if (preset === "today") { setFrom(today); setTo(today); }
    if (preset === "week") { setFrom(addDays(today, -6)); setTo(today); }
    if (preset === "month") { setFrom(today.slice(0, 8) + "01"); setTo(today); }
    if (preset === "last_month") { const last = addDays(today.slice(0, 8) + "01", -1); setFrom(last.slice(0, 8) + "01"); setTo(last); }
  }, [preset, today]);

  // the previous period of the same length, for "vs previous"
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const prevFrom = addDays(from, -days);
  const prevTo = addDays(from, -1);

  const load = useCallback(async () => {
    if (!canManage || !from || !to || to < from) return;
    const supabase = createClient();
    const start = dayRange(prevFrom < closeDay ? prevFrom : closeDay, tz).from;
    const end = dayRange(to > closeDay ? to : closeDay, tz).to;
    try {
      const [p, r] = await Promise.all([
        pageAll<PayRow>((f, t) => supabase.from("payments")
          .select("id, rental_id, kind, amount, method, paid_at, note, rentals!payments_shop_rental_fkey(token, branch_id, customers!rentals_shop_customer_fkey(full_name))")
          .gte("paid_at", start).lt("paid_at", end).order("paid_at").order("id").range(f, t)),
        // shortcut: loads the money columns of every rental out or returned, for "outstanding" and "deposits held";
        // move this into a database function once a shop has tens of thousands of rentals
        pageAll<RentalMoney>((f, t) => supabase.from("rentals")
          .select("id, branch_id, status, total, paid, cancellation_fee, actual_start_at, cancelled_at, deposit_received, deposit_refunded, deposit_applied")
          .in("status", ["active", "completed", "cancelled", "no_show"]).order("id").range(f, t)),
      ]);
      setPays(p.map((x) => ({ ...x, amount: Number(x.amount) })));
      setRentals(r.map((x) => ({ ...x, total: Number(x.total), paid: Number(x.paid), cancellation_fee: Number(x.cancellation_fee),
        deposit_received: Number(x.deposit_received), deposit_refunded: Number(x.deposit_refunded), deposit_applied: Number(x.deposit_applied) })));
    } catch (e) {
      toast.error("Could not load the money records: " + errorText(e));
    }
  }, [canManage, from, to, prevFrom, closeDay, tz]);
  useEffect(() => { void load(); }, [load]);

  const local = useCallback((iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso)), [tz]);
  const inBranch = (id: string | undefined, b: string) => !b || id === b;

  const calc = useMemo(() => {
    const earned = (f: string, t: string, b: string) => r2((rentals ?? []).reduce((s, r) => {
      if (!inBranch(r.branch_id, b)) return s;
      if ((r.status === "active" || r.status === "completed") && r.actual_start_at && local(r.actual_start_at) >= f && local(r.actual_start_at) <= t) return s + r.total;
      if ((r.status === "cancelled" || r.status === "no_show") && r.cancellation_fee > 0 && r.cancelled_at && local(r.cancelled_at) >= f && local(r.cancelled_at) <= t) return s + r.cancellation_fee;
      return s;
    }, 0));
    const paysIn = (f: string, t: string, b: string) => (pays ?? []).filter((p) => inBranch(p.rentals?.branch_id, b) && local(p.paid_at) >= f && local(p.paid_at) <= t);
    const sum = (rows: PayRow[], kinds: string[]) => rows.reduce((s, p) => (kinds.includes(p.kind) ? s + p.amount : s), 0);
    const collected = (f: string, t: string, b: string) => { const rows = paysIn(f, t, b); return r2(sum(rows, IN) - sum(rows, OUT)); };
    const owing = (b: string) => (rentals ?? []).filter((r) => (r.status === "active" || r.status === "completed") && inBranch(r.branch_id, b) && r.total - r.paid > 0.004);
    const outstanding = (b: string) => r2(owing(b).reduce((s, r) => s + r.total - r.paid, 0));
    const deposits = (b: string) => r2((rentals ?? []).filter((r) => inBranch(r.branch_id, b))
      .reduce((s, r) => s + r.deposit_received - r.deposit_refunded - r.deposit_applied, 0));
    return { earned, collected, outstanding, owing, deposits, paysIn, sum };
  }, [rentals, pays, local]);

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Finance is for owners and managers.</p></Panel>;
  const ready = pays !== null && rentals !== null;
  const rangeText = preset === "month" ? "this month" : from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;
  const vs = (now: number, before: number) => `${now - before >= 0 ? "+" : "−"}${rupees(Math.abs(r2(now - before)))} vs previous ${days} days (${rupees(before)})`;
  const earnedNow = ready ? calc.earned(from, to, branch) : 0;
  const collectedNow = ready ? calc.collected(from, to, branch) : 0;

  const dayRows = ready ? (["cash", "upi", "card", "bank_transfer"] as const).map((m) => {
    const rows = calc.paysIn(closeDay, closeDay, branch).filter((p) => p.method === m);
    const moneyIn = r2(calc.sum(rows, DRAWER_IN));
    const moneyOut = r2(calc.sum(rows, DRAWER_OUT));
    return { m, moneyIn, moneyOut, net: r2(moneyIn - moneyOut) };
  }) : [];
  const dayIn = r2(dayRows.reduce((s, r) => s + r.moneyIn, 0));
  const dayOut = r2(dayRows.reduce((s, r) => s + r.moneyOut, 0));
  const signed = (n: number) => (n < 0 ? "−" + rupees(-n) : rupees(n));

  const exportCsv = () => {
    const rows = calc.paysIn(from, to, branch).map((p) => ({
      date: fmtDateTime(p.paid_at, tz), branch: branches.find((b) => b.id === p.rentals?.branch_id)?.name ?? "", token: p.rentals?.token ?? "",
      customer: p.rentals?.customers?.full_name ?? "", type: PAYMENT_LABELS[p.kind] ?? p.kind, method: p.method ? METHOD_LABELS[p.method] : "",
      amount: (DRAWER_OUT.includes(p.kind) ? -1 : 1) * p.amount, note: p.note ?? "",
    }));
    // escapeFormulae: a note starting with = + - or @ must not run as a formula in Excel
    const csv = Papa.unparse(rows, { escapeFormulae: true });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const branchRows = !branch && activeBranches.length > 1 ? activeBranches : [];

  return (
    <>
      <PageHeader title="Finance" subtitle={rangeText}
        actions={<Link href="/dashboard" className={ghostButtonClass}>All money records and stock</Link>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(PRESETS) as Preset[]).map((p) => (
            <button key={p} aria-pressed={preset === p} onClick={() => setPreset(p)}
              className={cn("rounded-full border px-3 py-1 text-xs", preset === p ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}>
              {PRESETS[p]}
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <SummaryCard label={`Earned · ${rangeText}`} value={ready ? rupees(earnedNow) : "…"} tone="gold"
          hint={ready ? vs(earnedNow, calc.earned(prevFrom, prevTo, branch)) : "rentals picked up + cancellation fees"} />
        <SummaryCard label={`Collected · ${rangeText}`} value={ready ? rupees(collectedNow) : "…"} tone="emerald"
          hint={ready ? vs(collectedNow, calc.collected(prevFrom, prevTo, branch)) : "money received, after refunds"} />
        <SummaryCard label="Outstanding now" value={ready ? rupees(calc.outstanding(branch)) : "…"} tone={ready && calc.outstanding(branch) > 0 ? "rust" : "emerald"}
          hint={ready ? `owed on ${calc.owing(branch).length} rental${calc.owing(branch).length === 1 ? "" : "s"}` : undefined} />
        <SummaryCard label="Deposits held now" value={ready ? rupees(calc.deposits(branch)) : "…"} hint="to be refunded or kept on return" />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Earned counts rentals by the day they were picked up, and cancellation fees by the day of cancelling. Collected counts rental money on the day
        it was received, after refunds; deposits are kept apart.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="glass rounded-xl p-4 sm:p-5" aria-label="Daily close">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide">Daily close</h2>
              <p className="mt-1 text-xs text-muted-foreground">Money in and out by payment method{branch ? ` · ${branches.find((b) => b.id === branch)?.name}` : " · all branches"}</p>
            </div>
            <input type="date" className={cn(inputClass, "h-9 w-40 text-xs")} aria-label="Day" value={closeDay} max={today} onChange={(e) => setCloseDay(e.target.value || today)} />
          </div>
          <table className="mt-3 w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Method</th><th className="py-2 pr-3 text-right font-medium">In</th><th className="py-2 pr-3 text-right font-medium">Out</th><th className="py-2 text-right font-medium">Net</th>
            </tr></thead>
            <tbody className="font-mono">
              {dayRows.map((r) => (
                <tr key={r.m} className="border-t border-border/60">
                  <td className="py-2 pr-3 font-sans">{METHOD_LABELS[r.m]}</td>
                  <td className="py-2 pr-3 text-right text-emerald">{r.moneyIn ? rupees(r.moneyIn) : "—"}</td>
                  <td className="py-2 pr-3 text-right text-rust">{r.moneyOut ? rupees(r.moneyOut) : "—"}</td>
                  <td className="py-2 text-right font-semibold">{signed(r.net)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2 pr-3 font-sans">Total</td><td className="py-2 pr-3 text-right">{rupees(dayIn)}</td>
                <td className="py-2 pr-3 text-right">{rupees(dayOut)}</td><td className="py-2 text-right">{signed(r2(dayIn - dayOut))}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">Includes deposits taken and returned, so it matches the cash drawer. A deposit kept towards charges moves no money and is not counted here.</p>
        </section>

        <section className="glass rounded-xl p-4 sm:p-5" aria-label="By branch">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide">{branchRows.length ? `By branch · ${rangeText}` : "Payment ledger"}</h2>
            <button type="button" className={ghostButtonClass} onClick={exportCsv} disabled={!ready}><Download className="h-3.5 w-3.5" /> Ledger CSV</button>
          </div>
          {branchRows.length && ready ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Branch</th><th className="py-2 pr-3 text-right font-medium">Earned</th><th className="py-2 pr-3 text-right font-medium">Collected</th>
                  <th className="py-2 pr-3 text-right font-medium">Outstanding</th><th className="py-2 text-right font-medium">Deposits</th>
                </tr></thead>
                <tbody className="font-mono">
                  {branchRows.map((b) => (
                    <tr key={b.id} className="border-t border-border/60">
                      <td className="py-2 pr-3 font-sans">{b.name}</td>
                      <td className="py-2 pr-3 text-right">{rupees(calc.earned(from, to, b.id))}</td>
                      <td className="py-2 pr-3 text-right">{rupees(calc.collected(from, to, b.id))}</td>
                      <td className="py-2 pr-3 text-right">{rupees(calc.outstanding(b.id))}</td>
                      <td className="py-2 text-right">{rupees(calc.deposits(b.id))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              {ready ? `${calc.paysIn(from, to, branch).length} money records · ${rangeText}. The CSV lists each one with its date, token, type and method.` : "Loading..."}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
