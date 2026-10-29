"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, MessageCircle, Plus, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_LIST_COLUMNS, call } from "@/lib/shop/api";
import { dayRange, errorText, fmtDate, fmtDateTime, rupees, todayLocal } from "@/lib/shop/format";
import { quickMessage, waLink, type QuickKind } from "@/lib/shop/whatsapp";
import { searchRentalIds } from "@/lib/shop/searchRentals";
import type { ListRental } from "@/components/shop/RentalList";
import { itemsSummary } from "@/components/shop/RentalList";
import { BalanceBadge, RentalStatusBadge, SummaryCard, ghostButtonClass, goldButtonClass, inputClass } from "@/components/shop/ui";

// The TRENDZ dashboard for bridal and groom shops: today's work in three cards (tap one to see its list
// with Hand over / Return / WhatsApp), money still to collect, every rental that is out, and the finished
// ones under "Completed Rentals". Search and the Filter panel narrow both lists.
type Queue = "pickups" | "returns" | "overdue";
type SortKey = "end_at" | "start_at" | "name" | "token" | "balance";
type Pay = "all" | "paid" | "partial" | "unpaid";
interface Filters { from: string; to: string; branch: string; status: "all" | "out" | "returned"; payment: Pay }
type Row = ListRental & { actual_end_at?: string | null; pieces: string[]; image: string | null };

const DONE_PAGE = 50;
const PAYMENT_LABELS: Record<Pay, string> = { all: "All payments", paid: "Paid", partial: "Partial", unpaid: "Unpaid" };

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

// the pieces held for each rental and the picture of its first item
async function enrich(rows: ListRental[]): Promise<Row[]> {
  if (!rows.length) return [];
  const supabase = createClient();
  const pieces = new Map<string, string[]>();
  const images = new Map<string, string>();
  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map((r) => r.id);
    const [res, lines] = await Promise.all([
      supabase.from("unit_reservations").select("rental_id, units!unit_reservations_shop_unit_fkey(code)").in("rental_id", ids).neq("state", "released"),
      supabase.from("rental_lines").select("rental_id, image_url").in("rental_id", ids).not("image_url", "is", null),
    ]);
    for (const x of (res.data ?? []) as unknown as { rental_id: string; units: { code: string } | null }[]) {
      pieces.set(x.rental_id, [...(pieces.get(x.rental_id) ?? []), x.units?.code ?? ""]);
    }
    for (const l of lines.data ?? []) if (l.image_url && !images.has(l.rental_id)) images.set(l.rental_id, l.image_url);
  }
  return rows.map((r) => ({ ...r, pieces: (pieces.get(r.id) ?? []).filter(Boolean).sort(), image: images.get(r.id) ?? null }));
}

export function TrendzDashboard() {
  const router = useRouter();
  const { shop, tz, branches, activeBranches, myBranchId, canManage } = useShop();
  const [pickups, setPickups] = useState<ListRental[] | null>(null);
  const [out, setOut] = useState<Row[] | null>(null);
  const [done, setDone] = useState<Row[] | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const [unitsOut, setUnitsOut] = useState(0);
  const [picked, setPicked] = useState<Queue | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIds, setMatchIds] = useState<string[] | null>(null);
  const [sort, setSort] = useState<SortKey>("end_at");
  const [asc, setAsc] = useState(true);
  const blank: Filters = { from: "", to: "", branch: myBranchId ?? "", status: "all", payment: "all" };
  const [f, setF] = useState<Filters>(blank);
  const [showFilters, setShowFilters] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const today = todayLocal(tz);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { to: endOfToday } = dayRange(today, tz);
    try {
      const [p, o, u] = await Promise.all([
        loadAll((a, b) => supabase.from("rentals").select(RENTAL_LIST_COLUMNS).eq("status", "reserved").lt("start_at", endOfToday).order("start_at").order("id").range(a, b)),
        loadAll((a, b) => supabase.from("rentals").select(RENTAL_LIST_COLUMNS).eq("status", "active").order("end_at").order("id").range(a, b)),
        supabase.from("unit_reservations").select("id", { count: "exact", head: true }).eq("state", "out"),
      ]);
      setPickups(p);
      setOut(await enrich(o));
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

  // search by token, customer, phone, SKU or piece code; it narrows both lists below
  useEffect(() => {
    const q = query.trim();
    if (!q) { setMatchIds(null); return; }
    const t = setTimeout(async () => { setMatchIds(await searchRentalIds(q)); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // Completed Rentals: the newest returns first, a page at a time
  const loadDone = useCallback(async (from = 0) => {
    if (f.status === "out") { setDone([]); setDoneCount(0); return; }
    if (matchIds !== null && matchIds.length === 0) { setDone([]); setDoneCount(0); return; }
    const supabase = createClient();
    let q = supabase.from("rentals").select(RENTAL_LIST_COLUMNS, { count: "exact" }).eq("status", "completed");
    if (f.branch) q = q.eq("branch_id", f.branch);
    if (f.from) q = q.gte("start_at", dayRange(f.from, tz).from);
    if (f.to) q = q.lt("start_at", dayRange(f.to, tz).to);
    if (matchIds !== null) q = q.in("id", matchIds.slice(0, 300));
    const { data, count, error } = await q.order("actual_end_at", { ascending: false }).order("id").range(from, from + DONE_PAGE - 1);
    if (error) { toast.error(errorText(error)); return; }
    const rows = await enrich((data as unknown as ListRental[]) ?? []);
    setDone((prev) => (from === 0 ? rows : [...(prev ?? []), ...rows]));
    setDoneCount(count ?? rows.length);
  }, [f.status, f.branch, f.from, f.to, matchIds, tz]);
  useEffect(() => { void loadDone(0); }, [loadDone]);
  // asking for Returned opens the list by itself
  useEffect(() => { if (f.status === "returned") setShowDone(true); }, [f.status]);

  const now = Date.now();
  const { to: endOfToday } = dayRange(today, tz);
  const queueOut = useMemo(() => out ?? [], [out]);
  const overdue = useMemo(() => queueOut.filter((r) => Date.parse(r.end_at) < now), [queueOut, now]);
  const dueToday = useMemo(() => queueOut.filter((r) => Date.parse(r.end_at) >= now && r.end_at < endOfToday), [queueOut, now, endOfToday]);
  const toCollect = queueOut.reduce((s, r) => s + balanceOf(r), 0);
  // the list under the cards: what was tapped, else the most urgent one that has something
  const queue: Queue = picked ?? (overdue.length ? "overdue" : pickups?.length ? "pickups" : "returns");
  const queueRows = queue === "pickups" ? pickups ?? [] : queue === "returns" ? dueToday : overdue;

  const remind = async (kind: QuickKind, r: ListRental) => {
    const b = branches.find((x) => x.id === r.branch_id);
    window.open(waLink(r.customers?.phone ?? "", quickMessage(kind, r, { shopName: shop.name, tz, phone: b?.phone ?? shop.phone })), "_blank", "noopener");
    try { await call("mark_reminder_sent", { p_rental_id: r.id, p_kind: kind }); } catch { /* the message still went */ }
  };

  const paymentOk = (r: ListRental) => f.payment === "all"
    || (f.payment === "paid" ? balanceOf(r) <= 0 : f.payment === "unpaid" ? Number(r.paid) <= 0 && balanceOf(r) > 0 : Number(r.paid) > 0 && balanceOf(r) > 0);
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
  const keep = (r: Row) => (!f.branch || r.branch_id === f.branch) && paymentOk(r)
    && (!f.from || dayOf(r.start_at) >= f.from) && (!f.to || dayOf(r.start_at) <= f.to)
    && (matchIds === null || matchIds.includes(r.id));
  const key = (r: Row): string | number => sort === "name" ? (r.customers?.full_name ?? "").toLowerCase()
    : sort === "token" ? r.token : sort === "balance" ? balanceOf(r) : r[sort];
  const order = (rows: Row[]) => [...rows].sort((a, b) => { const x = key(a); const y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1); });
  const table = useMemo(() => (f.status === "returned" ? [] : order((out ?? []).filter(keep))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [out, f, matchIds, sort, asc, tz]);
  const doneRows = useMemo(() => (done ?? []).filter((r) => paymentOk(r) && (matchIds === null || matchIds.includes(r.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [done, f.payment, matchIds]);

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "";
  const cards: { key: Queue; label: string; count: number; tone: string }[] = [
    { key: "pickups", label: "Pickups today", count: pickups?.length ?? 0, tone: "text-foreground" },
    { key: "returns", label: "Returns due today", count: dueToday.length, tone: "text-gold" },
    { key: "overdue", label: "Overdue", count: overdue.length, tone: "text-rust" },
  ];

  const chips: { label: string; clear: Partial<Filters> }[] = [];
  if (f.from) chips.push({ label: `From ${fmtDate(f.from)}`, clear: { from: "" } });
  if (f.to) chips.push({ label: `To ${fmtDate(f.to)}`, clear: { to: "" } });
  if (f.branch !== blank.branch) chips.push({ label: branchName(f.branch) || "All branches", clear: { branch: blank.branch } });
  if (f.status !== "all") chips.push({ label: f.status === "out" ? "Out" : "Returned", clear: { status: "all" } });
  if (f.payment !== "all") chips.push({ label: PAYMENT_LABELS[f.payment], clear: { payment: "all" } });
  const isFiltered = chips.length > 0 || query.trim() !== "";
  const clearAll = () => { setF(blank); setQuery(""); };

  const toggleSort = (k: SortKey) => { if (k === sort) setAsc((a) => !a); else { setSort(k); setAsc(k === "name" || k === "token" || k === "end_at"); } };
  const head = (label: string, k?: SortKey, className?: string) => (
    <th className={cn("whitespace-nowrap px-3 py-3", className)} aria-sort={k && k === sort ? (asc ? "ascending" : "descending") : undefined}>
      {k ? (
        <button type="button" onClick={() => toggleSort(k)} className={cn("inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground", k === sort && "text-foreground")}>
          {label}{k === sort ? (asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
        </button>
      ) : label}
    </th>
  );

  const dueCell = (r: Row, finished: boolean) => {
    const late = !finished && Date.parse(r.end_at) < now;
    const daysLeft = Math.ceil((Date.parse(r.end_at) - now) / 86_400_000);
    return (
      <>
        <div className="font-medium">{fmtDate(r.end_at, tz)}</div>
        {finished ? <div className="text-muted-foreground">{r.actual_end_at ? `Returned ${fmtDate(r.actual_end_at, tz)}` : "Returned"}</div>
          : late ? <span className="mt-0.5 inline-block rounded border border-rust/40 bg-rust/10 px-1.5 py-0.5 text-[10px] font-semibold text-rust">OVERDUE</span>
          : <div className={daysLeft > 0 ? "text-muted-foreground" : "font-semibold text-gold"}>{daysLeft > 0 ? `${daysLeft}d left` : "Due today"}</div>}
      </>
    );
  };
  const wa = (r: Row, finished: boolean, size = "p-1.5") => (
    <button type="button" aria-label={finished ? "WhatsApp" : "WhatsApp reminder"} title={finished ? "WhatsApp" : "WhatsApp reminder"}
      onClick={(e) => { e.stopPropagation(); void remind(Date.parse(r.end_at) < now ? "overdue" : "return_reminder", r); }}
      className={cn("rounded-md border border-emerald/20 bg-emerald/10 text-emerald hover:bg-emerald/20", size)}>
      <MessageCircle className="h-3.5 w-3.5" />
    </button>
  );

  const itemCell = (r: Row) => (
    <div className="flex items-center gap-2.5">
      {r.image ? <img src={r.image} alt="" width={32} height={32} loading="lazy" className="h-8 w-8 rounded-md border border-border object-cover" /> : <span className="h-8 w-8 shrink-0 rounded-md border border-border bg-muted/60" />}
      <div className="min-w-0">
        <p className="max-w-[14rem] truncate font-medium">{itemsSummary(r.rental_lines)}</p>
        {r.pieces.length ? <p className="max-w-[14rem] truncate font-mono text-[11px] text-foreground">{r.pieces.join(", ")}</p> : null}
      </div>
    </div>
  );

  const tableRow = (r: Row, finished: boolean) => {
    const late = !finished && Date.parse(r.end_at) < now;
    return (
      <tr key={r.id} onClick={() => router.push(`/rentals/${r.id}`)} className={cn("cursor-pointer hover:bg-black/[0.02]", late && "bg-rust/5")}>
        <td className="px-3 py-2.5"><span className="font-mono text-xs text-gold">{r.token}</span></td>
        <td className="px-3 py-2.5"><p className="whitespace-nowrap font-medium">{r.customers?.full_name}</p><p className="font-mono text-[11px] text-muted-foreground">{r.customers?.phone || "—"}</p></td>
        <td className="px-3 py-2.5">{itemCell(r)}</td>
        {activeBranches.length > 1 ? <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">{branchName(r.branch_id)}</td> : null}
        <td className="px-3 py-2.5 text-center font-mono font-semibold">{(r.rental_lines ?? []).reduce((s, l) => s + l.qty, 0)}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-xs">{dueCell(r, finished)}</td>
        {canManage ? <td className="whitespace-nowrap px-3 py-2.5 font-mono text-sm"><span className={balanceOf(r) > 0 ? "font-semibold text-rust" : "text-muted-foreground"}>{balanceOf(r) > 0 ? rupees(balanceOf(r)) : "—"}</span></td> : null}
        <td className="px-3 py-2.5"><span className="flex flex-wrap gap-1"><RentalStatusBadge rental={r} />{canManage ? <BalanceBadge rental={r} /> : null}</span></td>
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <span className="flex items-center gap-2">
            {!finished ? <>
              <Link href={`/rentals/${r.id}?receive=1`} className={cn(goldButtonClass, "px-3 py-1.5 text-xs")}>Return</Link>
              <Link href={`/rentals/${r.id}`} className={ghostButtonClass}>Edit</Link>
            </> : null}
            {wa(r, finished)}
          </span>
        </td>
      </tr>
    );
  };

  const card = (r: Row, finished: boolean) => {
    const late = !finished && Date.parse(r.end_at) < now;
    return (
      <div key={r.id} onClick={() => router.push(`/rentals/${r.id}`)} role="link" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") router.push(`/rentals/${r.id}`); }}
        className={cn("glass cursor-pointer rounded-xl border p-4 transition-colors hover:bg-black/[0.02]", late ? "border-rust/50 shadow-md shadow-rust/5" : "border-border")}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <span className="font-mono text-xs text-gold">{r.token}</span>
          <span className="flex flex-wrap items-center gap-1"><RentalStatusBadge rental={r} />{canManage && !finished && balanceOf(r) > 0 ? <span className="font-mono text-[11px] text-rust">{rupees(balanceOf(r))} due</span> : null}</span>
        </div>
        <p className="font-semibold">{r.customers?.full_name}</p>
        <p className="font-mono text-xs text-emerald">{r.customers?.phone}</p>
        <div className="my-3 rounded-lg bg-muted/70 p-3">{itemCell(r)}
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{(r.rental_lines ?? []).reduce((s, l) => s + l.qty, 0)} qty{activeBranches.length > 1 ? ` · ${branchName(r.branch_id)}` : ""}</p>
        </div>
        <div className="flex items-end justify-between border-t border-border/50 pt-3">
          <div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Due date</p><div className="text-sm">{dueCell(r, finished)}</div></div>
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            {!finished ? <>
              <Link href={`/rentals/${r.id}`} className={ghostButtonClass}>Edit</Link>
              <Link href={`/rentals/${r.id}?receive=1`} className={cn(goldButtonClass, "px-3")}>Return</Link>
            </> : null}
            {wa(r, finished, "p-2")}
          </div>
        </div>
      </div>
    );
  };

  const cols = (
    <thead className="bg-muted/70 text-[11px] uppercase tracking-wider text-muted-foreground">
      <tr>
        {head("Token", "token")}{head("Customer", "name")}{head("Item")}
        {activeBranches.length > 1 ? head("Branch") : null}
        {head("Qty")}{head("Due date", "end_at")}{canManage ? head("Balance", "balance") : null}{head("Status")}{head("Actions")}
      </tr>
    </thead>
  );
  const tableFor = (rows: Row[], finished: boolean) => (
    <>
      <div className="glass hidden overflow-x-auto xl:block">
        <table className="w-full min-w-[960px] text-left text-sm">{cols}<tbody className="divide-y divide-border">{rows.map((r) => tableRow(r, finished))}</tbody></table>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:hidden">{rows.map((r) => card(r, finished))}</div>
    </>
  );
  const empty = (text: string) => (
    <div className="glass rounded-xl px-4 py-10 text-center text-sm text-muted-foreground">
      {isFiltered ? <><p>No records match your search or filters.</p><button className={cn(ghostButtonClass, "mt-3")} onClick={clearAll}>Clear filters</button></> : (
        <><p>{text}</p><Link href="/scan" className={cn(ghostButtonClass, "mt-3")}><Plus className="h-3.5 w-3.5" /> New rental</Link></>
      )}
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">Dashboard</h1>
        <Link href="/scan" className={goldButtonClass}><Plus className="h-4 w-4" /> New rental</Link>
      </div>

      <label className="relative mt-5 block">
        <span className="sr-only">Search rentals</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input type="search" className={cn(inputClass, "h-11 pl-9 pr-9")} placeholder="Search token, customer, phone or SKU…"
          value={query} onChange={(e) => setQuery(e.target.value)} />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        ) : null}
      </label>

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
            {queue === "pickups" ? "No pickups scheduled for today." : queue === "returns" ? "No returns due today." : "Nothing overdue. All clear."}
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

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Active Rentals</h2>
          <span className="rounded-md bg-black/5 px-2 py-1 font-mono text-xs text-muted-foreground">{table.length} active</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* below xl the list is cards, so sorting needs its own control; on xl the table headers sort */}
          <div className="flex items-center gap-2 xl:hidden">
            <select aria-label="Sort by" className={cn(inputClass, "w-40 py-1.5")} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="end_at">Sort by due date</option><option value="start_at">Sort by date</option><option value="name">Sort by name</option>
              <option value="token">Sort by token</option>{canManage ? <option value="balance">Sort by balance</option> : null}
            </select>
            <button type="button" className={cn(ghostButtonClass, "px-2")} onClick={() => setAsc((x) => !x)} aria-label={asc ? "Sorted ascending, switch to descending" : "Sorted descending, switch to ascending"}>
              <ArrowUpDown className="h-4 w-4" />
            </button>
          </div>
          <button type="button" className={ghostButtonClass} disabled={refreshing} title="Sync latest data"
            onClick={async () => { setRefreshing(true); await Promise.all([load(), loadDone(0)]); setRefreshing(false); }}>
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin text-gold")} /> <span className="hidden sm:inline">{refreshing ? "Syncing…" : "Refresh"}</span>
          </button>
          <button type="button" className={cn(ghostButtonClass, showFilters && "border-gold/40")} aria-expanded={showFilters} onClick={() => setShowFilters((x) => !x)}>
            <Filter className="h-4 w-4" /> Filter{chips.length ? ` (${chips.length})` : ""}
          </button>
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
            <select className={cn(inputClass, "sm:w-40")} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Filters["status"] })}>
              <option value="all">All status</option><option value="out">Out</option><option value="returned">Returned</option>
            </select></label>
          {canManage ? (
            <label className="text-xs text-muted-foreground"><span className="mb-1 block">Payment</span>
              <select className={cn(inputClass, "sm:w-36")} value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value as Pay })}>
                {(Object.keys(PAYMENT_LABELS) as Pay[]).map((p) => <option key={p} value={p}>{PAYMENT_LABELS[p]}</option>)}
              </select></label>
          ) : null}
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
        {out === null ? <div className="glass rounded-xl px-4 py-10 text-center text-sm text-muted-foreground">Loading...</div>
          : table.length === 0 ? empty("No rentals are out right now.") : tableFor(table, false)}
      </div>

      <div className="mt-8 border-t border-border/50 pt-6">
        <button type="button" onClick={() => setShowDone((x) => !x)} aria-expanded={showDone} className="group flex w-full items-center justify-between py-2">
          <span className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-muted-foreground transition-colors group-hover:text-foreground">Completed Rentals</h3>
            <span className="rounded-md bg-black/5 px-2 py-1 font-mono text-xs text-muted-foreground">{doneCount} completed</span>
          </span>
          <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">{showDone ? "Hide" : "Show"}</span>
        </button>
        {showDone ? (
          <div className="mt-4">
            {done === null ? <div className="glass rounded-xl px-4 py-8 text-center text-sm text-muted-foreground">Loading...</div>
              : doneRows.length === 0 ? <div className="glass rounded-xl px-4 py-8 text-center text-sm text-muted-foreground">No completed rentals found.</div>
              : <>
                {tableFor(doneRows, true)}
                {done.length < doneCount ? (
                  <div className="mt-4 text-center">
                    <button className={ghostButtonClass} onClick={() => void loadDone(done.length)}>Show more ({doneCount - done.length} left)</button>
                  </div>
                ) : null}
              </>}
          </div>
        ) : null}
      </div>
    </>
  );
}
