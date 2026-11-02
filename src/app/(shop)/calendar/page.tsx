"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_LIST_COLUMNS } from "@/lib/shop/api";
import { addDays, errorText, fmtTime, isoToZoned, rupees, todayLocal, zonedToIso } from "@/lib/shop/format";
import { isoToDisplay } from "@/components/shop/DateInput";
import { itemsSummary, type ListRental } from "@/components/shop/RentalList";
import { Panel, Skeleton, inputClass } from "@/components/shop/ui";

// Calendar: only two things matter at a glance, when a pickup is due and when a return is due.
// A booking that has not gone out shows its pickup and its return; one that is out shows its return; a returned one is gone.
// Pickups and returns have their own colours, and anything late is red. Tapping a day lists them; tapping one opens the booking.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Booking = ListRental;
type Kind = "pickup" | "return";
interface CalEvent { key: string; kind: Kind; day: string; at: string; late: boolean; booking: Booking }

const COLOURS = {
  pickup: { chip: "bg-indigo-500/15 text-indigo-700 border-indigo-500/25", dot: "bg-indigo-500", label: "Pickup" },
  return: { chip: "bg-emerald/15 text-emerald border-emerald/30", dot: "bg-emerald", label: "Return" },
  late: { chip: "bg-rust/15 text-rust border-rust/30", dot: "bg-rust", label: "Late" },
};
const colourOf = (e: CalEvent) => (e.late ? COLOURS.late : COLOURS[e.kind]);

const pad = (n: number) => String(n).padStart(2, "0");
const monthKey = (iso: string) => iso.slice(0, 7);
// the 6 weeks of a month, Sunday first, as YYYY-MM-DD
function gridDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = `${y}-${pad(m)}-01`;
  const weekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const start = addDays(first, -weekday);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

export default function Calendar() {
  const { tz, activeBranches, myBranchId } = useShop();
  const today = todayLocal(tz);
  const [month, setMonth] = useState(monthKey(today));
  const [selected, setSelected] = useState(today);
  const [branch, setBranch] = useState(myBranchId ?? "");
  const [rows, setRows] = useState<Booking[] | null>(null);

  // the weeks shown: a month that fits in five weeks shows five (kept as one array so the data is not fetched again by accident)
  const shown = useMemo(() => {
    const all = gridDays(month);
    return all.slice(35).every((d) => monthKey(d) !== month) ? all.slice(0, 35) : all;
  }, [month]);

  const load = useCallback(async () => {
    const from = zonedToIso(`${shown[0]}T00:00`, tz);
    const to = zonedToIso(`${addDays(shown[shown.length - 1], 1)}T00:00`, tz);
    // only bookings still to be picked up or still out: a returned one has nothing left to show
    let q = createClient().from("rentals").select(RENTAL_LIST_COLUMNS).in("status", ["reserved", "active"])
      .lt("start_at", to).gt("end_at", from).order("start_at").limit(1000);
    if (branch) q = q.eq("branch_id", branch);
    const { data, error } = await q;
    if (error) { toast.error(errorText(error)); setRows([]); return; }
    setRows((data as unknown as Booking[]) ?? []);
  }, [shown, tz, branch]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  // the events: pickup and return days
  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    const now = Date.now();
    const add = (e: CalEvent) => { if (e.day >= shown[0] && e.day <= shown[shown.length - 1]) map.set(e.day, [...(map.get(e.day) ?? []), e]); };
    for (const b of rows ?? []) {
      if (b.status === "reserved") add({ key: `${b.id}-p`, kind: "pickup", day: isoToZoned(b.start_at, tz).slice(0, 10), at: b.start_at, late: Date.parse(b.start_at) < now, booking: b });
      add({ key: `${b.id}-r`, kind: "return", day: isoToZoned(b.end_at, tz).slice(0, 10), at: b.end_at, late: b.status === "active" && Date.parse(b.end_at) < now, booking: b });
    }
    for (const list of map.values()) list.sort((a, c) => a.at.localeCompare(c.at));
    return map;
  }, [rows, tz, shown]);

  const [y, m] = month.split("-").map(Number);
  const dayList = byDay.get(selected) ?? [];
  const pickups = dayList.filter((e) => e.kind === "pickup");
  const returns = dayList.filter((e) => e.kind === "return");

  const goMonth = (by: number) => { const next = shiftMonth(month, by); setMonth(next); setSelected(monthKey(today) === next ? today : `${next}-01`); };
  const goToday = () => { setMonth(monthKey(today)); setSelected(today); };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* the arrows sit on either side of the month: they move by a month, not a day */}
        <div className="flex items-center gap-1 sm:gap-2">
          <button type="button" onClick={() => goMonth(-1)} aria-label="Previous month" className="flex h-10 w-10 items-center justify-center rounded-lg border border-border hover:bg-black/5"><ChevronLeft className="h-4 w-4" /></button>
          <h1 className="min-w-[10.5rem] text-center font-display text-xl font-semibold sm:min-w-[13rem] sm:text-2xl"><span>{MONTHS[m - 1]}</span> <span className="font-normal text-muted-foreground">{y}</span></h1>
          <button type="button" onClick={() => goMonth(1)} aria-label="Next month" className="flex h-10 w-10 items-center justify-center rounded-lg border border-border hover:bg-black/5"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeBranches.length > 1 && !myBranchId ? (
            <select className={cn(inputClass, "w-auto")} aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All branches</option>
              {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : null}
          <button type="button" onClick={goToday} className="h-10 rounded-lg border border-border px-4 text-sm font-medium hover:bg-black/5">Today</button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-full", COLOURS.pickup.dot)} /> Pickup due</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-full", COLOURS.return.dot)} /> Return due</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-full", COLOURS.late.dot)} /> Late</span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* the month */}
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" role="grid" aria-label={`${MONTHS[m - 1]} ${y}`}>
          <div className="grid grid-cols-7 border-b border-border bg-muted/40" role="row">
            {WEEKDAYS.map((w) => <div key={w} role="columnheader" className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{w}</div>)}
          </div>
          <div className="grid grid-cols-7" role="rowgroup">
            {shown.map((d, i) => {
              const list = byDay.get(d) ?? [];
              const inMonth = monthKey(d) === month;
              const isToday = d === today;
              const isSel = d === selected;
              return (
                <button key={d} type="button" role="gridcell" aria-selected={isSel}
                  aria-label={`${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}, ${list.length ? `${list.length} pickup or return${list.length > 1 ? "s" : ""}` : "nothing due"}`}
                  onClick={() => { setSelected(d); if (!inMonth) setMonth(monthKey(d)); }}
                  className={cn("flex min-h-[3.75rem] flex-col items-stretch gap-1 border-b border-r border-border/60 p-1.5 text-left transition-colors hover:bg-gold/[0.04] sm:min-h-[6.25rem] sm:p-2",
                    i % 7 === 6 && "border-r-0", i >= shown.length - 7 && "border-b-0", isSel && "bg-gold/10", !inMonth && "bg-muted/20")}>
                  <span className={cn("flex h-6 w-6 items-center justify-center self-start rounded-full text-xs font-medium sm:h-7 sm:w-7 sm:text-sm",
                    isToday ? "bg-gold font-semibold text-white" : isSel ? "ring-2 ring-gold" : inMonth ? "text-foreground" : "text-muted-foreground/60")}>
                    {Number(d.slice(8))}
                  </span>
                  {/* big screens: chips; phones: dots */}
                  <span className="hidden flex-col gap-0.5 sm:flex">
                    {list.slice(0, 3).map((e) => (
                      <span key={e.key} className={cn("flex items-center gap-1 truncate rounded border px-1.5 py-px text-[11px] leading-4", colourOf(e).chip)}>
                        {e.kind === "pickup" ? <ArrowUpRight className="h-3 w-3 shrink-0" /> : <ArrowDownLeft className="h-3 w-3 shrink-0" />}
                        <span className="truncate">{e.booking.customers?.full_name ?? e.booking.token}</span>
                      </span>
                    ))}
                    {list.length > 3 ? <span className="px-1 text-[11px] font-medium text-muted-foreground">+{list.length - 3} more</span> : null}
                  </span>
                  <span className="flex flex-wrap gap-0.5 sm:hidden">
                    {list.slice(0, 4).map((e) => <span key={e.key} className={cn("h-1.5 w-1.5 rounded-full", colourOf(e).dot)} />)}
                  </span>
                </button>
              );
            })}
          </div>
          {rows === null ? <div className="border-t border-border p-3"><Skeleton className="h-3 w-40" /></div> : null}
        </div>

        {/* the day */}
        <Panel title={<span>{Number(selected.slice(8))} {MONTHS[Number(selected.slice(5, 7)) - 1]} <span className="font-normal text-muted-foreground">{selected === today ? "· today" : isoToDisplay(selected)}</span></span>}>
          {rows === null ? <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
            : dayList.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No pickup or return due this day.</p> : (
              <div className="space-y-4">
                <DayGroup title="Pickups due" items={pickups} tz={tz} />
                <DayGroup title="Returns due" items={returns} tz={tz} />
              </div>
            )}
        </Panel>
      </div>
    </>
  );
}

function DayGroup({ title, items, tz }: { title: string; items: CalEvent[]; tz: string }) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title} ({items.length})</h3>
      <ul className="space-y-2">
        {items.map((e) => {
          const b = e.booking;
          const due = Number(b.total) - Number(b.paid);
          return (
            <li key={e.key}>
              <Link href={`/rentals/${b.id}`} className="flex min-h-14 items-start gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-black/[0.02]">
                <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", colourOf(e).dot)} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="truncate text-sm font-semibold">{b.customers?.full_name ?? "Customer"}</span>
                    <span className="font-mono text-xs text-muted-foreground">{fmtTime(e.at, tz)}</span>
                    {e.late ? <span className="rounded bg-rust/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-rust">Late</span> : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{itemsSummary(b.rental_lines) || "No items"}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono text-gold">{b.token}</span>
                    {due > 0 ? <span className="font-mono text-muted-foreground">due {rupees(due)}</span> : null}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
