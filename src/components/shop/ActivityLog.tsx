"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { addDays, dayRange, fmtDate, fmtDateTime, fmtTime, todayLocal } from "@/lib/shop/format";
import { DateInput } from "@/components/shop/DateInput";
import {
  Empty, PageHeader, Panel, StatusBadge, ghostButtonClass, inputClass, tableWrap, theadClass,
} from "@/components/shop/ui";

// Admin > Activity log: who did what in the shop, and when, in plain words. Only the owner sees it.
// The entries are written by the database (migration 20261101000034_activity_log.sql); this page only reads them.

interface Entry {
  id: number;
  branch_id: string | null;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  area: Area;
  action: string;
  level: number;
  important: boolean;
  summary: string;
  record_type: string | null;
  record_id: string | null;
  record_label: string | null;
  reason: string | null;
  changes: Record<string, { from?: string; to?: string; count?: number }> | null;
  snapshot: Record<string, unknown> | null;
}
type Area = "bookings" | "carts" | "money" | "customers" | "products" | "appointments" | "staff" | "branches" | "settings" | "account";
type Tone = "accent" | "gold" | "emerald" | "rust" | "muted" | "indigo";
type Period = "today" | "7" | "30" | "90" | "custom";

const AREAS: Record<Area, { label: string; tone: Tone }> = {
  bookings: { label: "Bookings", tone: "accent" },
  carts: { label: "Carts", tone: "accent" },
  money: { label: "Money", tone: "emerald" },
  customers: { label: "Customers", tone: "indigo" },
  products: { label: "Products", tone: "gold" },
  appointments: { label: "Appointments", tone: "indigo" },
  staff: { label: "Staff", tone: "rust" },
  branches: { label: "Branches", tone: "muted" },
  settings: { label: "Settings", tone: "muted" },
  account: { label: "Sign-in", tone: "muted" },
};
const ROLE_LABELS: Record<string, string> = {
  owner: "Owner", manager: "Manager", staff: "Staff", support: "Zypher support", super_admin: "Zypher",
};
const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 3 months" },
  { value: "custom", label: "Choose dates" },
];
const PAGE = 50;
// entries whose label is a booking number
const BOOKING_TYPES = new Set(["booking", "payment", "charge", "reminder"]);
const COLUMNS = "id, branch_id, occurred_at, actor_id, actor_name, actor_role, area, action, level, important, summary, record_type, record_id, record_label, reason, changes, snapshot";

interface Filters {
  period: Period;
  from: string;
  to: string;
  person: string;
  area: string;
  branch: string;
  important: boolean;
  search: string;
}

export default function ActivityLog() {
  const { role, isSupport, tz, branches } = useShop();
  const today = todayLocal(tz);
  const [filters, setFilters] = useState<Filters>({
    period: "7", from: addDays(today, -6), to: today, person: "", area: "", branch: "", important: false, search: "",
  });
  const [searchText, setSearchText] = useState("");
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [people, setPeople] = useState<{ actor_id: string; actor_name: string; actor_role: string }[]>([]);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const isRealOwner = role === "owner" && !isSupport;
  const branchName = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);

  // typing in the search box waits a moment before asking the database
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === searchText.trim() ? f : { ...f, search: searchText.trim() })), 350);
    return () => clearTimeout(t);
  }, [searchText]);

  const fetchPage = useCallback(async (from: number, size: number) => {
    let q = createClient().from("activity_log").select(COLUMNS)
      .order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(from, from + size - 1);
    const range = periodRange(filters, tz);
    if (range.from) q = q.gte("occurred_at", range.from);
    if (range.to) q = q.lt("occurred_at", range.to);
    if (filters.person) q = q.eq("actor_id", filters.person);
    if (filters.area) q = q.eq("area", filters.area);
    if (filters.branch) q = q.eq("branch_id", filters.branch);
    if (filters.important) q = q.eq("important", true);
    const words = filters.search.replace(/[,()*"\\%]/g, " ").trim();
    if (words) q = q.or(`summary.ilike."*${words}*",record_label.ilike."*${words}*",actor_name.ilike."*${words}*"`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as Entry[]) ?? [];
  }, [filters, tz]);

  useEffect(() => {
    if (!isRealOwner) return;
    let live = true;
    setRows(null);
    setOpen(new Set());
    fetchPage(0, PAGE)
      .then((page) => { if (live) { setRows(page); setMore(page.length === PAGE); } })
      .catch((e: Error) => { if (live) { setRows([]); toast.error("Could not load the activity log: " + e.message); } });
    return () => { live = false; };
  }, [fetchPage, isRealOwner]);

  // booking numbers in the entries -> the booking, for the "View" links (only bookings that still exist)
  const [bookingIds, setBookingIds] = useState<Record<string, string>>({});
  useEffect(() => {
    const tokens = [...new Set((rows ?? []).filter((r) => BOOKING_TYPES.has(r.record_type ?? "") && r.record_label)
      .map((r) => r.record_label as string))].filter((t) => !(t in bookingIds));
    if (tokens.length === 0) return;
    void createClient().from("rentals").select("id, token").in("token", tokens).then(({ data }) => {
      const found: Record<string, string> = Object.fromEntries(tokens.map((t) => [t, ""]));
      for (const b of (data as { id: string; token: string }[]) ?? []) found[b.token] = b.id;
      setBookingIds((m) => ({ ...m, ...found }));
    });
  }, [rows, bookingIds]);

  const viewLink = (r: Entry): { href: string; label: string } | null => {
    if (r.level === 3) return null;   // the record is gone
    if (BOOKING_TYPES.has(r.record_type ?? "") && r.record_label && bookingIds[r.record_label]) {
      return { href: `/rentals/${bookingIds[r.record_label]}`, label: "View booking" };
    }
    if (r.record_type === "customer" && r.record_id) return { href: `/customers/${r.record_id}`, label: "View customer" };
    if (r.record_type === "product" && r.record_id) return { href: `/catalog/${r.record_id}`, label: "View product" };
    return null;
  };

  useEffect(() => {
    if (!isRealOwner) return;
    void createClient().rpc("activity_people").then(({ data }) =>
      setPeople(((data as typeof people) ?? []).sort((a, b) => a.actor_name.localeCompare(b.actor_name))));
  }, [isRealOwner]);

  if (!isRealOwner) {
    return <Panel><p className="text-sm text-muted-foreground">Only the shop owner can see the activity log.</p></Panel>;
  }

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await fetchPage(rows?.length ?? 0, PAGE);
      setRows([...(rows ?? []), ...page]);
      setMore(page.length === PAGE);
    } catch (e) {
      toast.error("Could not load more: " + (e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  // every entry that matches the filters, as a spreadsheet file (a backup the owner can keep)
  const downloadCsv = async () => {
    setExporting(true);
    try {
      const all: Entry[] = [];
      for (let from = 0; from < 20000; from += 1000) {
        const page = await fetchPage(from, 1000);
        all.push(...page);
        if (page.length < 1000) break;
      }
      if (all.length === 0) return void toast.info("Nothing to download for these filters.");
      const header = ["Date", "Time", "Person", "Role", "Area", "What happened", "Important", "Reason", "Changes", "Branch"];
      const lines = all.map((r) => [
        fmtDate(r.occurred_at, tz), fmtTime(r.occurred_at, tz), r.actor_name, ROLE_LABELS[r.actor_role] ?? r.actor_role,
        AREAS[r.area]?.label ?? r.area, r.summary, r.important ? "Yes" : "", r.reason ?? "",
        changeLines(r.changes).join("; "), r.branch_id ? branchName[r.branch_id] ?? "" : "",
      ]);
      const csv = "\uFEFF" + [header, ...lines].map((l) => l.map(csvCell).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `activity-log-${today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Could not download: " + (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const showBranch = branches.length > 1;
  const cols = showBranch ? 6 : 5;
  const groups = groupByDay(rows ?? [], tz, today);
  const filtered = filters.person || filters.area || filters.branch || filters.important || filters.search;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Activity log"
        subtitle="Who did what in your shop, and when. Newest first."
        actions={
          <button type="button" className={ghostButtonClass} onClick={downloadCsv} disabled={exporting}>
            <Download className="h-4 w-4" aria-hidden="true" /> {exporting ? "Preparing..." : "Download CSV"}
          </button>
        }
      />

      <div className="glass grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative sm:col-span-2 lg:col-span-4">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input type="search" className={cn(inputClass, "pl-9")} placeholder="Search by booking number, customer, product or person"
            value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </label>
        <select aria-label="When" className={inputClass} value={filters.period}
          onChange={(e) => set({ period: e.target.value as Period })}>
          {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select aria-label="Person" className={inputClass} value={filters.person} onChange={(e) => set({ person: e.target.value })}>
          <option value="">Everyone</option>
          {people.map((p) => <option key={p.actor_id} value={p.actor_id}>{p.actor_name} ({ROLE_LABELS[p.actor_role] ?? p.actor_role})</option>)}
        </select>
        <select aria-label="Area" className={inputClass} value={filters.area} onChange={(e) => set({ area: e.target.value })}>
          <option value="">All areas</option>
          {(Object.keys(AREAS) as Area[]).map((a) => <option key={a} value={a}>{AREAS[a].label}</option>)}
        </select>
        {showBranch ? (
          <select aria-label="Branch" className={inputClass} value={filters.branch} onChange={(e) => set({ branch: e.target.value })}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : <span className="hidden lg:block" />}
        {filters.period === "custom" ? (
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <DateInput aria-label="From" value={filters.from} max={filters.to || today} onChange={(v) => set({ from: v })} className="w-36" />
            <span className="text-sm text-muted-foreground">to</span>
            <DateInput aria-label="To" value={filters.to} min={filters.from} max={today} onChange={(v) => set({ to: v })} className="w-36" />
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-[var(--gold)]" checked={filters.important}
            onChange={(e) => set({ important: e.target.checked })} />
          Only important: deletions, cancellations, money corrections, staff and access changes
        </label>
        {/* one tap for the owner's most common check: voids, corrections and removed charges */}
        <button type="button" aria-pressed={filters.area === "money" && filters.important}
          className={cn("w-fit rounded-full border px-3 py-1 text-xs", filters.area === "money" && filters.important ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}
          onClick={() => set(filters.area === "money" && filters.important ? { area: "", important: false } : { area: "money", important: true })}>
          Money changes
        </button>
      </div>

      <div className={tableWrap}>
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className={theadClass}>
            <tr>
              <th className="w-20 px-4 py-3">Time</th>
              <th className="w-36 px-4 py-3">Who</th>
              <th className="w-28 px-4 py-3">Area</th>
              {showBranch ? <th className="hidden w-32 px-4 py-3 xl:table-cell">Branch</th> : null}
              <th className="min-w-[16rem] px-4 py-3">What happened</th>
              <th className="w-20 px-4 py-3"><span className="sr-only">Details</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows === null ? (
              <tr><td colSpan={cols} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols}><Empty>{filtered ? "Nothing matches these filters." : "Nothing has happened in this period yet."}</Empty></td></tr>
            ) : groups.map((g) => (
              <Fragment key={g.day}>
                <tr className="bg-muted/40">
                  <td colSpan={cols} className="px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground">{g.label}</td>
                </tr>
                {g.rows.map((r) => {
                  const lines = changeLines(r.changes);
                  const hasDetails = lines.length > 0 || !!r.snapshot;
                  const isOpen = open.has(r.id);
                  const link = viewLink(r);
                  return (
                    <Fragment key={r.id}>
                      <tr className="align-top">
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground" title={fmtDateTime(r.occurred_at, tz)}>
                          {fmtTime(r.occurred_at, tz)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{r.actor_name}</div>
                          <div className="text-xs text-muted-foreground">{ROLE_LABELS[r.actor_role] ?? r.actor_role}</div>
                          {showBranch && r.branch_id && branchName[r.branch_id] ? (
                            <div className="text-xs text-muted-foreground xl:hidden">{branchName[r.branch_id]}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={AREAS[r.area]?.tone ?? "muted"}>{AREAS[r.area]?.label ?? r.area}</StatusBadge>
                        </td>
                        {showBranch ? (
                          <td className="hidden px-4 py-3 text-muted-foreground xl:table-cell">{r.branch_id ? branchName[r.branch_id] ?? "—" : "—"}</td>
                        ) : null}
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-foreground">{r.summary}</span>
                            {r.important ? <StatusBadge tone="rust">Important</StatusBadge> : null}
                          </div>
                          {r.reason ? <div className="mt-1 text-xs text-muted-foreground">Reason: {r.reason}</div> : null}
                          {link ? <Link href={link.href} className="mt-1 inline-block text-xs font-medium text-gold hover:underline">{link.label}</Link> : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {hasDetails ? (
                            <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline"
                              aria-expanded={isOpen} onClick={() => toggle(r.id)}>
                              {isOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                              {isOpen ? "Hide" : "Details"}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr>
                          <td colSpan={cols} className="bg-muted/30 px-4 py-3">
                            <Details lines={lines} snapshot={r.snapshot} tz={tz} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {more ? (
        <button type="button" className={ghostButtonClass} onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading..." : "Show older entries"}
        </button>
      ) : null}
    </div>
  );
}

function Details({ lines, snapshot, tz }: { lines: string[]; snapshot: Record<string, unknown> | null; tz: string }) {
  const kept = snapshot ? snapshotLines(snapshot, tz) : [];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {lines.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">What changed</p>
          <ul className="space-y-1 text-sm">
            {lines.map((l) => <li key={l} className="text-foreground">{l}</li>)}
          </ul>
        </div>
      ) : null}
      {kept.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">The deleted record, as it was</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {kept.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-words text-foreground">{v}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

// "Discount: ₹0 → ₹200", "Pieces added: 3", "Note: Advance"
function changeLines(changes: Entry["changes"]): string[] {
  if (!changes) return [];
  return Object.entries(changes)
    .map(([label, c]) => {
      if (typeof c.count === "number") return `${label}: ${c.count}`;
      if (!c.from || c.from === "—") return `${label}: ${c.to ?? "—"}`;
      return `${label}: ${c.from} → ${c.to ?? "—"}`;
    })
    .sort((a, b) => a.localeCompare(b));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HIDDEN = new Set(["id", "shop_id", "created_by", "recorded_by", "updated_at", "token_seq"]);

// the deleted record in words: no internal ids, readable names and dates
function snapshotLines(s: Record<string, unknown>, tz: string): [string, string][] {
  return Object.entries(s)
    .filter(([k, v]) => !HIDDEN.has(k) && !k.endsWith("_id") && v !== null && v !== "" && !(typeof v === "string" && UUID.test(v)))
    .map(([k, v]): [string, string] => {
      const label = k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " ");
      if (typeof v === "boolean") return [label, v ? "Yes" : "No"];
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return [label, fmtDateTime(v, tz)];
      if (typeof v === "object") return [label, JSON.stringify(v)];
      return [label, String(v)];
    });
}

function periodRange(f: Filters, tz: string): { from?: string; to?: string } {
  const today = todayLocal(tz);
  if (f.period === "custom") {
    return { from: f.from ? dayRange(f.from, tz).from : undefined, to: f.to ? dayRange(f.to, tz).to : undefined };
  }
  const days = f.period === "today" ? 1 : Number(f.period);
  return { from: dayRange(addDays(today, -(days - 1)), tz).from };
}

function groupByDay(rows: Entry[], tz: string, today: string) {
  const out: { day: string; label: string; rows: Entry[] }[] = [];
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
  for (const r of rows) {
    const day = dayOf(r.occurred_at);
    let g = out[out.length - 1];
    if (!g || g.day !== day) {
      const label = day === today ? "Today" : day === addDays(today, -1) ? "Yesterday"
        : new Date(day + "T12:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
      g = { day, label, rows: [] };
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
}

function csvCell(v: string) {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
