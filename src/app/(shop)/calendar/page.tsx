"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { addDays, dayRange, errorText, todayLocal } from "@/lib/shop/format";
import { useCatalog, variationLabel } from "@/lib/shop/useCatalog";
import type { Unit } from "@/lib/shop/types";
import { PageHeader, Panel, StatusBadge, ghostButtonClass, inputClass } from "@/components/shop/ui";

interface Booking {
  id: string;
  unit_id: string;
  period: string;
  state: "held" | "out" | "returned" | "released";
  rental_id: string;
  rentals: { token: string; status: string; end_at: string; actual_end_at: string | null; customers: { full_name: string } | null } | null;
}

// "[\"2026-10-31 08:30:00+00\",\"2026-11-02 08:30:00+00\")" -> instants
function parseRange(range: string) {
  const [a, b] = range.replace(/[[\]()"]/g, "").split(",");
  return { from: Date.parse(a.trim().replace(" ", "T").replace(/\+00$/, "Z")), to: Date.parse(b.trim().replace(" ", "T").replace(/\+00$/, "Z")) };
}

export default function Calendar() {
  const router = useRouter();
  const { tz, activeBranches, myBranchId, categories, templateOf, word } = useShop();
  const [branch, setBranch] = useState(myBranchId ?? activeBranches[0]?.id ?? "");
  const [cat, setCat] = useState("");
  const [start, setStart] = useState(todayLocal(tz));
  const [span, setSpan] = useState(14);
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const { products } = useCatalog({ includeInactive: true });

  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) setSpan(7);
  }, []);
  useEffect(() => { if (!branch && activeBranches[0]) setBranch(myBranchId ?? activeBranches[0].id); }, [activeBranches, branch, myBranchId]);

  const from = dayRange(start, tz).from;
  const to = dayRange(addDays(start, span - 1), tz).to;

  const load = useCallback(async () => {
    if (!branch) return;
    const supabase = createClient();
    const [u, b] = await Promise.all([
      supabase.from("units").select("*").eq("branch_id", branch).neq("status", "retired").order("code"),
      supabase.from("unit_reservations")
        .select("id, unit_id, period, state, rental_id, rentals!unit_reservations_shop_rental_fkey(token, status, end_at, actual_end_at, customers!rentals_shop_customer_fkey(full_name))")
        .neq("state", "released").filter("period", "ov", `[${from},${to})`),
    ]);
    const err = u.error ?? b.error;
    if (err) toast.error(errorText(err));
    setUnits((u.data as Unit[]) ?? []);
    setBookings((b.data as unknown as Booking[]) ?? []);
  }, [branch, from, to]);
  useEffect(() => { void load(); }, [load]);

  const names = useMemo(() => {
    const m = new Map<string, { label: string; category: string; productId: string }>();
    for (const p of products ?? []) for (const v of p.product_variations ?? []) m.set(v.id, { label: variationLabel(p, v), category: p.category_id, productId: p.id });
    return m;
  }, [products]);

  const rows = (units ?? []).filter((u) => !cat || names.get(u.variation_id)?.category === cat)
    .sort((a, b) => (names.get(a.variation_id)?.label ?? "").localeCompare(names.get(b.variation_id)?.label ?? "") || a.code.localeCompare(b.code, undefined, { numeric: true }));
  const days = Array.from({ length: span }, (_, i) => addDays(start, i));
  const t0 = Date.parse(from);
  const t1 = Date.parse(to);
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - t0) / (t1 - t0)) * 100));
  const today = todayLocal(tz);
  const nowPct = pct(Date.now());

  return (
    <>
      <PageHeader title="Calendar" subtitle={`Who has which ${word("unit").toLowerCase()} when. Click a booking to open it.`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className={ghostButtonClass} aria-label="Earlier" onClick={() => setStart(addDays(start, -span))}><ChevronLeft className="h-4 w-4" /></button>
        <input type="date" className={cn(inputClass, "w-auto")} aria-label="From" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
        <button className={ghostButtonClass} aria-label="Later" onClick={() => setStart(addDays(start, span))}><ChevronRight className="h-4 w-4" /></button>
        <button className={ghostButtonClass} onClick={() => setStart(today)}>Today</button>
        <select className={cn(inputClass, "w-auto")} aria-label="Days shown" value={span} onChange={(e) => setSpan(Number(e.target.value))}>
          {[7, 14, 30].map((n) => <option key={n} value={n}>{n} days</option>)}
        </select>
        {!myBranchId && activeBranches.length > 1 ? (
          <select className={cn(inputClass, "w-auto")} aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
            {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : null}
        {categories.length > 1 ? (
          <select className={cn(inputClass, "w-auto")} aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : null}
      </div>

      <Panel className="overflow-x-auto p-0">
        <div className="min-w-[720px]">
          <div className="flex border-b border-border text-[11px] text-muted-foreground">
            <div className="w-44 shrink-0 px-3 py-2 sm:w-56">{word("unit")}</div>
            <div className="flex flex-1">
              {days.map((d) => {
                const date = new Date(d + "T12:00:00Z");
                return (
                  <div key={d} className={cn("flex-1 border-l border-border px-1 py-2 text-center", d === today && "bg-gold/10 font-semibold text-foreground")}>
                    {date.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}<br />{date.getUTCDate()}
                  </div>
                );
              })}
            </div>
          </div>
          {units === null ? <p className="p-4 text-sm text-muted-foreground">Loading...</p> : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No {word("units").toLowerCase()} in this branch.</p>
          ) : rows.map((u) => {
            const info = names.get(u.variation_id);
            const kind = templateOf(info?.category)?.kind;
            const mine = bookings.filter((b) => b.unit_id === u.id);
            return (
              <div key={u.id} className="flex border-b border-border last:border-0">
                <Link href={info ? `/catalog/${info.productId}` : "#"} className="w-44 shrink-0 px-3 py-2 hover:bg-black/[0.02] sm:w-56">
                  <span className="block font-mono text-xs font-semibold">{u.code}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{info?.label}</span>
                  {u.status !== "available" ? <StatusBadge tone="rust" className="mt-0.5">{u.status_reason || u.status}</StatusBadge> : null}
                </Link>
                <div className={cn("relative flex-1", u.status !== "available" && "bg-rust/5")}
                  onClick={(e) => {
                    if (e.target !== e.currentTarget || u.status !== "available") return;
                    router.push(`/book?variation=${u.variation_id}`);
                  }}
                  title={u.status === "available" ? "Free: click to book" : undefined}>
                  <div className="absolute inset-0 flex">{days.map((d) => <div key={d} className={cn("flex-1 border-l border-border/60", d === today && "bg-gold/5")} />)}</div>
                  {nowPct > 0 && nowPct < 100 ? <div className="absolute inset-y-0 w-px bg-rust/60" style={{ left: `${nowPct}%` }} /> : null}
                  {mine.map((b) => {
                    const range = parseRange(b.period);
                    const endUse = Date.parse(b.rentals?.actual_end_at ?? b.rentals?.end_at ?? new Date(range.to).toISOString());
                    const left = pct(range.from);
                    const useWidth = pct(Math.min(endUse, range.to)) - left;
                    const turnWidth = pct(range.to) - pct(Math.min(endUse, range.to));
                    return (
                      <Link key={b.id} href={`/rentals/${b.rental_id}`}
                        title={`${b.rentals?.token} · ${b.rentals?.customers?.full_name ?? ""}`}
                        className="absolute top-1.5 flex h-[calc(100%-12px)] min-h-7 overflow-hidden rounded-md text-[11px] shadow-sm"
                        style={{ left: `${left}%`, width: `${Math.max(useWidth + turnWidth, 0.8)}%` }}>
                        <span className={cn("flex h-full items-center truncate px-1.5 font-medium",
                          b.state === "out" ? "bg-gold/80 text-white" : b.state === "returned" ? "bg-muted text-muted-foreground" : "bg-indigo/80 text-white")}
                          style={{ width: `${(useWidth / Math.max(useWidth + turnWidth, 0.0001)) * 100}%` }}>
                          {b.rentals?.customers?.full_name ?? b.rentals?.token}
                        </span>
                        {turnWidth > 0 ? (
                          <span className="h-full flex-1 bg-[repeating-linear-gradient(45deg,var(--muted),var(--muted)_4px,transparent_4px,transparent_8px)]"
                            title={kind === "room" ? "Housekeeping" : kind === "vehicle" ? "Service time" : "Cleaning"} />
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-indigo/80" /> Booked</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-gold/80" /> Out / checked in</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-muted" /> Returned</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-[repeating-linear-gradient(45deg,var(--muted),var(--muted)_4px,transparent_4px,transparent_8px)]" /> Cleaning / service time</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-px bg-rust" /> Now</span>
      </div>
    </>
  );
}
