"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { call, loadRental, money, type RentalDetail } from "@/lib/shop/api";
import {
  BASIS_LABELS, CHARGE_LABELS, DEFAULT_TZ, METHOD_LABELS, PAYMENT_LABELS, fmtDate, fmtDateTime, lineMath, rupees,
} from "@/lib/shop/format";
import type { Branch } from "@/lib/shop/types";

// Receipt or tax invoice for one booking, laid out for A4 / thermal-free printing and "Save as PDF".
export default function PrintRental() {
  const { id } = useParams<{ id: string }>();
  const { shop, isLoading } = useAuth();
  const [r, setR] = useState<RentalDetail | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [error, setError] = useState("");
  // a tax invoice has its own number and date, fixed the first time it is issued (after the return)
  const [inv, setInv] = useState<{ invoice_no: string; invoice_date: string } | null>(null);

  useEffect(() => {
    if (!shop) return;
    void loadRental(id).then(async (rental) => {
      if (!rental) return setError("Booking not found.");
      setR(rental);
      if (shop.gstin && Number(shop.settings?.gst_percent ?? 0) > 0 && rental.status === "completed") {
        setInv(await call<{ invoice_no: string; invoice_date: string }>("issue_invoice", { p_rental_id: rental.id }));
      }
      const { data } = await createClient().from("branches").select("*").eq("id", rental.branch_id).maybeSingle();
      setBranch((data as Branch) ?? null);
    }).catch((e) => setError(String(e?.message ?? e)));
  }, [id, shop]);

  if (isLoading || (!r && !error)) return <p className="p-8 text-sm">Loading...</p>;
  if (error || !r || !shop) return <p className="p-8 text-sm">{error || "Not available."}</p>;
  if (shop.gstin && Number(shop.settings?.gst_percent ?? 0) > 0 && r.status === "completed" && inv === null) return <p className="p-8 text-sm">Preparing the invoice...</p>;

  const tz = shop.timezone || DEFAULT_TZ;
  const m = money(r);
  const gst = Number(shop.settings?.gst_percent ?? 0);
  const closed = r.status === "cancelled" || r.status === "no_show";
  const isInvoice = !!shop.gstin && gst > 0 && r.status === "completed" && inv !== null;
  const sac: string = shop.settings?.sac_code ?? "";
  const taxable = Math.round((m.total / (1 + gst / 100)) * 100) / 100;
  const tax = Math.round((m.total - taxable) * 100) / 100;
  const note: string = shop.settings?.receipt_note ?? "";
  const isRoom = r.rental_lines.every((l) => l.kind === "room");

  return (
    <div className="min-h-screen bg-white text-[13px] text-black">
      <style>{`@media print { .no-print { display: none !important; } @page { size: A4; margin: 14mm; } body { background: white; } }`}</style>
      <div className="no-print sticky top-0 flex justify-between gap-2 border-b bg-gray-50 px-6 py-3">
        <button onClick={() => history.back()} className="rounded border px-3 py-1.5 text-sm">Back</button>
        <button onClick={() => window.print()} className="rounded bg-black px-4 py-1.5 text-sm font-semibold text-white">Print or save as PDF</button>
      </div>

      <div className="mx-auto max-w-[760px] p-8">
        <header className="flex items-start justify-between gap-6 border-b pb-4">
          <div>
            {shop.logo_url ? <img src={shop.logo_url} alt="" className="mb-2 h-12 w-auto object-contain" /> : null}
            <h1 className="text-xl font-bold">{shop.name}</h1>
            <p>{branch?.address || shop.address}</p>
            <p>{[branch?.phone || shop.phone, shop.email].filter(Boolean).join(" · ")}</p>
            {shop.gstin ? <p>GSTIN: {shop.gstin}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold uppercase tracking-wide">{isInvoice ? "Tax invoice" : closed ? "Cancellation receipt" : "Receipt"}</p>
            {isInvoice && inv ? <>
              <p>Invoice no. <span className="font-mono font-semibold">{inv.invoice_no}</span></p>
              <p>Invoice date: {fmtDate(inv.invoice_date, tz)}</p>
              <p>Booking: <span className="font-mono">{r.token}</span></p>
            </> : <>
              <p>No. <span className="font-mono font-semibold">{r.token}</span></p>
              <p>Printed: {fmtDate(new Date().toISOString(), tz)}</p>
            </>}
            <p>Booked: {fmtDate(r.created_at, tz)}</p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 border-b py-4">
          <div>
            <p className="text-[11px] uppercase text-gray-500">Customer</p>
            <p className="font-semibold">{r.customers.full_name}</p>
            <p>{r.customers.phone}</p>
            {r.customers.address ? <p>{r.customers.address}</p> : null}
          </div>
          <div>
            <p className="text-[11px] uppercase text-gray-500">{isRoom ? "Stay" : "Rental period"}</p>
            <p>{isRoom ? "Check-in" : "From"}: {fmtDateTime(r.actual_start_at ?? r.start_at, tz)}</p>
            <p>{isRoom ? "Check-out" : "To"}: {fmtDateTime(r.actual_end_at ?? r.end_at, tz)}</p>
            {r.status === "cancelled" || r.status === "no_show" ? <p className="font-semibold">Cancelled</p> : null}
          </div>
        </section>

        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase text-gray-500">
              <th className="py-1.5">Description</th><th className="py-1.5">Details</th><th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.rental_lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-100">
                <td className="py-1.5">{l.qty > 1 ? `${l.qty} × ` : ""}{l.description}</td>
                <td className="py-1.5 text-gray-600">{l.is_override ? "Agreed price" : lineMath(l)}</td>
                <td className="py-1.5 text-right">{rupees(l.amount)}</td>
              </tr>
            ))}
            {r.rental_add_ons.map((a) => (
              <tr key={a.id} className="border-b border-gray-100">
                <td className="py-1.5">{a.name}</td>
                <td className="py-1.5 text-gray-600">{rupees(a.unit_amount)} {BASIS_LABELS[a.basis]} × {Number(a.quantity)}</td>
                <td className="py-1.5 text-right">{rupees(a.amount)}</td>
              </tr>
            ))}
            {r.rental_charges.map((c) => (
              <tr key={c.id} className="border-b border-gray-100">
                <td className="py-1.5">{CHARGE_LABELS[c.type]}</td>
                <td className="py-1.5 text-gray-600">{c.note ?? ""}</td>
                <td className="py-1.5 text-right">{rupees(c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto mt-3 w-72 space-y-1">
          {Number(r.discount) ? <Row label="Discount" value={"−" + rupees(r.discount)} /> : null}
          {r.status === "cancelled" || r.status === "no_show" ? <Row label="Cancellation fee" value={rupees(r.cancellation_fee)} /> : null}
          <Row label="Total" value={rupees(m.total)} strong />
          {isInvoice ? <>
            <Row label={`Taxable value`} value={rupees(taxable)} small />
            <Row label={`CGST @ ${gst / 2}%`} value={rupees(Math.round((tax / 2) * 100) / 100)} small />
            <Row label={`SGST @ ${gst / 2}%`} value={rupees(Math.round((tax - Math.round((tax / 2) * 100) / 100) * 100) / 100)} small />
          </> : null}
          <Row label="Paid" value={rupees(m.paid)} />
          <Row label="Balance due" value={rupees(m.balance)} strong />
        </div>

        {r.payments.length ? (
          <section className="mt-6">
            <p className="mb-1 text-[11px] uppercase text-gray-500">Payments</p>
            <table className="w-full">
              <tbody>
                {r.payments.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="py-1">{fmtDateTime(p.paid_at, tz)}</td>
                    <td className="py-1">{PAYMENT_LABELS[p.kind]}{p.method ? ` (${METHOD_LABELS[p.method]})` : ""}</td>
                    <td className="py-1 text-right">{p.kind === "refund" || p.kind === "deposit_refund" ? "−" : ""}{rupees(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {Number(r.deposit_received) > 0 ? (
          <p className="mt-4">
            Security deposit: received {rupees(r.deposit_received)}
            {Number(r.deposit_applied) ? `, kept towards charges ${rupees(r.deposit_applied)}` : ""}
            {Number(r.deposit_refunded) ? `, returned ${rupees(r.deposit_refunded)}` : ""}
            {m.depositHeld > 0 ? `, held now ${rupees(m.depositHeld)}` : ""}.
          </p>
        ) : null}

        {isInvoice ? <p className="mt-2 text-[11px] text-gray-500">Prices include GST.{sac ? ` SAC ${sac}.` : ""}</p> : null}
        {!isInvoice && shop.gstin && gst > 0 && !closed ? <p className="mt-2 text-[11px] text-gray-500">This is a receipt. The tax invoice is issued when the rental is returned.</p> : null}
        {note ? <p className="mt-4 whitespace-pre-line border-t pt-3 text-[12px]">{note}</p> : null}
        <p className="mt-8 text-center text-[10px] text-gray-400">Generated by Overbooked</p>
      </div>
    </div>
  );
}

function Row({ label, value, strong, small }: { label: string; value: string; strong?: boolean; small?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t pt-1 font-bold" : ""} ${small ? "text-[11px] text-gray-600" : ""}`}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
