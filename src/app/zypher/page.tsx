"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { SummaryCard, goldButtonClass, ghostButtonClass } from "@/components/overbooked/primitives";
import {
  BillingBadge, PageHeader, Panel, PaymentDialog, billingState, daysBetween, fmtDay, rupees, todayIST,
  type OverviewRow, type PayTarget,
} from "@/components/zypher/kit";

interface Summary {
  today: string;
  shops_active: number;
  shops_paused: number;
  monthly_due: number;
  collected_this_month: number;
  overdue: number;
  due_in_7_days: number;
  units: number;
  rentals_30d: number;
  active_logins: number;
}

export default function ZypherOverview() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [shops, setShops] = useState<OverviewRow[]>([]);
  const [payFor, setPayFor] = useState<PayTarget | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [s, o] = await Promise.all([supabase.rpc("console_summary"), supabase.rpc("platform_overview")]);
    if (s.error || o.error) toast.error("Could not load the overview: " + (s.error ?? o.error)?.message);
    setSummary((s.data as Summary) ?? null);
    setShops((o.data as OverviewRow[]) ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const today = todayIST();
  const attention = shops
    .map((s) => ({ s, state: billingState(s, today) }))
    .filter(({ state }) => state === "overdue" || state === "due_soon")
    .sort((a, b) => (a.s.paid_until ?? "") < (b.s.paid_until ?? "") ? -1 : 1);
  // signed up but not using it: no rentals in 30 days
  const quiet = shops.filter((s) => s.status === "active" && s.rentals_30d === 0);

  return (
    <>
      <PageHeader title="Overview" subtitle={summary ? `Today, ${fmtDay(summary.today)}` : "Loading..."}
        actions={<Link href="/zypher/shops/new" className={goldButtonClass}><Plus className="h-4 w-4" /> New shop</Link>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Active shops" value={summary?.shops_active ?? "—"}
          hint={summary?.shops_paused ? `${summary.shops_paused} paused` : "None paused"} />
        <SummaryCard label="Monthly fees" value={summary ? rupees(summary.monthly_due) : "—"} hint="Active shops, per month" tone="gold" />
        <SummaryCard label="Collected this month" value={summary ? rupees(summary.collected_this_month) : "—"} tone="emerald" />
        <SummaryCard label="Overdue" value={summary?.overdue ?? "—"} tone={summary?.overdue ? "rust" : "default"}
          hint={summary ? `${summary.due_in_7_days} due within 7 days` : undefined} />
        <SummaryCard label="Rentals, last 30 days" value={summary?.rentals_30d ?? "—"} hint="All shops" />
        <SummaryCard label="Units managed" value={summary?.units ?? "—"} />
        <SummaryCard label="Active logins" value={summary?.active_logins ?? "—"} hint="Shop staff, all shops" />
        <SummaryCard label="Shops" value={shops.length} hint="Including paused" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Payments to chase">
          {attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every active shop is paid up for the next week.</p>
          ) : (
            <ul className="divide-y divide-border">
              {attention.map(({ s }) => (
                <li key={s.shop_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/zypher/shops/${s.shop_id}`} className="font-medium text-foreground hover:text-gold">{s.name}</Link>
                    <p className="text-xs text-muted-foreground">
                      {s.paid_until
                        ? s.paid_until < today
                          ? `Paid until ${fmtDay(s.paid_until)}, ${daysBetween(s.paid_until, today)} days ago`
                          : `Paid until ${fmtDay(s.paid_until)}`
                        : "Never paid"}
                      {" · "}{rupees(s.monthly_fee)}/month
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <BillingBadge shop={s} />
                    <button className={ghostButtonClass}
                      onClick={() => setPayFor({ id: s.shop_id, name: s.name, monthly_fee: Number(s.monthly_fee), paid_until: s.paid_until })}>
                      Record payment
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Not using it">
          {quiet.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every active shop has made a booking in the last 30 days.</p>
          ) : (
            <ul className="divide-y divide-border">
              {quiet.map((s) => (
                <li key={s.shop_id} className="flex items-center justify-between gap-2 py-2.5">
                  <Link href={`/zypher/shops/${s.shop_id}`} className="font-medium text-foreground hover:text-gold">{s.name}</Link>
                  <span className="text-xs text-muted-foreground">
                    No bookings in 30 days · {s.active_logins} login{s.active_logins === 1 ? "" : "s"} · {s.units} units
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <PaymentDialog shop={payFor} onClose={() => setPayFor(null)} onSaved={load} />
    </>
  );
}
