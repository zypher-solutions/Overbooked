"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarPlus, ScanLine, Search } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_LIST_COLUMNS } from "@/lib/shop/api";
import { addDays, dayRange, errorText, fmtDate, todayLocal } from "@/lib/shop/format";
import { CameraScanner } from "@/components/overbooked/CameraScanner";
import { RentalList, type ListRental } from "@/components/shop/RentalList";
import { RemindersPanel } from "@/components/shop/RemindersPanel";
import { PageHeader, Panel, StatusBadge, SummaryCard, ghostButtonClass, goldButtonClass, inputClass } from "@/components/shop/ui";

interface Board { pickups: ListRental[]; returns: ListRental[]; upcoming: ListRental[]; outNow: number }

export default function Today() {
  const { tz, word } = useShop();
  const [board, setBoard] = useState<Board | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ListRental[] | null>(null);
  const [unitHits, setUnitHits] = useState<{ id: string; code: string; status: string; status_reason: string | null; product_id: string; products: { name: string } | null }[]>([]);
  const [scanning, setScanning] = useState(false);
  const today = todayLocal(tz);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { to: endOfToday } = dayRange(today, tz);
    const weekEnd = dayRange(addDays(today, 7), tz).to;
    const [p, r, u, o] = await Promise.all([
      supabase.from("rentals").select(RENTAL_LIST_COLUMNS).eq("status", "reserved").lt("start_at", endOfToday).order("start_at"),
      supabase.from("rentals").select(RENTAL_LIST_COLUMNS).eq("status", "active").lt("end_at", endOfToday).order("end_at"),
      supabase.from("rentals").select(RENTAL_LIST_COLUMNS).eq("status", "reserved").gte("start_at", endOfToday).lt("start_at", weekEnd)
        .order("start_at").limit(50),
      supabase.from("rentals").select("id", { count: "exact", head: true }).eq("status", "active"),
    ]);
    const err = p.error ?? r.error ?? u.error;
    if (err) toast.error("Could not load today's bookings: " + errorText(err));
    setBoard({
      pickups: (p.data as unknown as ListRental[]) ?? [],
      returns: (r.data as unknown as ListRental[]) ?? [],
      upcoming: (u.data as unknown as ListRental[]) ?? [],
      outNow: o.count ?? 0,
    });
  }, [today, tz]);

  useEffect(() => { void load(); }, [load]);

  // live: another counter books or returns something
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout>;
    const channel = supabase.channel("today-rentals")
      .on("postgres_changes", { event: "*", schema: "public", table: "rentals" }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void load(), 1500);
      })
      .subscribe();
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [load]);

  const search = async (text: string) => {
    const q = text.trim();
    if (!q) { setUnitHits([]); return setResults(null); }
    const supabase = createClient();
    const like = `%${q.replace(/[%_,()*]/g, "")}%`;
    const [byToken, customers, units] = await Promise.all([
      supabase.from("rentals").select(RENTAL_LIST_COLUMNS).ilike("token", like).order("created_at", { ascending: false }).limit(20),
      supabase.from("customers").select("id").or(`full_name.ilike.${like},phone.ilike.${like}`).limit(20),
      supabase.from("units").select("id, code, status, status_reason, product_id, products!units_shop_product_fkey(name)").ilike("code", like).limit(20),
    ]);
    const ids = new Set<string>();
    const found: ListRental[] = [];
    const add = (rows: ListRental[] | null) => rows?.forEach((r) => { if (!ids.has(r.id)) { ids.add(r.id); found.push(r); } });
    add(byToken.data as unknown as ListRental[]);
    const customerIds = (customers.data ?? []).map((c) => c.id);
    if (customerIds.length) {
      const { data } = await supabase.from("rentals").select(RENTAL_LIST_COLUMNS).in("customer_id", customerIds)
        .order("start_at", { ascending: false }).limit(30);
      add(data as unknown as ListRental[]);
    }
    const unitIds = (units.data ?? []).map((u) => u.id);
    if (unitIds.length) {
      const { data: res } = await supabase.from("unit_reservations").select("rental_id").in("unit_id", unitIds).in("state", ["held", "out"]);
      const rentalIds = Array.from(new Set((res ?? []).map((x) => x.rental_id)));
      if (rentalIds.length) {
        const { data } = await supabase.from("rentals").select(RENTAL_LIST_COLUMNS).in("id", rentalIds).order("start_at");
        add(data as unknown as ListRental[]);
      }
    }
    setUnitHits((units.data as never) ?? []);
    setResults(found);
  };

  return (
    <>
      <PageHeader title="Today" subtitle={fmtDate(today)}
        actions={<Link href="/book" className={goldButtonClass}><CalendarPlus className="h-4 w-4" /> New booking</Link>} />

      <form className="mb-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(query); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={inputClass + " pl-9"} placeholder={`Booking number, customer name or phone, ${word("unit").toLowerCase()} code`}
            aria-label="Search bookings" value={query} onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setResults(null); }} />
        </div>
        <button type="submit" className={ghostButtonClass}>Search</button>
        <button type="button" className={ghostButtonClass} onClick={() => setScanning(true)} aria-label="Scan a code"><ScanLine className="h-4 w-4" /></button>
      </form>

      {results !== null ? (
        <Panel className="mb-5" title={`Search results (${results.length + unitHits.length})`}
          actions={<button className="text-xs text-gold hover:underline" onClick={() => { setResults(null); setQuery(""); }}>Clear</button>}>
          {unitHits.length ? (
            <ul className="mb-2 flex flex-wrap gap-2">
              {unitHits.map((u) => (
                <li key={u.id}>
                  <Link href={`/catalog/${u.product_id}`} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:border-gold/40">
                    <span className="font-mono font-semibold">{u.code}</span>
                    <span className="text-muted-foreground">{u.products?.name}</span>
                    <StatusBadge tone={u.status === "available" ? "emerald" : "rust"}>{u.status === "available" ? "Available" : u.status_reason || u.status}</StatusBadge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <RentalList rentals={results} empty={unitHits.length ? "No current booking for this piece." : "Nothing found. Try part of a name, phone number or booking number."} />
        </Panel>
      ) : null}

      <RemindersPanel />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="To hand over" value={board?.pickups.length ?? "—"} hint="Today and missed" tone={board?.pickups.length ? "gold" : "default"} />
        <SummaryCard label="Due back" value={board?.returns.length ?? "—"} hint="Today and overdue" tone={board?.returns.length ? "rust" : "default"} />
        <SummaryCard label="Out now" value={board?.outNow ?? "—"} />
        <SummaryCard label="Next 7 days" value={board?.upcoming.length ?? "—"} hint="Bookings starting" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`To hand over (${word("start").toLowerCase()})`}>
          {board ? <RentalList rentals={board.pickups} when="start" empty="Nothing to hand over today." /> : <p className="text-sm text-muted-foreground">Loading...</p>}
        </Panel>
        <Panel title={`Due back (${word("end").toLowerCase()})`}>
          {board ? <RentalList rentals={board.returns} when="end" empty="Nothing due back today." /> : <p className="text-sm text-muted-foreground">Loading...</p>}
        </Panel>
        <Panel title="Coming up this week" className="lg:col-span-2">
          {board ? <RentalList rentals={board.upcoming} when="start" empty="No bookings in the next 7 days." /> : <p className="text-sm text-muted-foreground">Loading...</p>}
        </Panel>
      </div>

      {scanning ? (
        <CameraScanner onClose={() => setScanning(false)} onScan={(text) => { setScanning(false); setQuery(text); void search(text); }} />
      ) : null}
    </>
  );
}
