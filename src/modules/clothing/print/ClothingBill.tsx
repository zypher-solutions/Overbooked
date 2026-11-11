"use client";

import type { Shop } from "@/lib/overbooked/AuthContext";
import { money, type RentalDetail } from "@/lib/shop/api";
import { CHARGE_LABELS, fmtDate } from "@/lib/shop/format";
import type { Branch } from "@/lib/shop/types";

// The clothing shop's bill, laid out like the paper bill clothing shops use (docs/LAUNCH_PACK_1_PLAN.md, D6):
// shop header; customer, bill number and bank boxes; items with delivery and return dates; the totals box
// (Total Amount, Taxable Rent, Disc, Total Taxable, CGST, SGST, Bill Amount, Advance, Payable); GSTIN and the booking
// number at the bottom left; the terms. Every figure has paise, so the box always adds up.
const r2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => "₹" + r2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// the late-fee line of the terms, from the rules copied onto this booking (migration 037), so paper and return screen agree
function lateLine(t: Record<string, unknown> | null | undefined): string | null {
  if (!t || t.on === false) return null;
  const count = t.count === "blocks" ? "for every 24 hours late" : "for every day late";
  if (t.mode === "fixed") return `Late return: ${inr(Number(t.fixed ?? 0))} per piece ${count}.`;
  const pct = Number(t.percent ?? 100);
  const what = pct === 200 ? "Double fare" : pct === 100 ? "One more day's fare" : `${pct}% of the day's fare`;
  return `Late return: ${what} ${count}${t.cutoff ? ` (returned after ${t.cutoff} counts the return day)` : ""}.`;
}

export function ClothingBill({ shop, branch, r, tz }: { shop: Shop; branch: Branch | null; r: RentalDetail; tz: string }) {
  const s = (shop.settings ?? {}) as Record<string, unknown>;
  const m = money(r);
  const gst = Number(s.gst_percent ?? 0);
  const isInvoice = !!r.invoice_no;
  const closed = r.status === "cancelled" || r.status === "no_show";
  const rate = isInvoice ? gst / 100 : 0;
  const ex = (amount: number) => r2(amount / (1 + rate));

  // what the invoice billed: charges added after it are on the supplementary bill, not here
  const later = r.rental_documents.filter((d) => d.kind === "supplementary").map((d) => d.created_at ?? "").sort()[0];
  const charges = r.rental_charges.filter((c) => !isInvoice || !later || c.created_at < later);
  const start = fmtDate(r.actual_start_at ?? r.start_at, tz);
  const end = fmtDate(r.actual_end_at ?? r.end_at, tz);
  const rows = [
    ...r.rental_lines.map((l) => ({ id: l.id, text: `${l.description}${l.qty > 1 ? ` × ${l.qty}` : ""}`, amount: Number(l.amount) })),
    ...r.rental_add_ons.map((a) => ({ id: a.id, text: `${a.name}${Number(a.quantity) > 1 ? ` × ${Number(a.quantity)}` : ""}`, amount: Number(a.amount) })),
    ...charges.map((c) => ({ id: c.id, text: `${CHARGE_LABELS[c.type]}${c.note ? `: ${c.note}` : ""}`, amount: Number(c.amount) })),
  ];

  const gross = r2(rows.reduce((t, x) => t + x.amount, 0));
  const bill = closed ? Number(r.cancellation_fee) : isInvoice ? Number(r.invoice_total ?? m.total) : m.total;
  const disc = closed ? 0 : r2(gross - bill);
  const taxableRent = r2(rows.reduce((t, x) => t + ex(x.amount), 0));
  const discTaxable = ex(disc);
  const totalTaxable = r2(taxableRent - discTaxable);
  const tax = r2(bill - totalTaxable);
  const cgst = r2(tax / 2);
  const sgst = r2(tax - cgst);

  const phones = [branch?.phone, shop.phone].filter((p, i, a) => p && a.indexOf(p) === i);
  const place = [branch?.address || shop.address, [branch?.city || shop.city, branch?.state || shop.state, branch?.pincode || shop.pincode].filter(Boolean).join(", ")]
    .filter(Boolean);
  const terms = [
    ...String(s.bill_terms ?? "").split("\n").map((t) => t.trim()).filter(Boolean),
    lateLine(r.late_terms as Record<string, unknown> | null),
    s.cancel_keeps_advance ? "If a booking is cancelled, the advance is not refunded." : null,
  ].filter(Boolean) as string[];
  const title = isInvoice ? "Tax invoice" : closed ? "Cancellation receipt" : "Bill";

  return (
    <div className="mx-auto max-w-[780px] p-6 text-[12.5px]">
      <style>{`@media print { thead { display: table-header-group; } .bill-box { break-inside: avoid; } }`}</style>
      <header className="border border-black p-3 text-center">
        {shop.logo_url ? <img src={shop.logo_url} alt="" className="mx-auto mb-1 h-12 w-auto object-contain" /> : null}
        <h1 className="text-xl font-bold uppercase">{shop.name}</h1>
        {place.map((p) => <p key={p}>{p}</p>)}
        {phones.length ? <p>Ph: {phones.join(", ")}</p> : null}
        <p className="mt-1 text-[13px] font-bold uppercase tracking-wide">{title}</p>
      </header>

      <section className="grid grid-cols-[1.3fr_1fr] border-x border-b border-black">
        <div className="border-r border-black p-2">
          <p className="text-[11px] uppercase text-gray-600">Customer</p>
          <p className="font-semibold">{r.customers.full_name}</p>
          {r.customers.address ? <p>{r.customers.address}</p> : null}
          <p>Mobile: {r.customers.phone}</p>
        </div>
        <div className="p-2">
          <p>Bill no.: <span className="font-mono font-semibold">{r.invoice_no ?? r.token}</span></p>
          <p>Bill date: {fmtDate(r.invoice_date ?? r.created_at, tz)}</p>
          {s.bank_name ? (
            <div className="mt-1 border-t border-gray-300 pt-1 text-[11.5px]">
              <p>Bank: {String(s.bank_name)}</p>
              {s.bank_holder ? <p>A/C name: {String(s.bank_holder)}</p> : null}
              {s.bank_last4 ? <p>A/C: XXXX{String(s.bank_last4)}</p> : null}
              {s.bank_ifsc ? <p>IFSC: {String(s.bank_ifsc)}</p> : null}
            </div>
          ) : null}
        </div>
      </section>

      <table className="w-full border-collapse border-x border-b border-black">
        <thead>
          <tr className="border-b border-black text-left text-[11px] uppercase">
            <th className="w-10 border-r border-black p-1.5">No.</th>
            <th className="border-r border-black p-1.5">Description</th>
            <th className="w-24 border-r border-black p-1.5">Delivery</th>
            <th className="w-24 border-r border-black p-1.5">Return</th>
            <th className="w-28 p-1.5 text-right">{isInvoice ? "Rent (taxable)" : "Rent"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={x.id} className="align-top">
              <td className="border-r border-black p-1.5">{i + 1}</td>
              <td className="border-r border-black p-1.5">{x.text}</td>
              <td className="border-r border-black p-1.5">{start}</td>
              <td className="border-r border-black p-1.5">{end}</td>
              <td className="p-1.5 text-right tabular-nums">{inr(isInvoice ? ex(x.amount) : x.amount)}</td>
            </tr>
          ))}
          {/* keeps the body tall, like the paper bill */}
          <tr style={{ height: `${Math.max(40, 220 - rows.length * 28)}px` }}>
            <td className="border-r border-black" /><td className="border-r border-black" /><td className="border-r border-black" /><td className="border-r border-black" /><td />
          </tr>
        </tbody>
      </table>

      <section className="bill-box grid grid-cols-[1fr_17rem] border-x border-b border-black">
        <div className="flex flex-col justify-between border-r border-black p-2">
          <div>
            {Number(r.deposit_agreed) > 0 || Number(r.deposit_received) > 0 ? (
              <p>Security deposit (refundable): {inr(Number(r.deposit_received) || Number(r.deposit_agreed))}
                {Number(r.deposit_received) ? " received" : " to bring"}. Not part of the bill.</p>
            ) : null}
            {isInvoice && r.rental_documents.length ? (
              <div className="mt-2 text-[11.5px]">
                <p className="font-semibold">After this invoice</p>
                {r.rental_documents.map((d) => (
                  <p key={d.id}>{d.kind === "credit_note" ? "Credit note" : "Supplementary bill"} {d.number}: {d.kind === "credit_note" ? "−" : ""}{inr(Number(d.amount))}</p>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-3 text-[11px]">
            {shop.gstin ? <p>GSTIN: {shop.gstin}</p> : null}
            {isInvoice && s.sac_code ? <p>SAC: {String(s.sac_code)}</p> : null}
            <p className="text-gray-600">ref: {r.token}</p>
          </div>
        </div>
        <dl className="text-[12.5px]">
          <Line label="Total Amount" value={inr(gross)} />
          {isInvoice ? <Line label="Taxable Rent" value={inr(taxableRent)} /> : null}
          <Line label="Disc (−)" value={disc ? inr(isInvoice ? discTaxable : disc) : "—"} />
          {isInvoice ? <>
            <Line label="Total Taxable Amt" value={inr(totalTaxable)} />
            <Line label={`CGST ${gst / 2}%`} value={inr(cgst)} />
            <Line label={`SGST ${gst / 2}%`} value={inr(sgst)} />
          </> : null}
          {closed ? <Line label="Cancellation fee" value={inr(bill)} /> : null}
          <Line label="Bill Amount" value={inr(bill)} strong />
          <Line label="Advance (−)" value={inr(m.paid)} />
          <Line label={isInvoice && m.total !== bill ? "Payable (with later bills)" : "Payable Amt"} value={inr(Math.max(0, m.balance))} strong />
        </dl>
      </section>

      {terms.length ? (
        <ol className="border-x border-b border-black p-2 pl-6 text-[11.5px] [list-style:disc]">
          {terms.map((t) => <li key={t}>{t}</li>)}
        </ol>
      ) : null}
      {isInvoice ? <p className="mt-1 text-[10.5px] text-gray-600">Prices include GST.</p> : null}
      <p className="mt-6 text-center text-[10px] text-gray-400">Generated by Overbooked</p>
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
