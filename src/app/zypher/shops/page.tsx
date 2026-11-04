"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  goldButtonClass,
  inputClass,
} from "@/components/overbooked/primitives";
import {
  BillingBadge,
  PageHeader,
  billingState,
  fmtDay,
  rupees,
  tableWrap,
  theadClass,
  todayIST,
  type BillingState,
  type OverviewRow,
  type Template,
} from "@/components/zypher/kit";

const FILTERS: { key: "all" | BillingState; label: string }[] = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "due_soon", label: "Due soon" },
  { key: "paid", label: "Paid" },
  { key: "trial", label: "Trial" },
  { key: "paused", label: "Paused" },
];

export default function ZypherShops() {
  const [shops, setShops] = useState<OverviewRow[] | null>(null);
  const [typeNames, setTypeNames] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.rpc("platform_overview"),
      supabase.from("business_templates").select("key, name"),
    ]).then(([o, t]) => {
      if (o.error) toast.error("Could not load shops: " + o.error.message);
      setShops((o.data as OverviewRow[]) ?? []);
      setTypeNames(
        Object.fromEntries(
          ((t.data as Pick<Template, "key" | "name">[]) ?? []).map((x) => [
            x.key,
            x.name,
          ]),
        ),
      );
    });
  }, []);

  const today = todayIST();
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (shops ?? []).filter(
      (s) =>
        (filter === "all" || billingState(s, today) === filter) &&
        (!q ||
          s.name.toLowerCase().includes(q) ||
          s.slug.includes(q) ||
          s.token_prefix.toLowerCase().includes(q)),
    );
  }, [shops, query, filter, today]);

  return (
    <>
      <PageHeader
        title="Shops"
        subtitle={shops ? `${shops.length} shops` : "Loading..."}
        actions={
          <Link href="/zypher/shops/new" className={goldButtonClass}>
            <Plus className="h-4 w-4" /> New shop
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={cn(inputClass, "pl-9")}
            placeholder="Search name, web name, prefix"
            aria-label="Search shops"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by billing"
        >
          {FILTERS.slice(0, 4).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                "min-h-10 rounded-lg border px-3 py-1.5 text-[13px] transition-colors duration-150",
                filter === f.key
                  ? "border-gold/50 bg-gold/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            aria-expanded={showMoreFilters}
            onClick={() => setShowMoreFilters((value) => !value)}
            className="min-h-10 rounded-lg border border-border px-3 py-1.5 text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            {showMoreFilters ? "Fewer filters" : "More filters"}
          </button>
          {showMoreFilters
            ? FILTERS.slice(4).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  className={cn(
                    "min-h-10 rounded-lg border px-3 py-1.5 text-[13px] transition-colors duration-150",
                    filter === f.key
                      ? "border-gold/50 bg-gold/10 font-medium text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))
            : null}
        </div>
      </div>

      <div className={cn(tableWrap, "hidden md:block")}>
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className={theadClass}>
            <tr>
              <th className="px-4 py-3">Shop</th>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Billing</th>
              <th className="px-4 py-3">Paid until</th>
              <th className="px-4 py-3 text-right">Branches</th>
              <th className="px-4 py-3 text-right">Logins</th>
              <th className="px-4 py-3 text-right">Rentals (30 d)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shops === null ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Loading shops...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No shops match.
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s.shop_id} className="hover:bg-black/[0.02]">
                  <td className="px-4 py-3">
                    <Link
                      href={`/zypher/shops/${s.shop_id}`}
                      className="font-medium text-foreground hover:text-gold"
                    >
                      {s.name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">
                      {s.slug} · {s.token_prefix}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.business_types.map((t) => typeNames[t] ?? t).join(", ")}
                  </td>
                  <td className="px-4 py-3">
                    <span className="capitalize">{s.plan}</span>
                    <div className="text-xs text-muted-foreground">
                      {rupees(s.monthly_fee)}/month
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <BillingBadge shop={s} />
                  </td>
                  <td className="px-4 py-3">
                    {s.paid_until ? fmtDay(s.paid_until) : "Never paid"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {s.branches}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {s.active_logins}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {s.rentals_30d}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {shops === null ? (
          <div className="glass p-5 text-sm text-muted-foreground">
            Loading shops…
          </div>
        ) : rows.length === 0 ? (
          <div className="glass p-5 text-sm text-muted-foreground">
            No shops match.
          </div>
        ) : (
          rows.map((shop) => (
            <article key={shop.shop_id} className="glass p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/zypher/shops/${shop.shop_id}`}
                    className="font-semibold text-foreground underline-offset-2 hover:text-gold hover:underline"
                  >
                    {shop.name}
                  </Link>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {shop.slug} · {shop.token_prefix}
                  </p>
                </div>
                <BillingBadge shop={shop} />
              </div>
              <p className="mt-3 text-[13px] text-muted-foreground">
                {shop.business_types
                  .map((type) => typeNames[type] ?? type)
                  .join(", ") || "No business type"}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-[13px]">
                <div>
                  <p className="text-muted-foreground">Plan</p>
                  <p className="mt-0.5 font-medium capitalize">
                    {shop.plan} · {rupees(shop.monthly_fee)}/month
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Paid until</p>
                  <p className="mt-0.5 font-medium">
                    {shop.paid_until ? fmtDay(shop.paid_until) : "Never paid"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Branches · logins</p>
                  <p className="mt-0.5 font-medium tabular-nums">
                    {shop.branches} · {shop.active_logins}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Rentals, 30 days</p>
                  <p className="mt-0.5 font-medium tabular-nums">
                    {shop.rentals_30d}
                  </p>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </>
  );
}
