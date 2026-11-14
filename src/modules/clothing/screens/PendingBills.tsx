"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, MessageCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { STATUS_LABELS, errorText, fmtDate, rupees, todayLocal } from "@/lib/shop/format";
import { waLink } from "@/lib/shop/whatsapp";
import { Empty, ListSkeleton, PageHeader, Panel, StatusBadge, ghostButtonClass, inputClass, tableWrap, theadClass } from "@/components/shop/ui";
import { downloadSheet } from "../sheet";
import { Figure, FinanceTabs, RangeBar, r2, type Range } from "../components/FinanceBits";

// Pending bills: every booking with money still owed (the bill less what was paid), oldest pickup first, from the
// database (pending_bills, migration 043). The dates filter on the pickup day; "All time" shows every one.
interface Bill {
  rental_id: string; token: string; status: string; branch_id: string; customer_name: string; customer_phone: string;
  start_at: string; end_at: string; total: number; paid: number; pending: number;
}

export default function PendingBills() {
  const { shop, tz, canManage, myBranchId, branches, activeBranches } = useShop();
  const today = todayLocal(tz);
  const [range, setRange] = useState<Range>({ from: "", to: today, branch: myBranchId ?? "" });
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let live = true;
    setBills(null);
    void createClient().rpc("pending_bills" as never, { p_from: range.from || null, p_to: range.to || null, p_branch_id: range.branch || null } as never)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) { toast.error(errorText(error)); setBills([]); return; }
        setBills(((data ?? []) as Bill[]).map((b) => ({ ...b, total: Number(b.total), paid: Number(b.paid), pending: Number(b.pending) })));
      });
    return () => { live = false; };
  }, [range]);

  const term = q.trim().toLowerCase();
  const shown = useMemo(() => (bills ?? []).filter((b) => !term || `${b.token} ${b.customer_name} ${b.customer_phone}`.toLowerCase().includes(term)), [bills, term]);
  const totalBill = r2(shown.reduce((s, b) => s + b.total, 0));
  const totalPending = r2(shown.reduce((s, b) => s + b.pending, 0));
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "";
  const overdue = (b: Bill) => b.status === "completed" || (b.status === "active" && b.end_at < new Date().toISOString());

  const remind = (b: Bill) => waLink(b.customer_phone,
    `Hello ${b.customer_name}, this is ${shop.name}. ${rupees(b.pending)} is still due on your booking ${b.token}. Thank you.`);

  const exportRows = async () => {
    try {
      await downloadSheet(`pending-bills-${today}.xlsx`,
        ["Bill", "Customer", "Phone", "Branch", "Pickup", "Return", "Status", "Bill amount", "Paid", "Pending"],
        shown.map((b) => [b.token, b.customer_name, b.customer_phone, branchName(b.branch_id), fmtDate(b.start_at, tz), fmtDate(b.end_at, tz),
          STATUS_LABELS[b.status] ?? b.status, b.total, b.paid, b.pending]), "Pending bills");
    } catch (e) { toast.error(errorText(e)); }
  };

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Only owners and managers can see finance reports.</p></Panel>;
  return (
    <>
      <PageHeader title="Finance" subtitle="Bookings with money still to collect, oldest first." />
      <FinanceTabs />
      <RangeBar value={range} onChange={setRange} today={today} allowAllTime>
        <button type="button" className={ghostButtonClass} disabled={!shown.length} onClick={() => void exportRows()}>
          <FileSpreadsheet className="h-4 w-4" /> Excel
        </button>
      </RangeBar>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Figure label="Bills with money due" value={bills ? String(shown.length) : "…"} />
        <Figure label="Total of these bills" value={bills ? rupees(totalBill) : "…"} />
        <Figure label="Still to collect" value={bills ? rupees(totalPending) : "…"} tone={totalPending > 0 ? "rust" : "emerald"} />
      </div>

      <div className="relative mb-3 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input className={cn(inputClass, "pl-9")} placeholder="Bill number, customer or phone" aria-label="Search pending bills" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {bills === null ? <ListSkeleton /> : !shown.length ? (
        <Panel><Empty>{term || range.from ? "No bill with money due matches." : "Every bill is paid in full."}</Empty></Panel>
      ) : (
        <div className={tableWrap}>
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className={theadClass}>
              <tr>
                <th className="px-4 py-3">Bill</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Pickup → return</th>
                <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Bill amount</th><th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Pending</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((b) => (
                <tr key={b.rental_id} className="hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/rentals/${b.rental_id}`} className="font-mono text-xs font-semibold text-gold hover:underline">{b.token}</Link>
                    {activeBranches.length > 1 ? <span className="block text-xs text-muted-foreground">{branchName(b.branch_id)}</span> : null}
                  </td>
                  <td className="px-4 py-2.5"><span className="block font-medium">{b.customer_name}</span><span className="font-mono text-xs text-muted-foreground">{b.customer_phone}</span></td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{fmtDate(b.start_at, tz)} → {fmtDate(b.end_at, tz)}</td>
                  <td className="px-4 py-2.5"><StatusBadge tone={overdue(b) ? "rust" : "muted"}>{STATUS_LABELS[b.status] ?? b.status}</StatusBadge></td>
                  <td className="px-4 py-2.5 text-right font-mono">{rupees(b.total)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{rupees(b.paid)}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-rust">{rupees(b.pending)}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex justify-end gap-1.5">
                      <Link href={`/rentals/${b.rental_id}`} className={cn(ghostButtonClass, "min-h-9 px-3")}>Collect</Link>
                      <a href={remind(b)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${b.customer_name} about ${b.token}`}
                        className="rounded-md border border-emerald/20 bg-emerald/10 p-2 text-emerald hover:bg-emerald/20"><MessageCircle className="h-4 w-4" /></a>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
