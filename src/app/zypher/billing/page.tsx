"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { SummaryCard, ghostButtonClass, inputClass } from "@/components/overbooked/primitives";
import {
  BillingBadge, METHOD_LABELS, PageHeader, PaymentDialog, billingState, fmtDay, rupees, tableWrap, theadClass, todayIST,
  type OverviewRow, type PayTarget,
} from "@/components/zypher/kit";

interface PaymentRow {
  id: string; shop_id: string; amount: number; paid_on: string; period_to: string; method: string; note: string | null;
}

export default function Billing() {
  const [shops, setShops] = useState<OverviewRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [payFor, setPayFor] = useState<PayTarget | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [o, p] = await Promise.all([
      supabase.rpc("platform_overview"),
      supabase.from("shop_payments").select("id, shop_id, amount, paid_on, period_to, method, note")
        .order("paid_on", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    if (o.error || p.error) toast.error("Could not load billing: " + (o.error ?? p.error)?.message);
    setShops((o.data as OverviewRow[]) ?? []);
    setPayments((p.data as PaymentRow[]) ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const today = todayIST();
  const name = (id: string) => shops.find((s) => s.shop_id === id)?.name ?? "—";
  const inMonth = useMemo(() => (payments ?? []).filter((p) => p.paid_on.startsWith(month)), [payments, month]);
  const collected = inMonth.reduce((sum, p) => sum + Number(p.amount), 0);
  const dues = shops
    .filter((s) => ["overdue", "due_soon"].includes(billingState(s, today)))
    .sort((a, b) => (a.paid_until ?? "") < (b.paid_until ?? "") ? -1 : 1);
  const expected = shops.filter((s) => s.status === "active").reduce((sum, s) => sum + Number(s.monthly_fee), 0);

  return (
    <>
      <PageHeader title="Billing" subtitle="Shops pay Zypher by bank transfer or UPI; record each payment here." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Monthly fees (active)" value={rupees(expected)} tone="gold" />
        <SummaryCard label={`Collected in ${monthLabel(month)}`} value={rupees(collected)} tone="emerald" hint={`${inMonth.length} payments`} />
        <SummaryCard label="Overdue" value={dues.filter((s) => billingState(s, today) === "overdue").length}
          tone={dues.some((s) => billingState(s, today) === "overdue") ? "rust" : "default"} />
        <SummaryCard label="Due within 7 days" value={dues.filter((s) => billingState(s, today) === "due_soon").length} />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-foreground">Due now</h2>
      <div className={tableWrap}>
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className={theadClass}>
            <tr><th className="px-4 py-3">Shop</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Paid until</th>
              <th className="px-4 py-3 text-right">Monthly fee</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {dues.map((s) => (
              <tr key={s.shop_id}>
                <td className="px-4 py-2.5"><Link href={`/zypher/shops/${s.shop_id}`} className="font-medium hover:text-gold">{s.name}</Link></td>
                <td className="px-4 py-2.5"><BillingBadge shop={s} /></td>
                <td className="px-4 py-2.5">{s.paid_until ? fmtDay(s.paid_until) : "Never paid"}</td>
                <td className="px-4 py-2.5 text-right font-mono">{rupees(s.monthly_fee)}</td>
                <td className="px-4 py-2.5 text-right">
                  <button className={ghostButtonClass}
                    onClick={() => setPayFor({ id: s.shop_id, name: s.name, monthly_fee: Number(s.monthly_fee), paid_until: s.paid_until })}>
                    Record payment
                  </button>
                </td>
              </tr>
            ))}
            {dues.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Nothing due this week.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="mb-2 mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Payments received</h2>
        <input type="month" className={inputClass + " w-auto"} aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <div className={tableWrap}>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className={theadClass}>
            <tr><th className="px-4 py-3">Received</th><th className="px-4 py-3">Shop</th><th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">Method</th><th className="px-4 py-3">Covers until</th><th className="px-4 py-3">Note</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {payments === null ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
            ) : inMonth.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2.5">{fmtDay(p.paid_on)}</td>
                <td className="px-4 py-2.5"><Link href={`/zypher/shops/${p.shop_id}`} className="hover:text-gold">{name(p.shop_id)}</Link></td>
                <td className="px-4 py-2.5 text-right font-mono">{rupees(p.amount)}</td>
                <td className="px-4 py-2.5">{METHOD_LABELS[p.method] ?? p.method}</td>
                <td className="px-4 py-2.5">{fmtDay(p.period_to)}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{p.note ?? ""}</td>
              </tr>
            ))}
            {payments !== null && inMonth.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No payments in {monthLabel(month)}.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <PaymentDialog shop={payFor} onClose={() => setPayFor(null)} onSaved={load} />
    </>
  );
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}
