"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { METHOD_LABELS, fmtDate, rupees, todayLocal } from "@/lib/shop/format";
import { Panel, StatusBadge } from "./ui";

const PLAN_LIMITS: Record<string, string> = {
  starter: "1 branch, 3 logins", pro: "Up to 3 branches, any number of logins", business: "No limits",
};

interface ShopPayment { id: string; receipt_no: string; kind: string; amount: number; paid_on: string; period_to: string | null; method: string }
interface Platform { company_name: string; phone: string | null; email: string | null; bank_details: string | null }

function daysUntil(isoDate: string, today: string) {
  return Math.round((Date.parse(isoDate) - Date.parse(today)) / 86_400_000);
}

// The owner's view of their Overbooked subscription: plan, paid until, payments, where to pay.
export function SubscriptionPanel() {
  const { shop, tz } = useShop();
  const [payments, setPayments] = useState<ShopPayment[]>([]);
  const [platform, setPlatform] = useState<Platform | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.from("shop_payments").select("id, receipt_no, kind, amount, paid_on, period_to, method").eq("shop_id", shop.id).order("paid_on", { ascending: false }),
      supabase.from("platform_settings").select("company_name, phone, email, bank_details").maybeSingle(),
    ]).then(([p, s]) => {
      setPayments((p.data as ShopPayment[]) ?? []);
      setPlatform((s.data as Platform) ?? null);
    });
  }, [shop.id]);

  const today = todayLocal(tz);
  const left = shop.paid_until ? daysUntil(shop.paid_until, today) : null;
  const fee = Number(shop.monthly_fee ?? 0);

  return (
    <Panel title="Your Overbooked plan" className="lg:col-span-2">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Plan</p>
          <p className="font-medium capitalize">{shop.plan}</p>
          <p className="text-xs text-muted-foreground">{PLAN_LIMITS[shop.plan]}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Paid until</p>
          <p className="font-medium">{shop.paid_until ? fmtDate(shop.paid_until) : "Not paid yet"}</p>
          {left !== null ? (
            <StatusBadge tone={left < 0 ? "rust" : left <= 7 ? "gold" : "emerald"}>
              {left < 0 ? `${-left} days overdue` : left === 0 ? "Due today" : `${left} days left`}
            </StatusBadge>
          ) : null}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Monthly fee</p>
          <p className="font-medium">{fee ? rupees(fee) : "—"}</p>
        </div>
      </div>
      {platform?.bank_details ? (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p className="mb-1 font-medium">Pay {platform.company_name} by bank transfer or UPI</p>
          <p className="whitespace-pre-line text-muted-foreground">{platform.bank_details}</p>
          <p className="mt-1 text-xs text-muted-foreground">Send the payment reference to {[platform.phone, platform.email].filter(Boolean).join(" or ") || platform.company_name}.</p>
        </div>
      ) : null}
      {payments.length ? (
        <ul className="mt-4 divide-y divide-border text-sm">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                {fmtDate(p.paid_on)} · {p.kind === "installation" ? "Installation" : p.kind === "subscription" ? "Subscription" : "Other"}
                {p.period_to ? <span className="text-muted-foreground"> to {fmtDate(p.period_to)}</span> : null}
                <span className="text-muted-foreground"> · {METHOD_LABELS[p.method] ?? p.method}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="font-mono">{rupees(p.amount)}</span>
                <Link href={`/print/zypher-receipt/${p.id}`} className="text-xs text-gold hover:underline">{p.receipt_no}</Link>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

// a reminder at the top of every screen for the owner when the subscription is due or overdue
export function SubscriptionBanner() {
  const { shop, isOwner, role, tz } = useShop();
  if (!isOwner || role === "super_admin" || !shop.paid_until) return null;
  const left = daysUntil(shop.paid_until, todayLocal(tz));
  if (left > 7) return null;
  return (
    <div role="status" className={"mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm " +
      (left < 0 ? "border-rust/50 bg-rust/10 text-rust" : "border-gold/50 bg-gold/10 text-foreground")}>
      <span>
        {left < 0 ? `Your Overbooked subscription is ${-left} days overdue.` : left === 0 ? "Your Overbooked subscription is due today."
          : `Your Overbooked subscription is due in ${left} days (${fmtDate(shop.paid_until)}).`}
      </span>
      <Link href="/settings" className="font-medium underline">How to pay</Link>
    </div>
  );
}
