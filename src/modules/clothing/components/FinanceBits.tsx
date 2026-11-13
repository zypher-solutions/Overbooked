"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { addDays } from "@/lib/shop/format";
import { useShop } from "@/lib/shop/ShopContext";
import { DateInput } from "@/components/shop/DateInput";
import { inputClass } from "@/components/shop/ui";

// The Finance reports share one row of links, one date-and-branch bar and one paging helper.
const REPORTS = [
  { href: "/finance", label: "Overview" },
  { href: "/finance/cashbook", label: "Daily cashbook" },
  { href: "/finance/pending", label: "Pending bills" },
  { href: "/finance/income-expense", label: "Income & expense" },
  { href: "/finance/products", label: "Product performance" },
];

export function FinanceTabs(): React.JSX.Element {
  const pathname = usePathname();
  return (
    <nav aria-label="Finance reports" className="-mt-2 mb-5 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none]">
      <ul className="flex min-w-max gap-1">
        {REPORTS.map((r) => {
          const on = pathname === r.href;
          return (
            <li key={r.href}>
              <Link href={r.href} aria-current={on ? "page" : undefined}
                className={cn("-mb-px inline-flex min-h-10 items-center border-b-2 px-3 text-sm transition-colors",
                  on ? "border-gold font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {r.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export interface Range { from: string; to: string; branch: string }

// quick choices for the dates; "" from = no start (all time)
export function presets(today: string): { label: string; from: string; to: string }[] {
  const month = today.slice(0, 8) + "01";
  const lastMonthEnd = addDays(month, -1);
  return [
    { label: "Today", from: today, to: today },
    { label: "This month", from: month, to: today },
    { label: "Last month", from: lastMonthEnd.slice(0, 8) + "01", to: lastMonthEnd },
    { label: "Last 90 days", from: addDays(today, -89), to: today },
  ];
}

export function RangeBar({ value, onChange, today, allowAllTime = false, children }: {
  value: Range; onChange: (next: Range) => void; today: string; allowAllTime?: boolean; children?: React.ReactNode;
}): React.JSX.Element {
  const { myBranchId, activeBranches } = useShop();
  const choices = [...presets(today), ...(allowAllTime ? [{ label: "All time", from: "", to: today }] : [])];
  return (
    <div className="glass mb-4 flex flex-wrap items-end gap-3 p-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-foreground">From</span>
        <DateInput value={value.from} max={value.to || today} aria-label="From date" onChange={(from) => onChange({ ...value, from })} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-foreground">To</span>
        <DateInput value={value.to} min={value.from || undefined} max={today} aria-label="To date" onChange={(to) => onChange({ ...value, to: to || today })} />
      </label>
      {!myBranchId && activeBranches.length > 1 ? (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-foreground">Branch</span>
          <select className={cn(inputClass, "w-auto")} value={value.branch} onChange={(e) => onChange({ ...value, branch: e.target.value })}>
            <option value="">All branches</option>
            {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick dates">
        {choices.map((p) => {
          const on = value.from === p.from && value.to === p.to;
          return (
            <button key={p.label} type="button" aria-pressed={on} onClick={() => onChange({ ...value, from: p.from, to: p.to })}
              className={cn("min-h-9 rounded-full border px-3 text-xs", on ? "border-gold/60 bg-gold/10 font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
              {p.label}
            </button>
          );
        })}
      </div>
      {children ? <div className="ml-auto flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

// every row of a query, 1000 at a time
export async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data as T[]) ?? [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "rust" | "emerald" | "gold" }): React.JSX.Element {
  return (
    <div className="glass p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "rust" ? "text-rust" : tone === "emerald" ? "text-emerald" : tone === "gold" ? "text-gold" : "text-foreground")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export const r2 = (n: number) => Math.round(n * 100) / 100;
