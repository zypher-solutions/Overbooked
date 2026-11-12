"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_TZ, METHOD_LABELS, PAYMENT_LABELS, fmtDate, inclusiveTaxBreakdown } from "@/lib/shop/format";
import type { Method, PaymentKind } from "@/lib/shop/types";

// One printed document of a booking (migration 040): a payment receipt (?type=receipt, the id is the payment's), or a credit
// note or supplementary bill (the id is the document's). Printing only reads; the numbers were given when they were made.
interface Doc {
  title: string; number: string; date: string; amount: number; lines: [string, string][]; note?: string | null;
  rental: { token: string; invoice_no: string | null; customers: { full_name: string; phone: string; address: string | null } | null };
}

const inr = (n: number) => "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const RENTAL = "token, invoice_no, customers!rentals_shop_customer_fkey(full_name, phone, address)";

export default function PrintDocumentPage() {
  return <Suspense fallback={<p className="p-8 text-sm">Loading...</p>}><PrintDocument /></Suspense>;
}

function PrintDocument() {
  const { id } = useParams<{ id: string }>();
  const receipt = useSearchParams().get("type") === "receipt";
  const { shop, isLoading } = useAuth();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!shop) return;
    const supabase = createClient();
    const tz = shop.timezone || DEFAULT_TZ;
    void (async () => {
      if (receipt) {
        const { data, error: e } = await supabase.from("payments").select(`receipt_no, kind, amount, method, paid_at, note, voided_at, rentals!payments_shop_rental_fkey(${RENTAL})`)
          .eq("id", id).maybeSingle();
        if (e || !data) return setError(e?.message ?? "Receipt not found.");
        const p = data as unknown as { receipt_no: string | null; kind: PaymentKind; amount: number; method: Method | null; paid_at: string; note: string | null; voided_at: string | null; rentals: Doc["rental"] };
        const back = p.kind === "refund" || p.kind === "deposit_refund";
        setDoc({
          title: p.voided_at ? "Receipt (VOID)" : back ? "Payment voucher" : "Receipt", number: p.receipt_no ?? "—", date: fmtDate(p.paid_at, tz),
          amount: Number(p.amount), note: p.note, rental: p.rentals,
          lines: [["For", PAYMENT_LABELS[p.kind]], ["Paid by", p.method ? METHOD_LABELS[p.method] : "Deposit kept"]],
        });
      } else {
        const { data, error: e } = await supabase.from("rental_documents").select(`kind, number, amount, reason, doc_date, rentals!rental_documents_shop_rental_fkey(${RENTAL})`)
          .eq("id", id).maybeSingle();
        if (e || !data) return setError(e?.message ?? "Document not found.");
        const d = data as unknown as { kind: "credit_note" | "supplementary"; number: string; amount: number; reason: string | null; doc_date: string; rentals: Doc["rental"] };
        setDoc({
          title: d.kind === "credit_note" ? "Credit note" : "Supplementary bill", number: d.number, date: fmtDate(d.doc_date, tz),
          amount: Number(d.amount), note: d.reason, rental: d.rentals, lines: [["Against tax invoice", d.rentals.invoice_no ?? "—"]],
        });
      }
    })();
  }, [id, receipt, shop]);

  if (isLoading || (!doc && !error)) return <p className="p-8 text-sm">Loading...</p>;
  if (error || !doc || !shop) return <p className="p-8 text-sm">{error || "Not available."}</p>;
  const gst = Number(shop.settings?.gst_percent ?? 0);
  const taxDoc = !receipt && !!shop.gstin && gst > 0;
  const { taxable, tax } = inclusiveTaxBreakdown(doc.amount, gst);
  const cgst = Math.round((tax / 2) * 100) / 100;

  return (
    <div className="min-h-screen bg-white text-[13px] text-black">
      <style>{`@media print { .no-print { display: none !important; } @page { size: A5; margin: 10mm; } body { background: white; } }`}</style>
      <div className="no-print sticky top-0 flex justify-between gap-2 border-b bg-gray-50 px-6 py-3">
        <button onClick={() => history.back()} className="rounded border px-3 py-1.5 text-sm">Back</button>
        <button onClick={() => window.print()} className="rounded bg-black px-4 py-1.5 text-sm font-semibold text-white">Print or save as PDF</button>
      </div>
      <div className="mx-auto max-w-[560px] p-6">
        <header className="border border-black p-3 text-center">
          <h1 className="text-lg font-bold uppercase">{shop.name}</h1>
          {shop.address ? <p>{shop.address}</p> : null}
          {shop.phone ? <p>Ph: {shop.phone}</p> : null}
          {shop.gstin ? <p>GSTIN: {shop.gstin}</p> : null}
          <p className="mt-1 font-bold uppercase tracking-wide">{doc.title}</p>
        </header>
        <section className="grid grid-cols-2 border-x border-b border-black">
          <div className="border-r border-black p-2">
            <p className="font-semibold">{doc.rental.customers?.full_name}</p>
            <p>{doc.rental.customers?.phone}</p>
            {doc.rental.customers?.address ? <p>{doc.rental.customers.address}</p> : null}
          </div>
          <div className="p-2">
            <p>No.: <span className="font-mono font-semibold">{doc.number}</span></p>
            <p>Date: {doc.date}</p>
            <p>Booking: <span className="font-mono">{doc.rental.token}</span></p>
          </div>
        </section>
        <dl className="border-x border-b border-black">
          {doc.lines.map(([k, v]) => <Line key={k} label={k} value={v} />)}
          {taxDoc ? <>
            <Line label="Taxable value" value={inr(taxable)} />
            <Line label={`CGST ${gst / 2}%`} value={inr(cgst)} />
            <Line label={`SGST ${gst / 2}%`} value={inr(Math.round((tax - cgst) * 100) / 100)} />
          </> : null}
          <Line label="Amount" value={inr(doc.amount)} strong />
        </dl>
        {doc.note ? <p className="border-x border-b border-black p-2 text-[12px]">{receipt ? "Note" : "Reason"}: {doc.note}</p> : null}
        <p className="mt-10 text-right text-[12px]">Authorised signature</p>      </div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between border-b border-black px-2 py-1 last:border-b-0 ${strong ? "font-bold" : ""}`}>
      <dt>{label}</dt><dd className="tabular-nums">{value}</dd>
    </div>
  );
}
