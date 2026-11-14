"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { METHOD_LABELS, dayRange, errorText, fmtDate, rupees, todayLocal } from "@/lib/shop/format";
import { ListSkeleton, PageHeader, Panel, ghostButtonClass } from "@/components/shop/ui";
import { downloadSheet } from "../sheet";
import { Figure, FinanceTabs, RangeBar, pageAll, r2, type Range } from "../components/FinanceBits";

// Income & expense: the rent money received (refunds taken off) beside the expenses paid, each split into cash and
// bank (UPI, card and bank transfer), and what is left. Counted when the money moved, so it matches the cashbook.
// Security deposits are not income and are left out; the Overview's "Earned" counts rentals when picked up instead.
interface Income { id: string; date: string; who: string; details: string; method: string; amount: number; rentalId: string }
interface Expense { id: string; date: string; who: string; details: string; method: string; amount: number }
const isCash = (m: string) => m === "cash";

export default function IncomeExpense() {
  const { tz, canManage, myBranchId } = useShop();
  const today = todayLocal(tz);
  const [range, setRange] = useState<Range>({ from: today.slice(0, 8) + "01", to: today, branch: myBranchId ?? "" });
  const [income, setIncome] = useState<Income[] | null>(null);
  const [expense, setExpense] = useState<Expense[] | null>(null);

  useEffect(() => {
    let live = true;
    setIncome(null);
    setExpense(null);
    if (!range.from) return;
    (async () => {
      try {
        const supabase = createClient();
        const from = dayRange(range.from, tz).from;
        const to = dayRange(range.to, tz).to;
        const pays = await pageAll<{ id: string; rental_id: string; kind: string; amount: number; method: string; paid_at: string; rentals: { token: string; customers: { full_name: string } | null } | null }>((a, b) => {
          let q = supabase.from("payments")
            .select("id, rental_id, kind, amount, method, paid_at, rentals!payments_shop_rental_fkey!inner(token, branch_id, customers!rentals_shop_customer_fkey(full_name))")
            .in("kind", ["payment", "refund"]).gte("paid_at", from).lt("paid_at", to);
          if (range.branch) q = q.eq("rentals.branch_id", range.branch);
          return q.order("paid_at").range(a, b);
        });
        const exps = await pageAll<{ id: string; spent_on: string; category: string; amount: number; method: string; paid_to: string | null; note: string | null }>((a, b) => {
          let q = supabase.from("expenses").select("id, spent_on, category, amount, method, paid_to, note").gte("spent_on", range.from).lte("spent_on", range.to);
          if (range.branch) q = q.eq("branch_id", range.branch);
          return q.order("spent_on").range(a, b);
        });
        if (!live) return;
        setIncome(pays.map((p) => ({
          id: p.id, date: p.paid_at, rentalId: p.rental_id, who: p.rentals?.customers?.full_name ?? "",
          details: `${p.kind === "refund" ? "Refund" : "Rent"} · ${p.rentals?.token ?? ""}`, method: p.method,
          amount: p.kind === "refund" ? -Number(p.amount) : Number(p.amount),
        })));
        setExpense(exps.map((e) => ({ id: e.id, date: e.spent_on, who: e.paid_to ?? "", details: [e.category, e.note].filter(Boolean).join(" · "), method: e.method, amount: Number(e.amount) })));
      } catch (e) {
        if (live) { toast.error(errorText(e)); setIncome([]); setExpense([]); }
      }
    })();
    return () => { live = false; };
  }, [range, tz]);

  const total = (list: { amount: number; method: string }[] | null, cash?: boolean) =>
    r2((list ?? []).filter((x) => cash === undefined || isCash(x.method) === cash).reduce((s, x) => s + x.amount, 0));
  const ready = income !== null && expense !== null;
  const profit = r2(total(income) - total(expense));

  const exportRows = async () => {
    try {
      await downloadSheet(`income-expense-${range.from}-to-${range.to}.xlsx`, ["Type", "Date", "Name", "Details", "Paid by", "Amount"], [
        ...(income ?? []).map((x) => ["Income", fmtDate(x.date, tz), x.who, x.details, METHOD_LABELS[x.method] ?? x.method, x.amount]),
        ...(expense ?? []).map((x) => ["Expense", fmtDate(x.date), x.who, x.details, METHOD_LABELS[x.method] ?? x.method, x.amount]),
      ], "Income & expense");
    } catch (e) { toast.error(errorText(e)); }
  };

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Only owners and managers can see finance reports.</p></Panel>;
  return (
    <>
      <PageHeader title="Finance" subtitle="Rent received and expenses paid, by cash and bank, and what is left." />
      <FinanceTabs />
      <RangeBar value={range} onChange={(r) => setRange({ ...r, from: r.from || range.from })} today={today}>
        <button type="button" className={ghostButtonClass} disabled={!ready || !(income!.length + expense!.length)} onClick={() => void exportRows()}>
          <FileSpreadsheet className="h-4 w-4" /> Excel
        </button>
      </RangeBar>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <SplitCard title="Income" cash={total(income, true)} bank={total(income, false)} ready={ready} />
        <SplitCard title="Expenses" cash={total(expense, true)} bank={total(expense, false)} ready={ready} out />
        <Figure label="Left after expenses" value={ready ? rupees(profit) : "…"} tone={profit < 0 ? "rust" : "emerald"}
          hint={ready ? `Cash ${rupees(r2(total(income, true) - total(expense, true)))} · Bank ${rupees(r2(total(income, false) - total(expense, false)))}` : undefined} />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Bank is UPI, card and bank transfer. Security deposits are not income and are left out; see the Daily cashbook for them.</p>

      {!ready ? <ListSkeleton /> : (
        <div className="grid gap-4 xl:grid-cols-2">
          <List title="Income" empty="No rent received in these dates." rows={income!.map((x) => ({ ...x, date: fmtDate(x.date, tz), href: `/rentals/${x.rentalId}` }))} />
          <List title="Expenses" empty="No expenses in these dates." rows={expense!.map((x) => ({ ...x, date: fmtDate(x.date), amount: -x.amount }))} />
        </div>
      )}
    </>
  );
}

function SplitCard({ title, cash, bank, ready, out = false }: { title: string; cash: number; bank: number; ready: boolean; out?: boolean }) {
  return (
    <div className="glass p-4">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", out ? "text-rust" : "text-foreground")}>{ready ? rupees(r2(cash + bank)) : "…"}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{ready ? `Cash ${rupees(cash)} · Bank ${rupees(bank)}` : ""}</p>
    </div>
  );
}

function List({ title, empty, rows }: { title: string; empty: string; rows: { id: string; date: string; who: string; details: string; method: string; amount: number; href?: string }[] }) {
  return (
    <section className="glass overflow-hidden p-0" aria-label={title}>
      <h2 className="border-b border-border px-4 py-3 text-base font-semibold">{title} <span className="font-normal text-muted-foreground">({rows.length})</span></h2>
      {!rows.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p> : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs font-semibold text-muted-foreground">
              <tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Details</th><th className="px-4 py-2">Paid by</th><th className="px-4 py-2 text-right">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-2">{r.date}</td>
                  <td className="px-4 py-2">{r.who || "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.href ? <Link href={r.href} className="hover:text-gold hover:underline">{r.details}</Link> : r.details}</td>
                  <td className="whitespace-nowrap px-4 py-2">{METHOD_LABELS[r.method] ?? r.method}</td>
                  <td className={cn("px-4 py-2 text-right font-mono", r.amount < 0 ? "text-rust" : "")}>{r.amount < 0 ? "−" : ""}{rupees(Math.abs(r.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
