"use client";

import type { Shop } from "@/lib/overbooked/AuthContext";
import { money, type RentalDetail } from "@/lib/shop/api";
import { CHARGE_LABELS, DEFAULT_TZ } from "@/lib/shop/format";
import type { Branch } from "@/lib/shop/types";

// The clothing shop's bill, laid out like the paper bill clothing shops use (docs/LAUNCH_PACK_1_PLAN.md, D6):
// shop logo, name, address and mobiles; name / date / bill no.; address and bank box; items with delivery and return dates,
// rent, discount and total rent; GSTIN and the booking ref beside the totals box (Total Amount, Taxable Rent, Disc, Total
// Taxable, CGST, SGST, Bill Amount, Advance, Payable); the terms. One table, so every column lines up top to bottom.
// Every figure has paise, so the box always adds up. The shop's own name and details only: no Overbooked branding.
const r2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => "₹" + r2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// dd/mm/yyyy like the paper bill; a bare date (yyyy-mm-dd) is not shifted by the time zone
const dmy = (iso: string | null | undefined, tz = DEFAULT_TZ) => !iso ? "" : new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso)
  .toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: iso.length === 10 ? "UTC" : tz });

// the late-fee line of the terms, from the rules copied onto this booking (migration 037), so paper and return screen agree
function lateLine(t: Record<string, unknown> | null | undefined): string | null {
  if (!t || t.on === false) return null;
  const count = t.count === "blocks" ? "for every 24 hours late" : "for every day late";
  if (t.mode === "fixed") return `Late return: ${inr(Number(t.fixed ?? 0))} per piece ${count}.`;
  const pct = Number(t.percent ?? 100);
  const what = pct === 200 ? "Double fare" : pct === 100 ? "One more day's fare" : `${pct}% of the day's fare`;
  return `Late return: ${what} ${count}${t.cutoff ? ` (returned after ${t.cutoff} counts the return day)` : ""}.`;
}

const B = "border border-black";
const LABEL = "font-serif font-bold whitespace-nowrap";

export function ClothingBill({ shop, branch, r, tz }: { shop: Shop; branch: Branch | null; r: RentalDetail; tz: string }) {
  const s = (shop.settings ?? {}) as Record<string, unknown>;
  // the booking's branch may print its own GSTIN and bank (migration 042); blank = the shop's
  const own = (branch?.settings ?? {}) as Record<string, unknown>;
  const bankOwn = !!own.bank_name;
  const bank = (k: string) => String((bankOwn ? own[k] : s[k]) ?? "");
  const gstin = branch?.gstin || shop.gstin;
  const m = money(r);
  const gst = Number(s.gst_percent ?? 0);
  const isInvoice = !!r.invoice_no;
  const closed = r.status === "cancelled" || r.status === "no_show";
  const rate = isInvoice ? gst / 100 : 0;
  const ex = (amount: number) => r2(amount / (1 + rate));

  // what the invoice billed: charges added after it are on the supplementary bill, not here
  const later = r.rental_documents.filter((d) => d.kind === "supplementary").map((d) => d.created_at ?? "").sort()[0];
  const charges = r.rental_charges.filter((c) => !isInvoice || !later || c.created_at < later);
  const start = dmy(r.actual_start_at ?? r.start_at, tz);
  const end = dmy(r.actual_end_at ?? r.end_at, tz);
  const rows = [
    ...r.rental_lines.map((l) => ({ id: l.id, text: `${l.description} (Qty: ${l.qty})`, amount: Number(l.amount) })),
    ...r.rental_add_ons.map((a) => ({ id: a.id, text: `${a.name} (Qty: ${Number(a.quantity)})`, amount: Number(a.amount) })),
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

  // the booking's discount spread over the lines by amount, the last line takes the rounding, so the column sums to the box
  let left = disc;
  const lines = rows.map((x, i) => {
    const d = i === rows.length - 1 ? r2(left) : gross ? r2((disc * x.amount) / gross) : 0;
    left = r2(left - d);
    return { ...x, rent: ex(x.amount), disc: ex(d), total: r2(x.amount - d) };
  });

  const phones = [branch?.phone, shop.phone].filter((p, i, a) => p && a.indexOf(p) === i);
  const place = [branch?.address || shop.address, branch?.city || shop.city, branch?.state || shop.state]
    .filter(Boolean).join(", ") + ((branch?.pincode || shop.pincode) ? `-${branch?.pincode || shop.pincode}` : "");
  const terms = [
    ...String(s.bill_terms ?? "").split("\n").map((t) => t.trim()).filter(Boolean),
    lateLine(r.late_terms as Record<string, unknown> | null),
    s.cancel_keeps_advance ? "If a booking is cancelled, the advance is not refunded." : null,
  ].filter(Boolean) as string[];
  // a plain bill has no title, like the paper one; a tax invoice must say so
  const title = isInvoice ? "Tax Invoice" : closed ? "Cancellation Receipt" : null;

  // the totals between Total Amount and Advance; the GSTIN / ref cell on the left spans them
  const middle: [string, string, boolean?][] = [
    ...(isInvoice ? [["Taxable Rent", inr(taxableRent)] as [string, string]] : []),
    ["Disc. (-)", inr(isInvoice ? discTaxable : disc)],
    ...(isInvoice ? [
      ["Total Taxable Amt.", inr(totalTaxable)],
      [`CGST(${gst / 2}%)`, inr(cgst), true],
      [`SGST(${gst / 2}%)`, inr(sgst), true],
    ] as [string, string, boolean][] : []),
    ...(closed ? [["Cancellation fee", inr(bill)] as [string, string]] : []),
    ["Bill Amount", inr(bill)],
  ];
  const cells = Math.max(0, 10 - lines.length);

  return (
    <div className="mx-auto max-w-[800px] p-4 font-sans text-[12px] leading-snug text-black">
      <style>{`@media print { .bill-shade { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="border border-black">
        <header className="flex items-start gap-4 px-2 py-2">
          {shop.logo_url ? <img src={shop.logo_url} alt="" className="h-20 w-24 shrink-0 object-contain" /> : null}
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-bold leading-tight">{shop.name}</h1>
            {place ? <p className="text-[14px]">{place}</p> : null}
            {phones.length ? <p className="mt-1 text-[14px]"><b>Mo.:</b> {phones.join(" | ")}</p> : null}
          </div>
          {title ? <p className="shrink-0 font-bold uppercase tracking-wide">{title}</p> : null}
        </header>

        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-[5%]" /><col className="w-[30%]" /><col className="w-[13%]" /><col className="w-[13%]" />
            <col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[15%]" />
          </colgroup>
          <tbody>
            <tr>
              <td colSpan={4} className={`${B} border-l-0 px-1 py-1`}><b>Name:</b> {r.customers.full_name}</td>
              <td className={`${B} ${LABEL} px-1 py-1 text-center`}>{dmy(r.invoice_date ?? r.created_at, tz)}</td>
              <td colSpan={2} className={`${B} border-r-0 px-1 py-1 text-right`}><span className={LABEL}>Bill No.:</span> {r.invoice_no ?? r.token}</td>
            </tr>
            <tr>
              <td colSpan={4} className={`${B} border-l-0 h-[46px] px-1 py-1 align-top`}><b>Address:</b> {r.customers.address ?? ""}</td>
              <td colSpan={3} rowSpan={2} className={`${B} border-r-0 px-1 py-1 align-top text-[11px] font-semibold`}>
                <p>Bank Name: <span className="font-normal">{bank("bank_name")}</span></p>
                <p className="mt-1.5">IFSC: <span className="font-normal">{bank("bank_ifsc")}</span></p>
                <p className="mt-1.5">A/C No.: <span className="font-normal">{bank("bank_last4") ? `XXXX${bank("bank_last4")}` : ""}</span></p>
              </td>
            </tr>
            <tr>
              <td colSpan={4} className={`${B} border-l-0 px-1 py-1 font-serif`}><b>Mobile:</b> {r.customers.phone}</td>
            </tr>

            <tr className="bill-shade bg-gray-300 text-left">
              <th className={`${B} border-l-0 ${LABEL} px-1 py-0.5`}>No.</th>
              <th className={`${B} ${LABEL} px-1 py-0.5`}>Description</th>
              <th className={`${B} ${LABEL} px-1 py-0.5`}>Delivery</th>
              <th className={`${B} ${LABEL} px-1 py-0.5`}>Return</th>
              <th className={`${B} ${LABEL} px-1 py-0.5 text-right`}>Rent</th>
              <th className={`${B} ${LABEL} px-1 py-0.5 text-right`}>Discount</th>
              <th className={`${B} border-r-0 ${LABEL} px-1 py-0.5 text-right`}>Total Rent</th>
            </tr>
            {lines.map((x, i) => (
              <tr key={x.id} className="align-top">
                <td className="border-r border-black px-1 py-1 text-center font-serif">{i + 1}</td>
                <td className="border-r border-black px-1 py-1">{x.text}</td>
                <td className="whitespace-nowrap border-r border-black px-1 py-1">{start}</td>
                <td className="whitespace-nowrap border-r border-black px-1 py-1">{end}</td>
                <td className="border-r border-black px-1 py-1 text-right tabular-nums">{inr(x.rent)}</td>
                <td className="border-r border-black px-1 py-1 text-right tabular-nums">{inr(x.disc)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{inr(x.total)}</td>
              </tr>
            ))}
            {/* keeps the body tall with its column lines, like the paper bill */}
            <tr style={{ height: `${cells * 42 + 40}px` }}>
              {[0, 1, 2, 3, 4, 5].map((k) => <td key={k} className="border-r border-black" />)}<td />
            </tr>

            <tr>
              <td colSpan={4} className={`${B} border-l-0 px-1 py-1 font-serif`}>{gstin ? <>GSTIN: {gstin}</> : null}</td>
              <td colSpan={2} className={`${B} ${LABEL} px-1 py-1 text-right`}>Total Amount</td>
              <td className={`${B} border-r-0 px-1 py-1 text-right tabular-nums`}>{inr(gross)}</td>
            </tr>
            {middle.map(([label, value, small], i) => (
              <tr key={label}>
                {i === 0 ? (
                  <td colSpan={4} rowSpan={middle.length} className={`${B} border-l-0 px-1 py-1 align-top text-[11px]`}>
                    <p>ref: {r.token}</p>
                    {isInvoice && s.sac_code ? <p>SAC: {String(s.sac_code)}</p> : null}
                    {Number(r.deposit_agreed) > 0 || Number(r.deposit_received) > 0 ? (
                      <p className="mt-1">Security deposit (refundable): {inr(Number(r.deposit_received) || Number(r.deposit_agreed))}
                        {Number(r.deposit_received) ? " received" : " to bring"}. Not part of the bill.</p>
                    ) : null}
                    {isInvoice && r.rental_documents.length ? (
                      <div className="mt-1">
                        <p className="font-semibold">After this invoice</p>
                        {r.rental_documents.map((d) => (
                          <p key={d.id}>{d.kind === "credit_note" ? "Credit note" : "Supplementary bill"} {d.number}: {d.kind === "credit_note" ? "−" : ""}{inr(Number(d.amount))}</p>
                        ))}
                      </div>
                    ) : null}
                    {isInvoice ? <p className="mt-1">Prices include GST.</p> : null}
                  </td>
                ) : null}
                <td colSpan={2} className={`${B} ${LABEL} px-1 ${small ? "py-0.5 text-[10.5px]" : "py-1"} text-right`}>{label}</td>
                <td className={`${B} border-r-0 px-1 ${small ? "py-0.5 font-serif text-[10.5px]" : "py-1"} text-right tabular-nums`}>{value}</td>
              </tr>
            ))}
            {([["Advance (-)", inr(m.paid)], [isInvoice && m.total !== bill ? "Payable (with later bills)" : "Payable Amt.", inr(Math.max(0, m.balance))]] as const)
              .map(([label, value]) => (
                <tr key={label}>
                  <td colSpan={2} className={`${B} border-l-0 h-[26px]`} />
                  <td colSpan={2} className={B} />
                  <td colSpan={2} className={`${B} ${LABEL} px-1 py-1 text-right`}>{label}</td>
                  <td className={`${B} border-r-0 px-1 py-1 text-right tabular-nums`}>{value}</td>
                </tr>
              ))}
            <tr>
              <td colSpan={7} className="h-[130px] border-t border-black px-1 py-1 align-top text-[12px]">
                {terms.map((t) => <p key={t}>• {t}</p>)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
