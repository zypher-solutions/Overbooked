"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Printer } from "lucide-react";
import { toast } from "sonner";
import { useShop } from "@/lib/shop/ShopContext";
import { call, type RentalDetail } from "@/lib/shop/api";
import { errorText, fmtDate, num, rupees } from "@/lib/shop/format";
import { moneyError, reasonError } from "@/lib/validate";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { Field, Modal, Panel, ghostButtonClass, goldButtonClass, inputClass, monoInputClass } from "@/components/shop/ui";

// A booking's tax invoice and what came after it (migration 040). Issuing is a button: the number is given once, and
// after it the amount is only lowered by a credit note. A shop without a GSTIN and GST % prints receipts and sees nothing here.
export function BillsPanel({ rental: r, onDone }: { rental: RentalDetail; onDone: () => Promise<void> | void }) {
  const { shop, tz, setting, isOwner } = useShop();
  const [asking, setAsking] = useState(false);
  const [credit, setCredit] = useState<{ amount: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const gstShop = !!shop.gstin && Number(setting("gst_percent", 0)) > 0;
  if (!gstShop) return null;
  const atBooking = setting<string>("invoice_timing", "after_return") === "at_booking";
  const closed = r.status === "cancelled" || r.status === "no_show";
  const canIssue = !r.invoice_no && !closed && (atBooking || r.status === "completed");

  const issue = async () => {
    setAsking(false);
    setBusy(true);
    try {
      const res = await call<{ invoice_no: string }>("issue_invoice", { p_rental_id: r.id });
      toast.success(`Tax invoice ${res.invoice_no} issued`);
      await onDone();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const issueCredit = async () => {
    if (!credit) return;
    const bad = moneyError(credit.amount, { label: "amount", required: true, positive: true, max: Number(r.total) })
      ?? reasonError(credit.reason, "reason");
    if (bad) return toast.error(bad);
    setBusy(true);
    try {
      const res = await call<{ number: string }>("issue_credit_note", { p_rental_id: r.id, p_amount: num(credit.amount), p_reason: credit.reason });
      toast.success(`Credit note ${res.number} issued`);
      setCredit(null);
      await onDone();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Tax invoice">
      {r.invoice_no ? (
        <ul className="divide-y divide-border text-sm">
          <li className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-mono font-semibold">{r.invoice_no}</span>
              <span className="text-muted-foreground"> · {fmtDate(r.invoice_date, tz)} · {rupees(r.invoice_total ?? r.total)}</span>
            </span>
            <Link href={`/print/rental/${r.id}`} className={ghostButtonClass}><Printer className="h-4 w-4" /> Print</Link>
          </li>
          {r.rental_documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {d.kind === "credit_note" ? "Credit note" : "Supplementary bill"} <span className="font-mono">{d.number}</span>
                <span className="text-muted-foreground"> · {d.kind === "credit_note" ? "−" : ""}{rupees(d.amount)}{d.reason ? ` · ${d.reason}` : ""}</span>
              </span>
              <Link href={`/print/document/${d.id}`} className={ghostButtonClass}><Printer className="h-4 w-4" /> Print</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {closed ? "A cancelled booking gets no tax invoice."
            : canIssue ? "Not issued yet. Once issued, its number is fixed and the amount can only be lowered with a credit note."
            : "The tax invoice is issued after the return (Settings > Receipts & tax)."}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {canIssue ? (
          <button className={goldButtonClass} disabled={busy} onClick={() => setAsking(true)}><FileText className="h-4 w-4" /> Issue tax invoice</button>
        ) : null}
        {r.invoice_no && isOwner && !closed ? (
          <button className={ghostButtonClass} disabled={busy} onClick={() => setCredit({ amount: "", reason: "" })}>Issue credit note</button>
        ) : null}
      </div>

      <ConfirmDialog open={asking} onConfirm={() => void issue()} onCancel={() => setAsking(false)}
        message={`Issue the tax invoice for ${r.token} (${rupees(r.total)})? The number cannot be changed afterwards.`} />
      <Modal open={credit !== null} onClose={() => setCredit(null)} title="Issue a credit note"
        description={`Lowers what ${r.token} costs, with its own number against invoice ${r.invoice_no ?? ""}. Owners only; the reason is kept.`}
        footer={<button className={goldButtonClass} disabled={busy} onClick={() => void issueCredit()}>{busy ? "Saving..." : "Issue credit note"}</button>}>
        {credit ? <>
          <Field label="Amount (₹)"><input className={monoInputClass} inputMode="decimal" value={credit.amount} onChange={(e) => setCredit({ ...credit, amount: e.target.value })} /></Field>
          <Field label="Reason"><input className={inputClass} maxLength={300} value={credit.reason} onChange={(e) => setCredit({ ...credit, reason: e.target.value })} /></Field>
        </> : null}
      </Modal>
    </Panel>
  );
}
