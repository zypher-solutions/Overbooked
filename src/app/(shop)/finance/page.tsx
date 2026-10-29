"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Download, Filter, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_BASE_COLUMNS, attachListDetails, call, loadRental, type RentalDetail } from "@/lib/shop/api";
import { ExpensesPanel } from "@/components/shop/ExpensesPanel";
import { METHOD_LABELS, PAYMENT_LABELS, STATUS_LABELS, addDays, dayRange, errorText, fmtDate, fmtDateTime, rupees, todayLocal } from "@/lib/shop/format";
import { searchRentalIds } from "@/lib/shop/searchRentals";
import type { Payment } from "@/lib/shop/types";
import { PaymentDialog } from "@/components/shop/RentalDialogs";
import { itemsSummary, type ListRental } from "@/components/shop/RentalList";
import { BalanceBadge, Panel, RentalStatusBadge, StatusBadge, SummaryCard, ghostButtonClass, inputClass, isOverdue } from "@/components/shop/ui";

// Finance, as in TRENDZ: what was earned, what came in, what is still owed and the deposits held,
// a daily close per payment method that matches the cash drawer, the same per branch, and below them
// the Ledger Records (every booking and rental in the filters, with Export PDF and Records CSV).
// Every figure is summed from the payment records and the rentals, so it always matches them.
type PayRow = Pick<Payment, "id" | "rental_id" | "kind" | "amount" | "method" | "paid_at" | "note"> & {
  rentals: { token: string; branch_id: string; customers: { full_name: string } | null } | null;
};
interface RentalMoney {
  id: string; branch_id: string; status: string; total: number; paid: number; cancellation_fee: number;
  actual_start_at: string | null; cancelled_at: string | null; deposit_received: number; deposit_refunded: number; deposit_applied: number;
}
type LedgerRow = ListRental & { cancellation_fee: number; deposit_received: number; actual_end_at?: string | null };
type StatusFilter = "all" | "reserved" | "active" | "completed" | "cancelled";
type Pay = "all" | "paid" | "partial" | "unpaid";
interface Filters { from: string; to: string; branch: string; status: StatusFilter; payment: Pay }

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "reserved", label: "Booked (awaiting pickup)" }, { value: "active", label: "Out" },
  { value: "completed", label: "Returned" }, { value: "cancelled", label: "Cancelled" },
];
const PAY_LABELS: Record<Pay, string> = { all: "All payments", paid: "Paid", partial: "Partial", unpaid: "Unpaid" };
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
  const router = useRouter();
  const { shop, tz, canManage, myBranchId, activeBranches, branches } = useShop();
  const today = todayLocal(tz);
  const monthStart = today.slice(0, 8) + "01";
  const blank: Filters = { from: monthStart, to: "", branch: myBranchId ?? "", status: "all", payment: "all" };
  const [f, setF] = useState<Filters>(blank);
  const [showFilters, setShowFilters] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIds, setMatchIds] = useState<string[] | null>(null);
  const [closeDay, setCloseDay] = useState(today);
  const [pays, setPays] = useState<PayRow[] | null>(null);
  const [rentals, setRentals] = useState<RentalMoney[] | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [payFor, setPayFor] = useState<RentalDetail | null>(null);
  const from = f.from;
  const to = f.to || today;
  const branch = f.branch;

  // the previous period of the same length, for "vs previous"
  const days = from ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 : 0;
  const prevFrom = from ? addDays(from, -days) : "";
  const prevTo = from ? addDays(from, -1) : "";

  useEffect(() => {
    const q = query.trim();
    if (!q) { setMatchIds(null); return; }
    const t = setTimeout(async () => { setMatchIds(await searchRentalIds(q)); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    if (!canManage || (from && to < from)) return;
    const supabase = createClient();
    const first = from ? (prevFrom < closeDay ? prevFrom : closeDay) : "";
    const start = first ? dayRange(first, tz).from : "1970-01-01T00:00:00Z";
    const end = dayRange(to > closeDay ? to : closeDay, tz).to;
    try {
      const [p, r] = await Promise.all([
        pageAll<PayRow>((a, b) => supabase.from("payments")
          .select("id, rental_id, kind, amount, method, paid_at, note, rentals!payments_shop_rental_fkey(token, branch_id, customers!rentals_shop_customer_fkey(full_name))")
          .gte("paid_at", start).lt("paid_at", end).order("paid_at").order("id").range(a, b)),
        // shortcut: loads the money columns of every rental out or returned, for "outstanding" and "deposits held";
        // move this into a database function once a shop has tens of thousands of rentals
        pageAll<RentalMoney>((a, b) => supabase.from("rentals")
          .select("id, branch_id, status, total, paid, cancellation_fee, actual_start_at, cancelled_at, deposit_received, deposit_refunded, deposit_applied")
          .in("status", ["active", "completed", "cancelled", "no_show"]).order("id").range(a, b)),
      ]);
      setPays(p.map((x) => ({ ...x, amount: Number(x.amount) })));
      setRentals(r.map((x) => ({ ...x, total: Number(x.total), paid: Number(x.paid), cancellation_fee: Number(x.cancellation_fee),
        deposit_received: Number(x.deposit_received), deposit_refunded: Number(x.deposit_refunded), deposit_applied: Number(x.deposit_applied) })));
    } catch (e) {
      toast.error("Could not load the money records: " + errorText(e));
    }
  }, [canManage, from, to, prevFrom, closeDay, tz]);
  useEffect(() => { void load(); }, [load]);

  // the Ledger Records: every booking and rental that starts in the dates, branch and status
  const loadLedger = useCallback(async () => {
    if (!canManage || (from && to < from)) return;
    if (matchIds !== null && matchIds.length === 0) { setLedger([]); return; }
    const supabase = createClient();
    const statuses = f.status === "all" ? ["reserved", "active", "completed", "cancelled", "no_show"] : f.status === "cancelled" ? ["cancelled", "no_show"] : [f.status];
    try {
      const rows = await pageAll<Omit<LedgerRow, "customers" | "rental_lines"> & { customer_id: string }>((a, b) => {
        let q = supabase.from("rentals").select(RENTAL_BASE_COLUMNS + ", cancellation_fee, deposit_received").in("status", statuses);
        if (branch) q = q.eq("branch_id", branch);
        if (from) q = q.gte("start_at", dayRange(from, tz).from);
        if (f.to) q = q.lt("start_at", dayRange(f.to, tz).to);
        if (matchIds !== null) q = q.in("id", matchIds.slice(0, 300));
        return q.order("start_at", { ascending: false }).order("id").range(a, b);
      });
      setLedger((await attachListDetails(rows)) as unknown as LedgerRow[]);
    } catch (e) {
      toast.error("Could not load the ledger records: " + errorText(e));
      setLedger((x) => x ?? []);
    }
  }, [canManage, from, to, f.to, branch, f.status, matchIds, tz]);
  useEffect(() => { void loadLedger(); }, [loadLedger]);

  // expenses in the same dates and branch, for the Expenses and Profit cards
  const [expenses, setExpenses] = useState<number | null>(null);
  const [expVersion, setExpVersion] = useState(0);
  useEffect(() => {
    if (!canManage || (from && to < from)) return;
    let live = true;
    call<{ total: number }>("expense_summary", { p_from: from || "2000-01-01", p_to: to, p_branch_id: branch || null })
      .then((r) => { if (live) setExpenses(Number(r.total)); })
      .catch((e) => { if (live) { setExpenses(0); toast.error("Could not load the expenses: " + errorText(e)); } });
    return () => { live = false; };
  }, [canManage, from, to, branch, expVersion]);

  const local = useCallback((iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso)), [tz]);
  const inRange = (d: string, a: string, b: string) => (!a || d >= a) && d <= b;
  const inBranch = (id: string | undefined, b: string) => !b || id === b;

  const calc = useMemo(() => {
    const earned = (a: string, b: string, br: string) => r2((rentals ?? []).reduce((s, r) => {
      if (!inBranch(r.branch_id, br)) return s;
      if ((r.status === "active" || r.status === "completed") && r.actual_start_at && inRange(local(r.actual_start_at), a, b)) return s + r.total;
      if ((r.status === "cancelled" || r.status === "no_show") && r.cancellation_fee > 0 && r.cancelled_at && inRange(local(r.cancelled_at), a, b)) return s + r.cancellation_fee;
      return s;
    }, 0));
    const paysIn = (a: string, b: string, br: string) => (pays ?? []).filter((p) => inBranch(p.rentals?.branch_id, br) && inRange(local(p.paid_at), a, b));
    const sum = (rows: PayRow[], kinds: string[]) => rows.reduce((s, p) => (kinds.includes(p.kind) ? s + p.amount : s), 0);
    const collected = (a: string, b: string, br: string) => { const rows = paysIn(a, b, br); return r2(sum(rows, IN) - sum(rows, OUT)); };
    const owing = (br: string) => (rentals ?? []).filter((r) => (r.status === "active" || r.status === "completed") && inBranch(r.branch_id, br) && r.total - r.paid > 0.004);
    const outstanding = (br: string) => r2(owing(br).reduce((s, r) => s + r.total - r.paid, 0));
    const deposits = (br: string) => r2((rentals ?? []).filter((r) => inBranch(r.branch_id, br))
      .reduce((s, r) => s + r.deposit_received - r.deposit_refunded - r.deposit_applied, 0));
    return { earned, collected, outstanding, owing, deposits, paysIn, sum };
  }, [rentals, pays, local]);

  const balanceOf = (r: LedgerRow) => (r.status === "cancelled" || r.status === "no_show" ? 0 : Math.max(0, r2(Number(r.total) - Number(r.paid))));
  const rows = useMemo(() => (ledger ?? []).filter((r) => f.payment === "all"
    || (f.payment === "paid" ? balanceOf(r) <= 0 : f.payment === "unpaid" ? Number(r.paid) <= 0 && balanceOf(r) > 0 : Number(r.paid) > 0 && balanceOf(r) > 0)),
  [ledger, f.payment]);

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Finance is for owners and managers.</p></Panel>;
  const ready = pays !== null && rentals !== null;
  const rangeText = from === monthStart && !f.to ? "this month" : from || f.to ? `${from ? fmtDate(from) : "start"} – ${fmtDate(to)}` : "all time";
  const vs = (now: number, before: number) => `${now - before >= 0 ? "+" : "−"}${rupees(Math.abs(r2(now - before)))} vs previous ${days} days (${rupees(before)})`;
  const earnedNow = ready ? calc.earned(from, to, branch) : 0;
  const collectedNow = ready ? calc.collected(from, to, branch) : 0;

  const dayRows = ready ? (["cash", "upi", "card", "bank_transfer"] as const).map((m) => {
    const list = calc.paysIn(closeDay, closeDay, branch).filter((p) => p.method === m);
    const moneyIn = r2(calc.sum(list, DRAWER_IN));
    const moneyOut = r2(calc.sum(list, DRAWER_OUT));
    return { m, moneyIn, moneyOut, net: r2(moneyIn - moneyOut) };
  }) : [];
  const dayIn = r2(dayRows.reduce((s, r) => s + r.moneyIn, 0));
  const dayOut = r2(dayRows.reduce((s, r) => s + r.moneyOut, 0));
  const signed = (n: number) => (n < 0 ? "−" + rupees(-n) : rupees(n));
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "";

  const exportLedgerCsv = () => {
    const list = calc.paysIn(from, to, branch).map((p) => ({
      date: fmtDateTime(p.paid_at, tz), branch: branchName(p.rentals?.branch_id ?? ""), token: p.rentals?.token ?? "",
      customer: p.rentals?.customers?.full_name ?? "", type: PAYMENT_LABELS[p.kind] ?? p.kind, method: p.method ? METHOD_LABELS[p.method] : "",
      amount: (DRAWER_OUT.includes(p.kind) ? -1 : 1) * p.amount, note: p.note ?? "",
    }));
    download(Papa.unparse(list, { escapeFormulae: true }), `ledger-${from || "start"}-to-${to}.csv`);
  };
  const exportRecordsCsv = () => {
    const list = rows.map((r) => ({
      token: r.token, type: r.status === "reserved" ? "Booking" : "Rental", customer: r.customers?.full_name ?? "", phone: r.customers?.phone ?? "",
      branch: branchName(r.branch_id), start: fmtDate(r.start_at, tz), due: fmtDate(r.end_at, tz), status: STATUS_LABELS[r.status] ?? r.status,
      total: r.status === "cancelled" || r.status === "no_show" ? Number(r.cancellation_fee) : Number(r.total), paid: Number(r.paid), balance: balanceOf(r),
    }));
    download(Papa.unparse(list, { escapeFormulae: true }), `records-${from || "start"}-to-${to}.csv`);
  };
  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      const { generateLedgerPDF } = await import("@/modules/clothing/ledgerPdf");
      await generateLedgerPDF(shop.name, rows.map((r) => ({
        token: r.token, customer: r.customers?.full_name ?? "", phone: r.customers?.phone ?? "", item: itemsSummary(r.rental_lines), branch: branchName(r.branch_id),
        start: fmtDate(r.start_at, tz), due: fmtDate(r.end_at, tz), total: Number(r.total), paid: Number(r.paid), balance: balanceOf(r),
        status: (STATUS_LABELS[r.status] ?? r.status).toUpperCase(), late: isOverdue(r), cancelled: r.status === "cancelled" || r.status === "no_show", fee: Number(r.cancellation_fee),
      })), chips.map((c) => c.label));
    } catch (e) {
      toast.error("Could not make the PDF: " + errorText(e));
    } finally {
      setPdfBusy(false);
    }
  };
  const openPayment = async (id: string) => {
    try {
      const r = await loadRental(id);
      if (r) setPayFor(r);
    } catch (e) { toast.error(errorText(e)); }
  };

  const chips: { label: string; clear: Partial<Filters> }[] = [];
  if (f.from) chips.push({ label: `From ${fmtDate(f.from)}`, clear: { from: "" } });
  if (f.to) chips.push({ label: `To ${fmtDate(f.to)}`, clear: { to: "" } });
  if (f.branch !== blank.branch) chips.push({ label: branchName(f.branch) || "All branches", clear: { branch: blank.branch } });
  if (f.status !== "all") chips.push({ label: STATUS_OPTIONS.find((o) => o.value === f.status)?.label ?? f.status, clear: { status: "all" } });
  if (f.payment !== "all") chips.push({ label: PAY_LABELS[f.payment], clear: { payment: "all" } });
  const isFiltered = chips.length > 0 || query.trim() !== "";
  const clearAll = () => { setF({ ...blank, from: "" }); setQuery(""); };
  const branchRows = !branch && activeBranches.length > 1 ? activeBranches : [];

  const paymentCell = (r: LedgerRow) => (
    <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {r.status === "cancelled" || r.status === "no_show" ? <StatusBadge tone="muted">Closed</StatusBadge> : <BalanceBadge rental={r} />}
      {(r.status === "active" || r.status === "completed") && balanceOf(r) > 0 ? (
        <button type="button" onClick={() => void openPayment(r.id)}
          className="rounded-sm border border-gold/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold hover:bg-gold/10">Record payment</button>
      ) : null}
    </div>
  );
  const totalCell = (r: LedgerRow) => (r.status === "cancelled" || r.status === "no_show" ? (
    <div><span>{rupees(r.cancellation_fee)}</span><span className="block text-[10px] text-muted-foreground line-through">Orig: {rupees(r.total)}</span></div>
  ) : rupees(r.total));

  return (
    <>
      <h1 className="font-display text-2xl font-semibold sm:text-3xl">Finance</h1>
      <label className="relative mt-5 block">
        <span className="sr-only">Search rentals</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input type="search" className={cn(inputClass, "h-11 pl-9 pr-9")} placeholder="Search token, customer, phone or SKU…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        ) : null}
      </label>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <SummaryCard label={`Earned · ${rangeText}`} value={ready ? rupees(earnedNow) : "…"} tone="gold"
          hint={ready && from ? vs(earnedNow, calc.earned(prevFrom, prevTo, branch)) : "rentals picked up + cancellation fees"} />
        <SummaryCard label={`Collected · ${rangeText}`} value={ready ? rupees(collectedNow) : "…"} tone="emerald"
          hint={ready && from ? vs(collectedNow, calc.collected(prevFrom, prevTo, branch)) : "money received, after refunds"} />
        <SummaryCard label="Outstanding now" value={ready ? rupees(calc.outstanding(branch)) : "…"} tone={ready && calc.outstanding(branch) > 0 ? "rust" : "emerald"}
          hint={ready ? `owed on ${calc.owing(branch).length} rental${calc.owing(branch).length === 1 ? "" : "s"}` : undefined} />
        <SummaryCard label="Deposits held now" value={ready ? rupees(calc.deposits(branch)) : "…"} hint="to be refunded or kept on return" />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <SummaryCard label={`Expenses · ${rangeText}`} value={ready && expenses !== null ? rupees(expenses) : "…"} tone="rust"
          hint="rent, salaries, cleaning, tailoring (see Expenses below)" />
        <SummaryCard label={`Profit · ${rangeText}`} value={ready && expenses !== null ? signed(r2(earnedNow - expenses)) : "…"}
          tone={ready && expenses !== null && earnedNow - expenses < 0 ? "rust" : "gold"} hint="earned minus expenses" />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Earned counts rentals by pickup date and cancellation fees by cancellation date. Collected counts money on the day it was received.
        Date and branch filters apply here; status and payment filters only change the records list.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="glass rounded-xl p-4 sm:p-5" aria-label="Daily close">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide">Daily close</h2>
              <p className="mt-1 text-xs text-muted-foreground">Money in and out by payment method{branch ? ` · ${branchName(branch)}` : " · all branches"}</p>
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
          <p className="mt-2 text-xs text-muted-foreground">Includes security deposits taken and refunded, so it matches the cash drawer. A deposit kept towards charges moves no money and is not counted here.</p>
        </section>

        <section className="glass rounded-xl p-4 sm:p-5" aria-label="By branch">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide">{branchRows.length ? `By branch · ${rangeText}` : "Payment ledger"}</h2>
            <button type="button" className={ghostButtonClass} onClick={exportLedgerCsv} disabled={!ready}><Download className="h-3.5 w-3.5" /> Ledger CSV</button>
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
              {ready ? `${calc.paysIn(from, to, branch).length} money records for ${branch ? branchName(branch) : "all branches"} · ${rangeText}. The CSV lists each one with its date, token, type and method.` : "Loading..."}
            </p>
          )}
        </section>
      </div>

      <ExpensesPanel from={from} to={to} branch={branch} onChanged={() => setExpVersion((v) => v + 1)} />

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Ledger Records</h2>
          <span className="rounded-md bg-black/5 px-2 py-1 font-mono text-xs text-muted-foreground">{rows.length} records</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={ghostButtonClass} disabled={refreshing} title="Sync latest data"
            onClick={async () => { setRefreshing(true); await Promise.all([load(), loadLedger()]); setRefreshing(false); }}>
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin text-gold")} /> <span className="hidden sm:inline">{refreshing ? "Syncing…" : "Refresh"}</span>
          </button>
          <button type="button" className={cn(ghostButtonClass, showFilters && "border-gold/40")} aria-expanded={showFilters} onClick={() => setShowFilters((x) => !x)}>
            <Filter className="h-4 w-4" /> Filter{chips.length ? ` (${chips.length})` : ""}
          </button>
          <button type="button" className={ghostButtonClass} disabled={pdfBusy || ledger === null} onClick={() => void exportPdf()}>
            <Download className={cn("h-4 w-4", pdfBusy && "animate-spin")} /> {pdfBusy ? "Generating…" : "Export PDF"}
          </button>
          <button type="button" className={ghostButtonClass} disabled={ledger === null} onClick={exportRecordsCsv}><Download className="h-4 w-4" /> Records CSV</button>
        </div>
      </div>

      {showFilters ? (
        <div className="glass mt-4 grid grid-cols-2 gap-3 p-3 sm:flex sm:flex-wrap sm:items-end">
          <label className="text-xs text-muted-foreground"><span className="mb-1 block">Start from</span>
            <input type="date" className={cn(inputClass, "h-9 w-full text-xs sm:w-40")} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label className="text-xs text-muted-foreground"><span className="mb-1 block">Start to</span>
            <input type="date" className={cn(inputClass, "h-9 w-full text-xs sm:w-40")} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          {!myBranchId && activeBranches.length > 1 ? (
            <label className="text-xs text-muted-foreground"><span className="mb-1 block">Branch</span>
              <select className={cn(inputClass, "sm:w-40")} value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}>
                <option value="">All branches</option>
                {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></label>
          ) : null}
          <label className="text-xs text-muted-foreground"><span className="mb-1 block">Status</span>
            <select className={cn(inputClass, "sm:w-48")} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as StatusFilter })}>
              <option value="all">All status</option>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select></label>
          <label className="text-xs text-muted-foreground"><span className="mb-1 block">Payment</span>
            <select className={cn(inputClass, "sm:w-36")} value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value as Pay })}>
              {(Object.keys(PAY_LABELS) as Pay[]).map((p) => <option key={p} value={p}>{PAY_LABELS[p]}</option>)}
            </select></label>
        </div>
      ) : null}

      {chips.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button key={c.label} type="button" onClick={() => setF({ ...f, ...c.clear })} aria-label={`Remove filter ${c.label}`}
              className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs hover:bg-gold/20">{c.label} <X className="h-3 w-3" /></button>
          ))}
          <button type="button" onClick={clearAll} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Clear all</button>
        </div>
      ) : null}

      <div className="mt-4">
        {ledger === null ? <div className="glass rounded-xl px-4 py-10 text-center text-sm text-muted-foreground">Loading...</div>
          : rows.length === 0 ? (
            <div className="glass rounded-xl px-4 py-10 text-center text-sm text-muted-foreground">
              {isFiltered ? <><p>No records match your search or filters.</p><button className={cn(ghostButtonClass, "mt-3")} onClick={clearAll}>Clear filters</button></> : <p>No ledger records for {rangeText}.</p>}
            </div>
          ) : (
            <>
              <div className="glass hidden overflow-x-auto xl:block">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="bg-muted/70 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>{["Token", "Customer", "Item", "Period", "Total", "Paid", "Balance", "Payment", "Status"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-3 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => {
                      const nDays = Math.max(1, Math.ceil((Date.parse(r.end_at) - Date.parse(r.start_at)) / 86_400_000));
                      return (
                        <tr key={r.id} onClick={() => router.push(`/rentals/${r.id}`)} className="cursor-pointer hover:bg-black/[0.02]">
                          <td className="px-3 py-2.5">
                            <span className="flex items-center gap-1.5"><span className="font-mono text-xs text-gold">{r.token}</span>
                              {r.status === "reserved" ? <span className="rounded border border-gold/30 bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gold">Booked</span> : null}</span>
                          </td>
                          <td className="px-3 py-2.5"><p className="whitespace-nowrap font-medium">{r.customers?.full_name}</p><p className="font-mono text-[11px] text-muted-foreground">{r.customers?.phone || "—"}</p></td>
                          <td className="max-w-[14rem] truncate px-3 py-2.5">{itemsSummary(r.rental_lines)}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-xs"><div>{fmtDate(r.start_at, tz)} → {fmtDate(r.end_at, tz)}</div><div className="text-muted-foreground">{nDays} day{nDays === 1 ? "" : "s"}</div></td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono font-semibold">{totalCell(r)}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono text-emerald">{rupees(r.paid)}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono"><span className={balanceOf(r) > 0 ? "font-semibold text-rust" : "font-medium text-emerald"}>{rupees(balanceOf(r))}</span></td>
                          <td className="px-3 py-2.5">{paymentCell(r)}</td>
                          <td className="px-3 py-2.5"><RentalStatusBadge rental={r} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:hidden">
                {rows.map((r) => (
                  <div key={r.id} onClick={() => router.push(`/rentals/${r.id}`)} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") router.push(`/rentals/${r.id}`); }}
                    className="glass cursor-pointer rounded-xl p-4 transition-colors hover:bg-black/[0.02]">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><span className="font-mono text-xs text-gold">{r.token}</span>
                        {r.status === "reserved" ? <span className="rounded border border-gold/30 bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-gold">Booked</span> : null}</span>
                      <RentalStatusBadge rental={r} />
                    </div>
                    <p className="font-semibold">{r.customers?.full_name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{itemsSummary(r.rental_lines)}</p>
                    <div className="my-3 grid grid-cols-2 gap-3 rounded-lg bg-muted/70 p-3 text-xs">
                      <div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Period</p><p className="mt-0.5 font-medium">{fmtDate(r.start_at, tz)}</p><p className="font-medium">{fmtDate(r.end_at, tz)}</p></div>
                      <div className="text-right"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Total</p><p className="mt-0.5 font-mono text-sm font-semibold">{totalCell(r)}</p></div>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/50 pt-2 text-xs">
                      <span className="font-semibold text-muted-foreground">Payment</span>{paymentCell(r)}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="font-semibold text-muted-foreground">Balance</span>
                      <span className={cn("font-mono text-sm", balanceOf(r) > 0 ? "font-semibold text-rust" : "font-medium text-emerald")}>{rupees(balanceOf(r))}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
      </div>

      {payFor ? <PaymentDialog rental={payFor} open onClose={() => setPayFor(null)} onDone={() => { void load(); void loadLedger(); }} /> : null}
    </>
  );
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
