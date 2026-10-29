"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Calendar, MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_LIST_COLUMNS } from "@/lib/shop/api";
import { addDays, dayRange, errorText, fmtDate, fmtTime, plural, rupees, todayLocal } from "@/lib/shop/format";
import type { ListRental } from "@/components/shop/RentalList";
import { PageHeader, RentalStatusBadge, ghostButtonClass, goldButtonClass, inputClass } from "@/components/shop/ui";

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
  const { tz, activeBranches, branches, myBranchId, canManage, trendz } = useShop();
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

  const card = (r: Row) => {
    const pickupToday = r.status === "reserved" && fmtDate(r.start_at, tz) === fmtDate(today);
    const nDays = Math.max(1, Math.ceil((Date.parse(r.end_at) - Date.parse(r.start_at)) / 86_400_000));
    const due = Math.max(0, Number(r.total) - Number(r.paid));
    const cancelled = r.status === "cancelled" || r.status === "no_show";
    const buffer = r.free_at ? Math.max(0, Math.round((Date.parse(r.free_at) - Date.parse(r.end_at)) / 86_400_000)) : 0;
    return (
      <Link key={r.id} href={`/rentals/${r.id}`}
        className={cn("block space-y-3 rounded-xl border bg-surface p-4 transition-colors hover:bg-black/[0.02]", pickupToday ? "border-gold/50 shadow-md shadow-gold/5" : "border-border")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-semibold text-gold">{r.token}</span>
            <RentalStatusBadge rental={r} />
            {pickupToday ? <span className="rounded border border-gold/30 bg-gold/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">Pickup today</span> : null}
          </div>
          {activeBranches.length > 1 ? <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5 text-gold" />{branchName(r.branch_id)}</span> : null}
        </div>
        <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</span>
            <p className="truncate text-sm font-semibold">{r.customers?.full_name}</p>
            <p className="font-mono text-emerald">{r.customers?.phone}</p>
          </div>
          <div className="rounded-lg border border-border p-2">
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gold"><Calendar className="h-3 w-3" /> Pickup / give date</span>
            <p className="font-mono text-sm font-semibold text-gold">{fmtDate(r.start_at, tz)} <span className="text-xs font-normal">{fmtTime(r.start_at, tz)}</span></p>
            <p className="text-[10px] text-muted-foreground">Return: {fmtDate(r.end_at, tz)} {fmtTime(r.end_at, tz)}</p>
          </div>
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Schedule</span>
            {trendz ? <>
              <p className="font-mono text-muted-foreground">Buffer: <strong className="text-foreground">{buffer} day(s)</strong></p>
              <p className="font-mono text-muted-foreground">Available: <strong className="text-emerald">{r.free_at ? fmtDate(r.free_at, tz) : "-"}</strong></p>
            </> : <>
              <p className="font-mono text-muted-foreground">Duration: <strong className="text-foreground">{plural(nDays, "day")}</strong></p>
              <p className="text-muted-foreground">{(r.rental_lines ?? []).map((l) => (l.qty > 1 ? `${l.qty} × ` : "") + l.description).join(", ")}</p>
            </>}
          </div>
          {canManage ? (
            <div className="sm:text-right">
              <span className={cn("block text-[10px] font-semibold uppercase tracking-wider", cancelled ? "text-rust" : "text-muted-foreground")}>{cancelled ? "Cancelled" : "Payment summary"}</span>
              <p className={cn("font-mono text-sm font-semibold", cancelled ? "text-muted-foreground" : "text-emerald")}>{rupees(r.total)}</p>
              <p className="font-mono text-[11px] text-muted-foreground">Paid: <strong className="text-emerald">{rupees(r.paid)}</strong> · Rem: <strong className="text-gold">{rupees(cancelled ? 0 : due)}</strong></p>
              <p className="font-mono text-[10px] text-muted-foreground">Dep: {rupees(r.deposit_received ?? 0)}</p>
            </div>
          ) : null}
          <div className="border-t border-border/50 pt-2 sm:col-span-2 lg:col-span-4">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Assigned pieces</span>
            <div className="mt-1 flex flex-col gap-1">
              {trendz && r.rental_lines?.length
                ? <p className="text-muted-foreground"><span className="font-semibold text-foreground">{(r.rental_lines ?? []).map((l) => (l.qty > 1 ? `${l.qty} × ` : "") + l.description).join(", ")}</span></p> : null}
              <p className="font-mono text-emerald">{r.pieces?.length ? r.pieces.join(", ") : "No pieces kept"}</p>
            </div>
          </div>
        </div>
      </Link>
    );
  };

  return (
    <>
      <PageHeader title="Bookings Management"
        subtitle={rows ? `${total}${more ? "+" : ""} booking${total === 1 ? "" : "s"} found · ${status === "completed" || status === "cancelled" ? "newest first" : "sorted by upcoming pickup date"}` : "Loading..."}
        actions={<Link href="/scan" className={goldButtonClass}>New rental</Link>} />

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
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
            Pickup on <input type="date" className={cn(inputClass, "w-44")} value={customDay} onChange={(e) => setCustomDay(e.target.value)} />
          </label>
        ) : null}
      </div>

      {rows === null ? <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p> : rows.length === 0 ? (
        <div className="rounded-xl border border-border p-12 text-center">
          <Calendar className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
          <h3 className="mt-2 text-lg font-semibold">{status === "all" && doneCount > 0 ? "No active bookings" : "No bookings found"}</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{term || day !== "all" ? "No bookings match the search and filters." : status === "all" && doneCount > 0 ? "There are no current bookings matching your criteria." : "No bookings here yet."}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {rows.map(card)}
          {more ? <button className={cn(ghostButtonClass, "mx-auto")} onClick={() => void load(rows.length)}>Show more</button> : null}
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
