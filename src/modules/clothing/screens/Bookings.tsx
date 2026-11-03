"use client";

import { useCallback, useEffect, useState } from "react";
import { DateInput, isoToDisplay } from "@/components/shop/DateInput";
import Link from "next/link";
import { Calendar, Search, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_LIST_COLUMNS } from "@/lib/shop/api";
import { addDays, dayRange, errorText, fmtDate, isoToZoned, plural, rupees, todayLocal } from "@/lib/shop/format";
import type { ListRental } from "@/components/shop/RentalList";
import { PageHeader, RentalStatusBadge, ghostButtonClass, goldButtonClass, inputClass, ListSkeleton } from "@/components/shop/ui";

// Bookings, as in TRENDZ: cards sorted by the next pickup, filtered by pickup day, status and branch.
// A card opens the booking (hand over, change, cancel, money). Returned ones wait under "Completed Bookings".
type Status = "reserved" | "active" | "completed" | "cancelled" | "all";
type Day = "all" | "today" | "tomorrow" | "custom";
const PAGE = 60;
type Row = ListRental & { pieces: string[]; deposit_received?: number; free_at: string | null };

// the end of a held period, from "[start,end)" as the database prints it
function holdEnd(period: string) {
  const parts = period.match(/"([^"]+)"/g)?.map((x) => x.slice(1, -1));
  const end = parts?.[1];
  if (!end) return null;
  const iso = end.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export default function Bookings() {
  const { tz, activeBranches, branches, myBranchId, canManage } = useShop();
  const [status, setStatus] = useState<Status>("all");
  const [day, setDay] = useState<Day>("all");
  const [customDay, setCustomDay] = useState("");
  const [branch, setBranch] = useState(myBranchId ?? "");
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [more, setMore] = useState(false);
  const [done, setDone] = useState<Row[] | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const [showDone, setShowDone] = useState(false);
  // on a wide screen a tap on a booking shows its summary beside the list; on a phone or tablet it opens the booking
  const [sel, setSel] = useState<Row | null>(null);
  const today = todayLocal(tz);
  const tomorrow = addDays(today, 1);

  useEffect(() => { const t = setTimeout(() => setTerm(query.trim()), 300); return () => clearTimeout(t); }, [query]);

  // one page of bookings with the given statuses, under the day, branch and search filters
  const fetchPage = useCallback(async (statuses: string[], from: number) => {
    const supabase = createClient();
    let q = supabase.from("rentals").select(RENTAL_LIST_COLUMNS + ", deposit_received", { count: "exact" }).in("status", statuses);
    const pickDay = day === "today" ? today : day === "tomorrow" ? tomorrow : day === "custom" ? customDay : "";
    if (pickDay) { const r = dayRange(pickDay, tz); q = q.gte("start_at", r.from).lt("start_at", r.to); }
    if (branch) q = q.eq("branch_id", branch);
    if (term) {
      const like = `%${term.replace(/[%_,()*]/g, "")}%`;
      const [c, l] = await Promise.all([
        supabase.from("customers").select("id").or(`full_name.ilike.${like},phone.ilike.${like}`).limit(200),
        supabase.from("rental_lines").select("rental_id").or(`sku.ilike.${like},description.ilike.${like}`).limit(300),
      ]);
      const ors = [`token.ilike.${like}`];
      const cids = (c.data ?? []).map((x) => x.id);
      const rids = Array.from(new Set((l.data ?? []).map((x) => x.rental_id))).slice(0, 100); // keeps the address short
      if (cids.length) ors.push(`customer_id.in.(${cids.join(",")})`);
      if (rids.length) ors.push(`id.in.(${rids.join(",")})`);
      q = q.or(ors.join(","));
    }
    // upcoming pickups first; finished ones newest first
    const finished = statuses.every((s) => s === "completed" || s === "cancelled" || s === "no_show");
    q = finished ? q.order("start_at", { ascending: false }) : q.order("start_at");
    const { data, count, error } = await q.order("id").range(from, from + PAGE - 1);
    if (error) { toast.error(errorText(error)); return null; }
    const page = (data as unknown as Row[]) ?? [];
    // the pieces kept for each booking, and when they are free again
    if (page.length) {
      const { data: res } = await supabase.from("unit_reservations").select("rental_id, period, units!unit_reservations_shop_unit_fkey(code)")
        .in("rental_id", page.map((r) => r.id)).neq("state", "released");
      const byRental = new Map<string, string[]>();
      const freeAt = new Map<string, string>();
      for (const x of (res ?? []) as unknown as { rental_id: string; period: string; units: { code: string } | null }[]) {
        byRental.set(x.rental_id, [...(byRental.get(x.rental_id) ?? []), x.units?.code ?? ""]);
        const end = holdEnd(String(x.period));
        if (end && (!freeAt.has(x.rental_id) || end > freeAt.get(x.rental_id)!)) freeAt.set(x.rental_id, end);
      }
      page.forEach((r) => { r.pieces = (byRental.get(r.id) ?? []).sort(); r.free_at = freeAt.get(r.id) ?? null; });
    }
    return { page, count: count ?? page.length };
  }, [day, customDay, branch, term, today, tomorrow, tz]);

  const statuses = status === "all" ? ["reserved", "active", "cancelled", "no_show"] : status === "cancelled" ? ["cancelled", "no_show"] : [status];
  const load = useCallback(async (from = 0) => {
    const r = await fetchPage(statuses, from);
    if (!r) return;
    setRows((prev) => (from === 0 ? r.page : [...(prev ?? []), ...r.page]));
    setMore(r.page.length === PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, status]);
  useEffect(() => { setRows(null); void load(0); }, [load]);

  // returned bookings sit under their own heading while every status is shown
  const loadDone = useCallback(async (from = 0) => {
    if (status !== "all") { setDone(null); setDoneCount(0); return; }
    const r = await fetchPage(["completed"], from);
    if (!r) return;
    setDone((prev) => (from === 0 ? r.page : [...(prev ?? []), ...r.page]));
    setDoneCount(r.count);
  }, [fetchPage, status]);
  useEffect(() => { void loadDone(0); }, [loadDone]);

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "";
  const total = (rows?.length ?? 0);

  // A booking is one short row: who, when, what and what is still owed. The booking page has the rest.
  const dmy = (iso: string) => isoToDisplay(isoToZoned(iso, tz).slice(0, 10));
  const card = (r: Row) => {
    const pickupToday = r.status === "reserved" && fmtDate(r.start_at, tz) === fmtDate(today);
    const nDays = Math.max(1, Math.round((Date.parse(isoToZoned(r.end_at, tz).slice(0, 10)) - Date.parse(isoToZoned(r.start_at, tz).slice(0, 10))) / 86_400_000));
    const due = Math.max(0, Number(r.total) - Number(r.paid));
    const cancelled = r.status === "cancelled" || r.status === "no_show";
    const items = (r.rental_lines ?? []).map((l) => (l.qty > 1 ? `${l.qty} × ` : "") + l.description).join(", ");
    return (
      <Link key={r.id} href={`/rentals/${r.id}`}
        onClick={(e) => { if (window.matchMedia("(min-width: 1440px)").matches) { e.preventDefault(); setSel(r); } }}
        className={cn("grid gap-x-4 gap-y-1.5 rounded-2xl border bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgb(16_23_21/4%),0_8px_24px_-14px_rgb(16_23_21/12%)] transition-colors hover:bg-accent/40 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto] sm:items-center",
          sel?.id === r.id ? "border-neon ring-2 ring-neon/40" : pickupToday ? "border-gold/50" : "border-transparent")}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-gold">{r.token}</span>
            <RentalStatusBadge rental={r} />
            {pickupToday ? <span className="rounded border border-gold/30 bg-gold/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">Pickup today</span> : null}
          </div>
          <p className="mt-0.5 truncate text-sm font-semibold">{r.customers?.full_name} <span className="font-mono text-xs font-normal text-muted-foreground">{r.customers?.phone}</span></p>
        </div>
        <div className="min-w-0 text-xs">
          <p className="font-mono text-sm text-foreground">{dmy(r.start_at)} <span className="text-muted-foreground">→</span> {dmy(r.end_at)} <span className="text-xs text-muted-foreground">· {plural(nDays, "day")}</span></p>
          <p className="truncate text-muted-foreground">
            {items || "No items"}{r.pieces?.length ? <span className="font-mono text-emerald"> · {r.pieces.join(", ")}</span> : null}
            {activeBranches.length > 1 ? <span> · {branchName(r.branch_id)}</span> : null}
          </p>
        </div>
        {canManage ? (
          <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right">
            <p className={cn("font-mono text-sm font-semibold", cancelled ? "text-muted-foreground" : due > 0 ? "text-amber" : "text-emerald")}>
              {cancelled ? "Cancelled" : due > 0 ? `Due ${rupees(due)}` : "Paid"}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">Total {rupees(r.total)}</p>
          </div>
        ) : null}
      </Link>
    );
  };

  const panel = (r: Row) => {
    const due = Math.max(0, Number(r.total) - Number(r.paid));
    const pcs = (r.rental_lines ?? []).reduce((n, l) => n + l.qty, 0);
    const line = (k: string, v: string, tone = "") => <div className="flex items-baseline justify-between gap-3 py-2"><span className="text-sm text-muted-foreground">{k}</span><span className={cn("font-mono text-sm font-semibold", tone)}>{v}</span></div>;
    return (
      <aside className="glass sticky top-6 hidden self-start p-5 min-[1440px]:block" aria-label="Booking summary">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold text-gold">{r.token}</p>
            <h2 className="mt-1 truncate font-display text-xl font-bold">{r.customers?.full_name}</h2>
            <p className="font-mono text-xs text-muted-foreground">{r.customers?.phone}</p>
          </div>
          <button type="button" aria-label="Close summary" onClick={() => setSel(null)} className="rounded-full p-1.5 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3"><RentalStatusBadge rental={r} /></div>
        <div className="mt-4 rounded-xl bg-accent/60 p-3 text-sm">
          <p className="font-mono">{dmy(r.start_at)} <span className="text-muted-foreground">→</span> {dmy(r.end_at)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{plural(pcs, "piece")}{activeBranches.length > 1 ? ` · ${branchName(r.branch_id)}` : ""}</p>
        </div>
        <ul className="mt-3 space-y-1 text-sm">
          {(r.rental_lines ?? []).map((l, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{l.description}</span><span className="font-mono text-muted-foreground">× {l.qty}</span></li>)}
        </ul>
        {r.pieces?.length ? <p className="mt-2 font-mono text-xs text-emerald">{r.pieces.join(", ")}</p> : null}
        {canManage ? (
          <div className="mt-4 divide-y divide-border border-t border-border">
            {line("Total", rupees(r.total))}
            {line("Paid", rupees(r.paid))}
            {line("Balance", due > 0 ? rupees(due) : "Paid", due > 0 ? "text-amber" : "text-emerald")}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {r.status === "reserved" ? <Link href={`/rentals/${r.id}?handover=1`} className={goldButtonClass}>Hand over</Link> : null}
          {r.status === "active" ? <Link href={`/rentals/${r.id}?receive=1`} className={goldButtonClass}>Return</Link> : null}
          <Link href={`/rentals/${r.id}`} className={cn(ghostButtonClass, "py-2")}>Open booking</Link>
        </div>
      </aside>
    );
  };

  return (
    <>
      <PageHeader title="Bookings Management"
        subtitle={rows ? `${total}${more ? "+" : ""} booking${total === 1 ? "" : "s"} found · ${status === "completed" || status === "cancelled" ? "newest first" : "sorted by upcoming pickup date"}` : "Loading..."}
        actions={<Link href="/scan" className={goldButtonClass}>New rental</Link>} />

      <div className="glass mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputClass, "pl-9")} placeholder="Search customer, phone, token, SKU..." aria-label="Search bookings" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className={inputClass} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
          <option value="all">All statuses</option>
          <option value="reserved">Booked (awaiting pickup)</option>
          <option value="active">Out (picked up)</option>
          <option value="completed">Returned</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className={inputClass} aria-label="Pickup date" value={day} onChange={(e) => setDay(e.target.value as Day)}>
          <option value="all">All pickup dates</option>
          <option value="today">Pickups today ({fmtDate(today)})</option>
          <option value="tomorrow">Pickups tomorrow ({fmtDate(tomorrow)})</option>
          <option value="custom">Custom date</option>
        </select>
        {!myBranchId && activeBranches.length > 1 ? (
          <select className={inputClass} aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>
            {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : <span className="hidden lg:block" />}
        {day === "custom" ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
            Pickup on <DateInput className="w-44" value={customDay} onChange={(v) => setCustomDay(v)} />
          </label>
        ) : null}
      </div>

      {rows === null ? <ListSkeleton /> : rows.length === 0 ? (
        <div className="rounded-xl border border-border p-12 text-center">
          <Calendar className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
          <h3 className="mt-2 text-lg font-semibold">{status === "all" && doneCount > 0 ? "No active bookings" : "No bookings found"}</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{term || day !== "all" ? "No bookings match the search and filters." : status === "all" && doneCount > 0 ? "There are no current bookings matching your criteria." : "No bookings here yet."}</p>
        </div>
      ) : (
        <div className={cn("grid gap-4", sel && "min-[1440px]:grid-cols-[minmax(0,1fr)_22rem]")}>
          <div className="grid content-start gap-4">
            {rows.map(card)}
            {more ? <button className={cn(ghostButtonClass, "mx-auto")} onClick={() => void load(rows.length)}>Show more</button> : null}
          </div>
          {sel ? panel(sel) : null}
        </div>
      )}

      {status === "all" && doneCount > 0 ? (
        <div className="mt-8 border-t border-border/50 pt-6">
          <button type="button" onClick={() => setShowDone((x) => !x)} aria-expanded={showDone} className="group flex w-full items-center justify-between py-2">
            <span className="flex items-center gap-3">
              <h3 className="text-lg font-semibold text-muted-foreground transition-colors group-hover:text-foreground">Completed Bookings</h3>
              <span className="rounded-md bg-black/5 px-2 py-1 font-mono text-xs text-muted-foreground">{doneCount} completed</span>
            </span>
            <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">{showDone ? "Hide" : "Show"}</span>
          </button>
          {showDone ? (
            <div className="mt-6 grid gap-4">
              {(done ?? []).map(card)}
              {done && done.length < doneCount ? <button className={cn(ghostButtonClass, "mx-auto")} onClick={() => void loadDone(done.length)}>Show more ({doneCount - done.length} left)</button> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
