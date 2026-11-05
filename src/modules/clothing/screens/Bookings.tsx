"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DateInput, isoToDisplay } from "@/components/shop/DateInput";
import Link from "next/link";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_LIST_COLUMNS } from "@/lib/shop/api";
import {
  addDays,
  dayRange,
  errorText,
  fmtDate,
  isoToZoned,
  plural,
  rupees,
  todayLocal,
} from "@/lib/shop/format";
import type { ListRental } from "@/components/shop/RentalList";
import {
  PageHeader,
  RentalStatusBadge,
  StatusBadge,
  ghostButtonClass,
  goldButtonClass,
  inputClass,
  ListSkeleton,
} from "@/components/shop/ui";

type Status = "reserved" | "active" | "completed" | "cancelled" | "all";
type Day = "all" | "today" | "tomorrow" | "custom";
const PAGE = 60;
type Row = ListRental & { pieces: string[] };

const SECTIONS = [
  {
    id: "schedule",
    title: "Pickups & Returns",
    statuses: ["reserved", "active"],
    empty: "No pickups or due returns match the current filters.",
  },
  {
    id: "live",
    title: "Live Bookings",
    statuses: ["active"],
    empty:
      "No bookings out with a later return date match the current filters.",
  },
  {
    id: "completed",
    title: "Completed Bookings",
    statuses: ["completed"],
    empty: "No completed bookings match the current filters.",
  },
  {
    id: "cancelled",
    title: "Cancelled Bookings",
    statuses: ["cancelled"],
    empty: "No cancellations or no-shows match the current filters.",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];
type HistorySection = "completed" | "cancelled";
type PageRequest = { id: SectionId; from: number };
type SectionPage = {
  rows: Row[];
  count: number;
  loading?: boolean;
  error?: string;
};
type PageResult = { id: SectionId } & (
  { rows: Row[]; count: number } | { error: string }
);
type Filters = {
  status: Status;
  pickupDay: string;
  branch: string;
  term: string;
  today: string;
  tz: string;
};

async function fetchBookingPages(
  requests: PageRequest[],
  filters: Filters,
  signal: AbortSignal,
): Promise<PageResult[]> {
  const { status, pickupDay, branch, term, today, tz } = filters;
  const supabase = createClient();
  const pickupRange = pickupDay ? dayRange(pickupDay, tz) : null;
  const returnCutoff = dayRange(today, tz).to;
  const like = term.replace(/[%_,()*]/g, "");
  const search = like ? `%${like}%` : "";
  const matches = search ? [`token.ilike.${search}`] : [];
  if (search) {
    const [customers, lines] = await Promise.all([
      supabase
        .from("customers")
        .select("id")
        .or(`full_name.ilike.${search},phone.ilike.${search}`)
        .limit(200)
        .abortSignal(signal),
      supabase
        .from("rental_lines")
        .select("rental_id")
        .or(`sku.ilike.${search},description.ilike.${search}`)
        .limit(300)
        .abortSignal(signal),
    ]);
    const error = customers.error ?? lines.error;
    if (error)
      return requests.map(({ id }) => ({ id, error: errorText(error) }));
    const customerIds = (customers.data ?? []).map(({ id }) => id);
    const rentalIds = [
      ...new Set((lines.data ?? []).map(({ rental_id }) => rental_id)),
    ].slice(0, 100);
    if (customerIds.length)
      matches.push(`customer_id.in.(${customerIds.join(",")})`);
    if (rentalIds.length) matches.push(`id.in.(${rentalIds.join(",")})`);
  }

  return Promise.all(
    requests.map(async ({ id, from }): Promise<PageResult> => {
      let query = supabase
        .from("rentals")
        .select(RENTAL_LIST_COLUMNS, { count: "exact" });
      switch (id) {
        case "schedule":
          if (status === "reserved") query = query.eq("status", "reserved");
          else if (status === "active")
            query = query.eq("status", "active").lt("end_at", returnCutoff);
          else
            query = query.or(
              `status.eq.reserved,and(status.eq.active,end_at.lt.${returnCutoff})`,
            );
          query = query.order(status === "active" ? "end_at" : "start_at");
          break;
        case "live":
          query = query
            .eq("status", "active")
            .gte("end_at", returnCutoff)
            .order("end_at");
          break;
        case "completed":
          query = query
            .eq("status", "completed")
            .order("start_at", { ascending: false });
          break;
        case "cancelled":
          query = query
            .in("status", ["cancelled", "no_show"])
            .order("start_at", { ascending: false });
          break;
      }
      if (pickupRange)
        query = query
          .gte("start_at", pickupRange.from)
          .lt("start_at", pickupRange.to);
      if (branch) query = query.eq("branch_id", branch);
      if (matches.length) query = query.or(matches.join(","));

      const { data, count, error } = await query
        .order("id")
        .range(from, from + PAGE - 1)
        .abortSignal(signal);
      if (error) return { id, error: errorText(error) };
      const rows = (data ?? []) as unknown as ListRental[];
      const piecesByRental = new Map<string, string[]>();
      if (rows.length) {
        const { data: reservations, error: piecesError } = await supabase
          .from("unit_reservations")
          .select("rental_id, units!unit_reservations_shop_unit_fkey(code)")
          .in(
            "rental_id",
            rows.map((row) => row.id),
          )
          .neq("state", "released")
          .abortSignal(signal);
        if (piecesError) return { id, error: errorText(piecesError) };
        for (const { rental_id, units } of (reservations ?? []) as unknown as {
          rental_id: string;
          units: { code: string } | null;
        }[]) {
          if (units)
            piecesByRental.set(rental_id, [
              ...(piecesByRental.get(rental_id) ?? []),
              units.code,
            ]);
        }
      }
      return {
        id,
        count: count ?? rows.length,
        rows: rows.map((row) => ({
          ...row,
          pieces: (piecesByRental.get(row.id) ?? []).sort(),
        })),
      };
    }),
  );
}

function BookingResults({
  filters,
  expanded,
  onToggle,
  renderCard,
}: {
  filters: Filters;
  expanded: Record<HistorySection, boolean>;
  onToggle: (id: HistorySection) => void;
  renderCard: (row: Row) => ReactNode;
}): React.JSX.Element {
  const [pages, setPages] = useState<Partial<Record<SectionId, SectionPage>>>(
    {},
  );
  const requestController = useRef<AbortController | null>(null);
  const { status, pickupDay, branch, term, today, tz } = filters;

  useEffect(() => {
    const controller = new AbortController();
    requestController.current = controller;
    const requests = SECTIONS.filter(
      (section) =>
        status === "all" || section.statuses.some((value) => value === status),
    ).map(({ id }) => ({ id, from: 0 }));
    const load = async (): Promise<void> => {
      let results: PageResult[];
      try {
        results = await fetchBookingPages(
          requests,
          { status, pickupDay, branch, term, today, tz },
          controller.signal,
        );
      } catch (error) {
        results = requests.map(({ id }) => ({ id, error: errorText(error) }));
      }
      if (controller.signal.aborted) return;
      setPages(
        Object.fromEntries(
          results.map(({ id, ...result }) => [
            id,
            "error" in result
              ? { rows: [], count: 0, error: result.error }
              : result,
          ]),
        ),
      );
    };
    void load();
    return () => controller.abort();
  }, [status, pickupDay, branch, term, today, tz]);

  async function loadMore(id: SectionId, page: SectionPage): Promise<void> {
    const signal = requestController.current?.signal;
    if (!signal || page.loading) return;
    setPages((current) => ({
      ...current,
      [id]: { ...page, loading: true, error: undefined },
    }));
    let result: PageResult;
    try {
      [result] = await fetchBookingPages(
        [{ id, from: page.rows.length }],
        filters,
        signal,
      );
    } catch (error) {
      result = { id, error: errorText(error) };
    }
    if (signal.aborted) return;
    const next =
      "error" in result
        ? { ...page, loading: false, error: result.error }
        : { rows: [...page.rows, ...result.rows], count: result.count };
    setPages((current) => ({ ...current, [id]: next }));
  }

  return (
    <div className="space-y-6">
      {SECTIONS.filter(
        (section) =>
          status === "all" ||
          section.statuses.some((value) => value === status),
      ).map(({ id, title, empty }) => {
        const history = id === "completed" || id === "cancelled";
        const collapsible = history && status === "all";
        const open = !collapsible || expanded[id];
        const page = pages[id];
        const headingId = `bookings-${id}-heading`;
        const contentId = `bookings-${id}-content`;
        return (
          <section
            key={id}
            aria-labelledby={headingId}
            className="border-t border-border pt-3"
          >
            <div className="flex min-h-10 flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 id={headingId} className="text-base font-semibold sm:text-lg">
                {title}
              </h2>
              {page && (!page.error || page.rows.length > 0) ? (
                <StatusBadge>{page.count}</StatusBadge>
              ) : null}
              {collapsible ? (
                <button
                  type="button"
                  className={cn(
                    ghostButtonClass,
                    "ml-auto min-h-11 px-3 py-1.5",
                  )}
                  aria-controls={contentId}
                  aria-expanded={open}
                  onClick={() => onToggle(id)}
                >
                  {open ? "Hide" : "Show"}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn("size-4", open && "rotate-180")}
                  />
                </button>
              ) : null}
            </div>
            <div id={contentId} hidden={!open}>
              <div className="mt-2 grid gap-3">
                {!page ? <ListSkeleton rows={2} /> : null}
                {page?.rows.map(renderCard)}
                {page &&
                !page.error &&
                page.rows.length === 0 &&
                !page.loading ? (
                  <p className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
                    {empty}
                  </p>
                ) : null}
                {page?.error ? (
                  <p role="alert" className="text-sm text-foreground">
                    Could not load bookings. {page.error}
                  </p>
                ) : null}
                {page &&
                (page.error ||
                  page.rows.length < page.count ||
                  page.loading) ? (
                  <button
                    type="button"
                    className={cn(ghostButtonClass, "mx-auto")}
                    disabled={page.loading}
                    onClick={() => void loadMore(id, page)}
                  >
                    {page.loading
                      ? "Loading…"
                      : page.error
                        ? "Retry"
                        : `Show more (${page.count - page.rows.length} left)`}
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function Bookings(): React.JSX.Element {
  const { tz, activeBranches, branches, myBranchId, canManage } = useShop();
  const [status, setStatus] = useState<Status>("all");
  const [day, setDay] = useState<Day>("all");
  const [customDay, setCustomDay] = useState("");
  const [branch, setBranch] = useState(myBranchId ?? "");
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [expanded, setExpanded] = useState({
    completed: false,
    cancelled: false,
  });
  const today = todayLocal(tz);
  const tomorrow = addDays(today, 1);

  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const branchName = (id: string) =>
    branches.find((b) => b.id === id)?.name ?? "";
  const pickupDay =
    day === "today"
      ? today
      : day === "tomorrow"
        ? tomorrow
        : day === "custom"
          ? customDay
          : "";
  const filters = {
    status,
    pickupDay,
    branch: myBranchId ?? branch,
    term,
    today,
    tz,
  };

  // A booking is one short row: who, when, what and what is still owed. The booking page has the rest.
  const dmy = (iso: string) => isoToDisplay(isoToZoned(iso, tz).slice(0, 10));
  const card = (r: Row) => {
    const pickupToday =
      r.status === "reserved" && fmtDate(r.start_at, tz) === fmtDate(today);
    const returnToday =
      r.status === "active" && isoToZoned(r.end_at, tz).slice(0, 10) === today;
    const nDays = Math.max(
      1,
      Math.round(
        (Date.parse(isoToZoned(r.end_at, tz).slice(0, 10)) -
          Date.parse(isoToZoned(r.start_at, tz).slice(0, 10))) /
          86_400_000,
      ),
    );
    const due = Math.max(0, Number(r.total) - Number(r.paid));
    const cancelled = r.status === "cancelled" || r.status === "no_show";
    const items = (r.rental_lines ?? [])
      .map((l) => (l.qty > 1 ? `${l.qty} × ` : "") + l.description)
      .join(", ");
    return (
      <div
        key={r.id}
        className={cn(
          "overflow-hidden rounded-2xl border bg-surface shadow-[0_1px_2px_rgb(16_23_21/4%),0_8px_24px_-14px_rgb(16_23_21/12%)]",
          pickupToday ? "border-gold/50" : "border-transparent",
        )}
      >
        <Link
          href={`/rentals/${r.id}`}
          className="grid gap-x-4 gap-y-1.5 px-4 py-3.5 transition-colors hover:bg-accent/40 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto] sm:items-center"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-gold">
                {r.token}
              </span>
              <RentalStatusBadge rental={r} />
              {pickupToday ? (
                <StatusBadge tone="accent">Pickup today</StatusBadge>
              ) : null}
              {returnToday ? (
                <StatusBadge tone="accent">Return today</StatusBadge>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-sm font-semibold">
              {r.customers?.full_name}{" "}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {r.customers?.phone}
              </span>
            </p>
          </div>
          <div className="min-w-0 text-xs">
            <p className="font-mono text-sm text-foreground">
              {dmy(r.start_at)} <span className="text-muted-foreground">→</span>{" "}
              {dmy(r.end_at)}{" "}
              <span className="text-xs text-muted-foreground">
                · {plural(nDays, "day")}
              </span>
            </p>
            <p className="truncate text-muted-foreground">
              {items || "No items"}
              {r.pieces?.length ? (
                <span className="font-mono text-emerald">
                  {" "}
                  · {r.pieces.join(", ")}
                </span>
              ) : null}
              {activeBranches.length > 1 ? (
                <span> · {branchName(r.branch_id)}</span>
              ) : null}
            </p>
          </div>
          {canManage ? (
            <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right">
              <p
                className={cn(
                  "font-mono text-sm font-semibold",
                  cancelled
                    ? "text-muted-foreground"
                    : due > 0
                      ? "text-amber"
                      : "text-emerald",
                )}
              >
                {cancelled
                  ? "Cancelled"
                  : due > 0
                    ? `Due ${rupees(due)}`
                    : "Paid"}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                Total {rupees(r.total)}
              </p>
            </div>
          ) : null}
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-accent/30 px-4 py-2.5">
          {r.status === "reserved" ? (
            <Link
              href={`/rentals/${r.id}?handover=1`}
              className={cn(goldButtonClass, "px-4 py-1.5 text-xs")}
            >
              Hand over
            </Link>
          ) : null}
          {r.status === "active" ? (
            <Link
              href={`/rentals/${r.id}?receive=1`}
              className={cn(goldButtonClass, "px-4 py-1.5 text-xs")}
            >
              Return
            </Link>
          ) : null}
          <Link href={`/rentals/${r.id}`} className={ghostButtonClass}>
            Open booking
          </Link>
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Bookings Management"
        subtitle="Manage pickups, returns and booking history."
        actions={
          <Link href="/scan" className={goldButtonClass}>
            New rental
          </Link>
        }
      />

      <div className="glass mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={cn(inputClass, "pl-9")}
            placeholder="Search customer, phone, token, SKU..."
            aria-label="Search bookings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className={inputClass}
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
        >
          <option value="all">All statuses</option>
          <option value="reserved">Booked (awaiting pickup)</option>
          <option value="active">Out (picked up)</option>
          <option value="completed">Returned</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          className={inputClass}
          aria-label="Pickup date"
          value={day}
          onChange={(e) => setDay(e.target.value as Day)}
        >
          <option value="all">All pickup dates</option>
          <option value="today">Pickups today ({fmtDate(today)})</option>
          <option value="tomorrow">
            Pickups tomorrow ({fmtDate(tomorrow)})
          </option>
          <option value="custom">Custom date</option>
        </select>
        {!myBranchId && activeBranches.length > 1 ? (
          <select
            className={inputClass}
            aria-label="Branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">All branches</option>
            {activeBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="hidden lg:block" />
        )}
        {day === "custom" ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
            Pickup on{" "}
            <DateInput
              className="w-44"
              value={customDay}
              onChange={(v) => setCustomDay(v)}
            />
          </label>
        ) : null}
      </div>

      <BookingResults
        key={JSON.stringify(filters)}
        filters={filters}
        expanded={expanded}
        onToggle={(id) =>
          setExpanded((current) => ({ ...current, [id]: !current[id] }))
        }
        renderCard={card}
      />
    </>
  );
}
