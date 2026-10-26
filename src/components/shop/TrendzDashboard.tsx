"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, MessageCircle, Plus, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_LIST_COLUMNS, call } from "@/lib/shop/api";
import { dayRange, errorText, fmtDateTime, rupees, todayLocal } from "@/lib/shop/format";
import { quickMessage, waLink, type QuickKind } from "@/lib/shop/whatsapp";
import { RentalList, itemsSummary, type ListRental } from "./RentalList";
import { BalanceBadge, Panel, RentalStatusBadge, SummaryCard, ghostButtonClass, goldButtonClass, inputClass, tableWrap, theadClass } from "./ui";

// The TRENDZ dashboard for bridal and groom shops: today's work in three cards (tap one to see its list
// with Hand over / Return / WhatsApp), money still to collect, and every rental that is out.
type Queue = "pickups" | "returns" | "overdue";
type SortKey = "end_at" | "start_at" | "name" | "token" | "balance";

async function loadAll(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const rows: ListRental[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data as ListRental[]) ?? [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const balanceOf = (r: ListRental) => Math.max(0, Math.round((Number(r.total) - Number(r.paid)) * 100) / 100);

export function TrendzDashboard() {
  const { shop, tz, branches, activeBranches, myBranchId, canManage } = useShop();
  const [pickups, setPickups] = useState<ListRental[] | null>(null);
  const [out, setOut] = useState<ListRental[] | null>(null);
  const [unitsOut, setUnitsOut] = useState(0);
  const [picked, setPicked] = useState<Queue | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ListRental[] | null>(null);
  const [sort, setSort] = useState<SortKey>("end_at");
  const [asc, setAsc] = useState(true);
  const [branch, setBranch] = useState(myBranchId ?? "");
  const [payment, setPayment] = useState<"" | "paid" | "partial" | "unpaid">("");
  const today = todayLocal(tz);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { to: endOfToday } = dayRange(today, tz);
    try {
      const [p, o, u] = await Promise.all([
        loadAll((f, t) => supabase.from("rentals").select(RENTAL_LIST_COLUMNS).eq("status", "reserved").lt("start_at", endOfToday).order("start_at").order("id").range(f, t)),
        loadAll((f, t) => supabase.from("rentals").select(RENTAL_LIST_COLUMNS).eq("status", "active").order("end_at").order("id").range(f, t)),
        supabase.from("unit_reservations").select("id", { count: "exact", head: true }).eq("state", "out"),
      ]);
      setPickups(p);
      setOut(o);
      setUnitsOut(u.count ?? 0);
    } catch (e) {
      toast.error("Could not load the dashboard: " + errorText(e));
      setPickups((x) => x ?? []);
      setOut((x) => x ?? []);
    }
  }, [today, tz]);
  useEffect(() => { void load(); }, [load]);

  // live: another counter books, hands over or takes back something
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout>;
    const channel = supabase.channel("dashboard-rentals")
      .on("postgres_changes", { event: "*", schema: "public", table: "rentals" }, () => { clearTimeout(timer); timer = setTimeout(() => void load(), 1500); })
      .subscribe();
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [load]);

  const now = Date.now();
  const { to: endOfToday } = dayRange(today, tz);
  const overdue = useMemo(() => (out ?? []).filter((r) => Date.parse(r.end_at) < now), [out, now]);
  const dueToday = useMemo(() => (out ?? []).filter((r) => Date.parse(r.end_at) >= now && r.end_at < endOfToday), [out, now, endOfToday]);
  const toCollect = (out ?? []).reduce((s, r) => s + balanceOf(r), 0);
  // the list under the cards: what was tapped, else the most urgent one that has something
  const queue: Queue = picked ?? (overdue.length ? "overdue" : pickups?.length ? "pickups" : "returns");
  const queueRows = queue === "pickups" ? pickups ?? [] : queue === "returns" ? dueToday : overdue;

  const remind = async (kind: QuickKind, r: ListRental) => {
    const b = branches.find((x) => x.id === r.branch_id);
    window.open(waLink(r.customers?.phone ?? "", quickMessage(kind, r, { shopName: shop.name, tz, phone: b?.phone ?? shop.phone })), "_blank", "noopener");
    try { await call("mark_reminder_sent", { p_rental_id: r.id, p_kind: kind }); } catch { /* the message still went */ }
  };

  const search = async (text: string) => {
    const q = text.trim();
    if (!q) return setResults(null);
    const supabase = createClient();
    const like = `%${q.replace(/[%_,()*]/g, "")}%`;
    const [byToken, customers, units, lines] = await Promise.all([
      supabase.from("rentals").select(RENTAL_LIST_COLUMNS).ilike("token", like).order("created_at", { ascending: false }).limit(20),
      supabase.from("customers").select("id").or(`full_name.ilike.${like},phone.ilike.${like}`).limit(20),
      supabase.from("units").select("id").ilike("code", like).limit(20),
      supabase.from("rental_lines").select("rental_id").ilike("sku", like).limit(50),
    ]);
    const found = new Map<string, ListRental>();
    const add = (rows: unknown) => ((rows as ListRental[]) ?? []).forEach((r) => found.set(r.id, r));
    add(byToken.data);
    const customerIds = (customers.data ?? []).map((c) => c.id);
    const rentalIds = new Set((lines.data ?? []).map((l) => l.rental_id));
    const unitIds = (units.data ?? []).map((u) => u.id);
    if (unitIds.length) {
      const { data } = await supabase.from("unit_reservations").select("rental_id").in("unit_id", unitIds).in("state", ["held", "out"]);
      (data ?? []).forEach((x) => rentalIds.add(x.rental_id));
    }
    const [byCustomer, byId] = await Promise.all([
      customerIds.length ? supabase.from("rentals").select(RENTAL_LIST_COLUMNS).in("customer_id", customerIds).order("start_at", { ascending: false }).limit(30) : null,
      rentalIds.size ? supabase.from("rentals").select(RENTAL_LIST_COLUMNS).in("id", Array.from(rentalIds).slice(0, 50)).order("start_at", { ascending: false }) : null,
    ]);
    add(byCustomer?.data);
    add(byId?.data);
    setResults(Array.from(found.values()));
  };

  const table = useMemo(() => {
    const rows = (out ?? []).filter((r) => (!branch || r.branch_id === branch) && (!payment
      || (payment === "paid" ? balanceOf(r) <= 0 : payment === "unpaid" ? Number(r.paid) <= 0 && balanceOf(r) > 0 : Number(r.paid) > 0 && balanceOf(r) > 0)));
    const key = (r: ListRental): string | number => sort === "name" ? (r.customers?.full_name ?? "").toLowerCase()
      : sort === "token" ? r.token : sort === "balance" ? balanceOf(r) : r[sort];
    return [...rows].sort((a, b) => { const x = key(a); const y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1); });
  }, [out, branch, payment, sort, asc]);

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "";
  const cards: { key: Queue; label: string; count: number; tone: string }[] = [
    { key: "pickups", label: "Pickups today", count: pickups?.length ?? 0, tone: "text-foreground" },
    { key: "returns", label: "Returns due today", count: dueToday.length, tone: "text-gold" },
    { key: "overdue", label: "Overdue", count: overdue.length, tone: "text-rust" },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">Dashboard</h1>
        <Link href="/scan" className={goldButtonClass}><Plus className="h-4 w-4" /> New rental</Link>
      </div>

      <form className="relative mt-5" onSubmit={(e) => { e.preventDefault(); void search(query); }}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input type="search" className={cn(inputClass, "h-11 pl-9 pr-9")} placeholder="Search token, customer, phone or SKU…" aria-label="Search rentals"
          value={query} onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setResults(null); }} />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setResults(null); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        ) : null}
      </form>
      {results !== null ? (
        <Panel className="mt-3" title={`Search results (${results.length})`}>
          <RentalList rentals={results} empty="Nothing found. Try part of a name, phone, booking number or SKU." />
        </Panel>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <button key={c.key} type="button" onClick={() => setPicked(c.key)} aria-pressed={queue === c.key}
            className={cn("glass p-3 text-left transition-colors hover:border-gold/25 sm:p-4", queue === c.key && "border-gold/60 ring-1 ring-gold/30")}>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:text-[11px]">{c.label}</p>
            <p className={cn("mt-2 font-mono text-2xl font-semibold", c.count ? c.tone : "text-foreground")}>{pickups === null ? "—" : c.count}</p>
          </button>
        ))}
        {canManage
          ? <SummaryCard label="To collect" value={rupees(toCollect)} hint={`on ${out?.length ?? 0} rentals out`} tone={toCollect > 0 ? "rust" : "emerald"} />
          : <SummaryCard label="Items out" value={unitsOut} hint={`${out?.length ?? 0} rentals`} />}
      </div>

      <section className="glass mt-4 rounded-xl p-3 sm:p-5" aria-label="Today's work">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{cards.find((c) => c.key === queue)?.label}</h2>
        {queueRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {queue === "pickups" ? "No pickups today." : queue === "returns" ? "No returns due today." : "Nothing overdue. All clear."}
          </p>
        ) : (
          <ul className="mt-3 flex max-h-[24rem] flex-col gap-2 overflow-y-auto pr-1">
            {queueRows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2.5">
                <Link href={`/rentals/${r.id}`} className="min-w-0 flex-1 basis-48">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gold">{r.token}</span>
                    <span className="truncate text-sm font-medium">{r.customers?.full_name}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {itemsSummary(r.rental_lines)}{activeBranches.length > 1 ? ` · ${branchName(r.branch_id)}` : ""} · {queue === "pickups" ? "from " + fmtDateTime(r.start_at, tz) : "due " + fmtDateTime(r.end_at, tz)}
                  </span>
                </Link>
                <div className="ml-auto flex items-center gap-2">
                  {canManage && balanceOf(r) > 0 ? <span className="font-mono text-xs text-rust">{rupees(balanceOf(r))} due</span> : null}
                  {queue === "pickups"
                    ? <Link href={`/rentals/${r.id}?handover=1`} className={cn(goldButtonClass, "px-3 py-1.5 text-xs")}>Hand over</Link>
                    : <Link href={`/rentals/${r.id}?receive=1`} className={cn(goldButtonClass, "px-3 py-1.5 text-xs")}>Return</Link>}
                  <button type="button" aria-label="WhatsApp reminder" title="WhatsApp reminder"
                    onClick={() => void remind(queue === "pickups" ? "pickup_reminder" : queue === "returns" ? "return_reminder" : "overdue", r)}
                    className="rounded-md border border-emerald/20 bg-emerald/10 p-2 text-emerald hover:bg-emerald/20">
                    <MessageCircle className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>


      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Active Rentals</h2>
          <span className="rounded-md bg-black/5 px-2 py-1 font-mono text-xs text-muted-foreground">{table.length} active</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!myBranchId && activeBranches.length > 1 ? (
            <select className={cn(inputClass, "w-auto py-1.5")} aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All branches</option>
              {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : null}
          {canManage ? (
            <select className={cn(inputClass, "w-auto py-1.5")} aria-label="Payment" value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)}>
              <option value="">All payments</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="unpaid">Unpaid</option>
            </select>
          ) : null}
          <select className={cn(inputClass, "w-auto py-1.5")} aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="end_at">Sort by due date</option><option value="start_at">Sort by date</option><option value="name">Sort by name</option>
            <option value="token">Sort by token</option>{canManage ? <option value="balance">Sort by balance</option> : null}
          </select>
          <button type="button" className={cn(ghostButtonClass, "px-2")} onClick={() => setAsc((x) => !x)} aria-label={asc ? "Sorted ascending, switch to descending" : "Sorted descending, switch to ascending"}>
            <ArrowUpDown className="h-4 w-4" />
          </button>
          <button type="button" className={ghostButtonClass} disabled={refreshing} onClick={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin text-gold")} /> {refreshing ? "Syncing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div className={tableWrap}>
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className={theadClass}>
            <tr>
              <th className="px-4 py-3">Token</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Item</th>
              {activeBranches.length > 1 ? <th className="px-4 py-3">Branch</th> : null}
              <th className="px-4 py-3">Qty</th><th className="px-4 py-3">Due date</th>
              {canManage ? <th className="px-4 py-3 text-right">Balance</th> : null}
              <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {out === null ? <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
              : table.length === 0 ? <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">Nothing is out right now.</td></tr>
              : table.map((r) => (
                <tr key={r.id} className="hover:bg-black/[0.02]">
                  <td className="px-4 py-2"><Link href={`/rentals/${r.id}`} className="font-mono text-xs text-gold hover:underline">{r.token}</Link></td>
                  <td className="px-4 py-2"><p className="font-medium">{r.customers?.full_name}</p><p className="font-mono text-xs text-muted-foreground">{r.customers?.phone}</p></td>
                  <td className="max-w-[16rem] truncate px-4 py-2">{itemsSummary(r.rental_lines)}</td>
                  {activeBranches.length > 1 ? <td className="px-4 py-2 text-muted-foreground">{branchName(r.branch_id)}</td> : null}
                  <td className="px-4 py-2 font-mono">{(r.rental_lines ?? []).reduce((s, l) => s + l.qty, 0)}</td>
                  <td className={cn("whitespace-nowrap px-4 py-2", Date.parse(r.end_at) < now && "font-semibold text-rust")}>{fmtDateTime(r.end_at, tz)}</td>
                  {canManage ? <td className="px-4 py-2 text-right font-mono">{rupees(balanceOf(r))}</td> : null}
                  <td className="px-4 py-2"><span className="flex flex-wrap gap-1"><RentalStatusBadge rental={r} />{canManage ? <BalanceBadge rental={r} /> : null}</span></td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-flex gap-1.5">
                      <Link href={`/rentals/${r.id}?receive=1`} className={cn(goldButtonClass, "px-3 py-1.5 text-xs")}>Return</Link>
                      <Link href={`/rentals/${r.id}`} className={cn(ghostButtonClass, "px-3 py-1.5 text-xs")}>Open</Link>
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
