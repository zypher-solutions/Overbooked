"use client";

import Link from "next/link";
import { Check, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { call, money } from "@/lib/shop/api";
import { variationLabel } from "@/lib/shop/useCatalog";
import { BASIS_LABELS, METHOD_LABELS, addDays, isoToZoned, lineMath, num, plural, rupees, todayLocal } from "@/lib/shop/format";
import type { Customer, Method } from "@/lib/shop/types";
import { CustomerPicker } from "@/components/shop/CustomerPicker";
import { moneyError } from "@/lib/validate";
import { DateInput, isoToDisplay } from "@/components/shop/DateInput";
import { Field, Modal, ghostButtonClass, goldButtonClass, inputClass, monoInputClass, Skeleton } from "@/components/shop/ui";
import type { BookingForm as BookingFormState, Piece } from "@/components/shop/useBookingForm";

// The bridal and groom "Create Booking" screen, as in TRENDZ: one column, dates first
export function BookingForm({ f }: { f: BookingFormState }) {
  const { router, shop, tz, myBranchId, activeBranches, addOns, editing, d, customer, setCustomer, set, cart, lines, branchId, setBranch, variations, startIso, endIso, startInPast, periodOk, cleaningBad, cleaning, avail, pieceLines, pieces, shortItems, checkingStock, detailsOpen, quote, quoteError, updateLine, busy, editPay, setEditPay, total, shown, submit, booked, confirmDiscard, setConfirmDiscard, reset, visibleAddOns, quoteLineFor } = f;
  const pickupDate = d.start.slice(0, 10);
  const returnDate = d.end.slice(0, 10);
  const timeOf = (v: string, fallback: string) => v.slice(11, 16) || fallback;
  // pickup and return are dates; the times are the shop's usual ones (10:00 out, 18:00 back)
  const onPickup = (date: string) => set({
    start: date ? `${date}T${timeOf(d.start, "10:00")}` : "",
    end: d.end && date && returnDate < date ? "" : d.end,
  });
  const onReturn = (date: string) => set({ end: date ? `${date}T${timeOf(d.end, "18:00")}` : "" });
  const bookingDays = quote?.days ?? (pickupDate && returnDate ? Math.max(1, Math.round((Date.parse(returnDate) - Date.parse(pickupDate)) / 86_400_000)) : 0);
  const closeForm = () => {
    if (editing) router.push(`/rentals/${editing.id}`);
    else if (window.history.length > 1) router.back();
    else router.push("/scan");
  };
  const methodSelect = (value: Method | "", onChange: (m: Method | "") => void, label: string) => (
    <select aria-label={label} className={inputClass} value={value} onChange={(e) => onChange(e.target.value as Method | "")}>
      <option value="">[ Select ]</option>
      {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
  const branchName = activeBranches.find((b) => b.id === branchId)?.name ?? "";
  const allFree = periodOk && lines.length > 0 && !checkingStock && shortItems.length === 0;
  const balance = Math.max(0, total - num(d.advance));
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Create Booking">
      <div className="my-0 w-full max-w-2xl glass p-4 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">{editing ? `Change booking ${editing.token}` : "Create Booking"}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {editing ? "Change dates, items or extras. The pieces it already has are kept where possible." : "Select rental dates first to check product availability."}
            </p>
          </div>
          <button type="button" aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-black/5" onClick={closeForm}><X className="h-5 w-5" /></button>
        </div>
        <Modal open={!!booked} onClose={() => router.push("/bookings")} title="Booking confirmed"
          description={booked ? `${booked.customer} · ${booked.phone}` : undefined}
          footer={<>
            {booked ? <Link href={`/print/rental/${booked.rentalId}`} target="_blank" className={ghostButtonClass}>Print receipt</Link> : null}
            {booked?.wa ? <a href={booked.wa} target="_blank" rel="noopener noreferrer" className={ghostButtonClass}
              onClick={() => { void call("mark_reminder_sent", { p_rental_id: booked.rentalId, p_kind: "confirmation" }).catch(() => undefined); }}>WhatsApp</a> : null}
            <button className={goldButtonClass} onClick={() => router.push("/bookings")}>Done</button>
          </>}>
          {booked ? (
            <div className="rounded-xl bg-accent/60 p-4 text-center">
              <p className="font-mono text-2xl font-bold text-gold">{booked.token}</p>
              <p className="mt-2 font-mono text-sm">{isoToDisplay(isoToZoned(booked.start, tz).slice(0, 10))} <span className="text-muted-foreground">→</span> {isoToDisplay(isoToZoned(booked.end, tz).slice(0, 10))}</p>
              <p className="mt-2 text-sm text-muted-foreground">Total {rupees(booked.total)} · Paid {rupees(booked.paid)}{booked.total - booked.paid > 0 ? ` · Due ${rupees(booked.total - booked.paid)}` : ""}</p>
            </div>
          ) : <span />}
        </Modal>
        <Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="Discard this draft?"
          description="All cart items and the customer details typed in are cleared."
          footer={<>
            <button className={ghostButtonClass} onClick={() => setConfirmDiscard(false)}>Keep it</button>
            <button className={goldButtonClass} onClick={reset}>Discard</button>
          </>}>
          <span />
        </Modal>

        {/* 1. dates and branch */}
        <section className="mt-4 space-y-3 rounded-xl border border-gold/30 bg-gold/[0.03] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gold">1. Rental Schedule &amp; Branch</span>
            {periodOk && bookingDays ? <span className="font-mono text-xs text-muted-foreground">Duration: <strong className="text-foreground">{plural(bookingDays, "day")}</strong></span> : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Pickup Date" hint="Walk-in customers use today's date" error={startInPast ? "The pickup cannot be in the past" : undefined}>
              <DateInput value={pickupDate} min={editing ? undefined : todayLocal(tz)} onChange={onPickup} aria-label="Pickup date" />
            </Field>
            <Field label="Return Date" hint={!returnDate ? "Required to check availability" : undefined}
              error={d.start && d.end && endIso <= startIso ? "Must be after the pickup" : undefined}>
              <DateInput value={returnDate} min={pickupDate || todayLocal(tz)} onChange={onReturn} aria-label="Return date" />
            </Field>
            <Field label="Select Branch">
              {activeBranches.length > 1 && !myBranchId && !editing ? (
                <select className={inputClass} value={branchId} onChange={(e) => setBranch(e.target.value)}>
                  {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              ) : <input className={inputClass} value={branchName} disabled readOnly />}
            </Field>
            <Field label="Maintenance Buffer (Days)" hint="Post-return cleaning days" error={cleaningBad ? "Cannot be negative" : undefined}>
              <input type="number" min={0} className={monoInputClass} inputMode="numeric" value={d.cleaningDays} onChange={(e) => set({ cleaningDays: e.target.value })} />
            </Field>
          </div>
          {periodOk ? (
            <div className="flex flex-col gap-1.5 border-t border-border/40 pt-3 font-mono text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:text-xs">
              <span>Duration: <strong className="text-foreground">{plural(bookingDays, "day")}</strong></span>
              <span>Buffer: <strong className="text-foreground">{plural(cleaning ?? 0, "day")}</strong></span>
              <span>Available: <strong className="text-emerald">{isoToDisplay(addDays(returnDate, (cleaning ?? 0) + 1))}</strong></span>
            </div>
          ) : null}
        </section>

        {/* cart items and their availability */}
        <section className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Cart Items ({lines.length})</h2>
            {allFree ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald/30 bg-emerald/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald"><Check className="h-3.5 w-3.5" /> All Items In Stock</span> : null}
          </div>
          {lines.length === 0 ? (
            <div className="rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">
              The cart is empty. Pick items from{" "}
              <Link href="/scan" className="font-medium text-gold hover:underline">Inventory Search</Link> or{" "}
              <Link href="/catalog" className="font-medium text-gold hover:underline">All Products</Link> and press Rent.
            </div>
          ) : !periodOk ? (
            <div className="rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">Please select a <strong>Return Date</strong> above to check real-time stock availability.</div>
          ) : checkingStock ? (
            <div className="animate-pulse rounded-lg border border-gold/40 bg-gold/5 p-3 text-xs text-gold">Checking physical piece availability for {isoToDisplay(pickupDate)} → {isoToDisplay(returnDate)}...</div>
          ) : shortItems.length > 0 ? (
            <div className="space-y-1.5 rounded-lg border border-rust/60 bg-rust/10 p-3.5 text-xs text-rust">
              <p className="text-sm font-semibold">Not Available for Selected Dates</p>
              <ul className="list-inside list-disc space-y-0.5 font-medium text-foreground">
                {shortItems.map((l) => {
                  const v = variations.get(l.variation_id);
                  const free = pieceLines.includes(l) ? pieces?.[l.variation_id]?.length ?? 0 : avail[l.variation_id]?.free ?? 0;
                  return <li key={l.variation_id}>{v ? variationLabel(v.product, v.variation) : "Item"} — needed: {l.qty}, available: {free}</li>;
                })}
              </ul>
              <p className="text-[11px] text-muted-foreground">Please adjust the rental dates above or choose another product before proceeding.</p>
            </div>
          ) : null}

          {lines.map((l) => {
            const info = variations.get(l.variation_id);
            const ql = quoteLineFor(l.variation_id);
            const list = pieces?.[l.variation_id];
            return (
              <div key={l.variation_id} className="rounded-xl border border-border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted/50">
                      {info?.product.image_url ? <img src={info.product.image_url} alt="" className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold leading-tight">{info?.product.name ?? "…"}</p>
                      <p className="break-words font-mono text-xs text-foreground/80">{info?.variation.sku}</p>
                      {info && info.variation.name !== info.product.name ? <p className="break-words text-[11px] text-muted-foreground">{info.variation.name}</p> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1.5">
                    <p className="font-mono text-sm">{ql ? (ql.is_override ? "Agreed price" : lineMath(ql)) : ""}{ql ? <strong className="ml-2">{rupees(ql.amount)}</strong> : null}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded border border-border bg-muted/70">
                        <button type="button" aria-label="One less" className="px-3 py-1.5 text-muted-foreground hover:bg-black/5" onClick={() => updateLine(l.variation_id, { qty: l.qty - 1, unit_ids: l.unit_ids.slice(0, l.qty - 1) })}>-</button>
                        <span className="w-8 text-center font-mono text-sm">{l.qty}</span>
                        <button type="button" aria-label="One more" className="px-3 py-1.5 text-muted-foreground hover:bg-black/5" onClick={() => updateLine(l.variation_id, { qty: l.qty + 1 })}>+</button>
                      </div>
                      <button type="button" aria-label="Remove from cart" className="rounded-md p-2 text-muted-foreground hover:bg-rust/15 hover:text-rust" onClick={() => updateLine(l.variation_id, { qty: 0, unit_ids: [] })}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                </div>
                {pieceLines.includes(l) && periodOk ? (
                  <div className="mt-3 space-y-2.5 border-t border-border/40 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gold">Assign Physical Piece(s) (Mandatory)</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{list ? `${list.length} Available for dates` : ""}</span>
                    </div>
                    {!list ? <Skeleton className="h-10 w-full" />
                      : list.length === 0 ? <p className="rounded border border-rust/30 bg-rust/10 p-2 text-xs font-medium text-rust">No pieces available for {info?.variation.sku} on the requested dates. Choose another date or variation.</p>
                      : Array.from({ length: l.qty }, (_, i) => {
                        const val = l.unit_ids[i] ?? "";
                        return (
                          <label key={i} className="flex flex-col gap-1.5 text-xs sm:flex-row sm:items-center">
                            {l.qty > 1 ? <span className="w-auto font-mono font-medium text-muted-foreground sm:w-14">Piece {i + 1}:</span> : null}
                            <select className={cn(inputClass, "w-full flex-1 py-2 font-mono text-xs sm:py-1.5")} value={val}
                              aria-label={`Piece ${i + 1} of ${info ? variationLabel(info.product, info.variation) : "item"}`}
                              onChange={(e) => {
                                const ids = Array.from({ length: l.qty }, (_, k) => l.unit_ids[k] ?? "");
                                ids[i] = e.target.value;
                                updateLine(l.variation_id, { unit_ids: ids.filter(Boolean) });
                              }}>
                              <option value="" disabled>[ Select Physical Piece ]</option>
                              {list.map((p) => {
                                const elsewhere = l.unit_ids.includes(p.unit_id) && val !== p.unit_id;
                                return <option key={p.unit_id} value={p.unit_id} disabled={elsewhere}>{p.code}{elsewhere ? " (Selected for another piece)" : ""}</option>;
                              })}
                            </select>
                          </label>
                        );
                      })}
                  </div>
                ) : null}
              </div>
            );
          })}
          {quote?.lines.filter((l) => !l.reserve).map((l, i) => (
            <p key={"x" + i} className="flex justify-between gap-2 text-sm"><span>{l.description}</span><span className="font-mono">{rupees(l.amount)}</span></p>
          ))}
          {quoteError ? <p className="text-sm text-rust">{quoteError}</p> : null}

          {visibleAddOns.length ? (
            <div className="rounded-xl border border-border p-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Extras</p>
              <ul className="space-y-1.5">
                {visibleAddOns.map((a) => {
                  const on = d.addOns[a.id] !== undefined;
                  const q = quote?.add_ons.find((x) => x.add_on_id === a.id);
                  return (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                      <label className="flex min-w-0 items-center gap-2">
                        <input type="checkbox" checked={on} onChange={(e) => {
                          const next = { ...d.addOns };
                          if (e.target.checked) next[a.id] = 1; else delete next[a.id];
                          set({ addOns: next });
                        }} />
                        <span className="truncate">{a.name} <span className="text-xs text-muted-foreground">{rupees(a.amount)} {BASIS_LABELS[a.basis]}</span></span>
                      </label>
                      {on ? (
                        <span className="flex items-center gap-1.5">
                          {a.basis === "per_rental" || a.basis === "per_day" ? (
                            <input type="number" min={1} aria-label={`How many ${a.name}`} className={cn(monoInputClass, "w-14 py-0.5 text-xs")}
                              value={d.addOns[a.id]} onChange={(e) => set({ addOns: { ...d.addOns, [a.id]: Math.max(1, Math.floor(num(e.target.value))) } })} />
                          ) : null}
                          <span className="font-mono">{q ? rupees(q.amount) : ""}</span>
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

        </section>

        {/* 2. customer and payment: open once every item is free */}
        {checkingStock && !detailsOpen ? (
          <section aria-label="Checking stock" className="mt-4 space-y-4 rounded-xl border border-border p-4 sm:p-5">
            <Skeleton className="h-3 w-56" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
            <Skeleton className="h-28" />
            <Skeleton className="h-12" />
          </section>
        ) : !detailsOpen ? (
          <section className="mt-4 space-y-2 rounded-xl border border-dashed border-border/80 p-6 text-center">
            <h2 className="text-sm font-semibold">Customer &amp; Payment Details</h2>
            <p className="mx-auto max-w-md text-xs text-muted-foreground">
              {!periodOk ? "Select pickup and return dates above to verify product availability before entering customer details."
                : lines.length === 0 ? "Add the items first."
                : checkingStock ? "Checking stock availability across physical pieces..."
                : "Some cart items are unavailable for the selected dates. Please adjust dates or cart items to unlock customer details."}
            </p>
          </section>
        ) : (
          <section className="mt-4 space-y-4 rounded-xl border border-border p-4 sm:p-5">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gold">2. Customer Information &amp; Payment</h2>
            {editing ? (
              <p className="text-sm"><span className="font-medium">{editing.customers.full_name}</span> · {editing.customers.phone}</p>
            ) : (
              <CustomerPicker selected={customer} onSelect={(c) => { setCustomer(c); set({ customerId: c?.id ?? null }); }}
                draft={d.customer} onDraft={(c) => set({ customer: c })} needsLicence={false} />
            )}
            {!editing ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Advance Paid (₹)" hint="Amount collected upfront from customer" error={shown("advance", d.advance)}>
                  <input className={monoInputClass} inputMode="decimal" maxLength={10} value={d.advance} onChange={(e) => set({ advance: e.target.value })} />
                </Field>
                <Field label="Advance Payment Method" error={shown("advanceMethod", d.advance)}>{methodSelect(d.advanceMethod, (m) => set({ advanceMethod: m }), "Advance payment method")}</Field>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Discount (₹)" hint="Negotiated reduction on the rental charge" error={shown("discount", d.discount)}>
                <input className={monoInputClass} inputMode="decimal" maxLength={10} value={d.discount} onChange={(e) => set({ discount: e.target.value })} />
              </Field>
              {/* one deposit: what is agreed is what is taken now (a change to an unpicked booking changes the agreed amount) */}
              <Field label="Security Deposit (₹)" hint="Tracked separately from rental charge"
                error={editing ? moneyError(d.depositAgreed, { label: "deposit", max: 1_000_000 }) ?? undefined : shown("deposit", d.deposit)}>
                {editing
                  ? <input className={monoInputClass} inputMode="decimal" maxLength={10} value={d.depositAgreed} onChange={(e) => set({ depositAgreed: e.target.value })} />
                  : <input className={monoInputClass} inputMode="decimal" maxLength={10} value={d.deposit} onChange={(e) => set({ deposit: e.target.value, depositAgreed: e.target.value })} />}
              </Field>
              {!editing ? <Field label="Deposit Payment Method" error={shown("depositMethod", d.deposit)}>{methodSelect(d.depositMethod, (m) => set({ depositMethod: m }), "Deposit payment method")}</Field> : null}
            </div>

            {editing ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Take a payment now (₹)" hint="Optional" error={shown("editPay", editPay.amount)}>
                  <input className={monoInputClass} inputMode="decimal" maxLength={10} value={editPay.amount} onChange={(e) => setEditPay({ ...editPay, amount: e.target.value })} />
                </Field>
                <Field label="Payment Method" error={shown("editPayMethod", editPay.amount)}>{methodSelect(editPay.method, (m) => setEditPay({ ...editPay, method: m }), "Payment method")}</Field>
              </div>
            ) : null}

            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gold">Payment Summary</p>
              <div className="space-y-2 font-mono text-sm">
                <div className="flex items-center justify-between"><span className="font-sans text-muted-foreground">Rental Total{num(d.discount) > 0 ? ` (after ${rupees(num(d.discount))} discount)` : ""}</span><strong>{rupees(total)}</strong></div>
                {editing ? (
                  <>
                    <div className="flex items-center justify-between"><span className="font-sans text-muted-foreground">Paid so far</span><strong className="text-emerald">{rupees(money(editing).paid)}</strong></div>
                    <div className="flex items-center justify-between border-t border-border/40 pt-3"><span className="font-sans font-semibold">Balance after this</span><strong className="text-base text-gold">{rupees(Math.max(0, total - money(editing).paid - num(editPay.amount)))}</strong></div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between"><span className="font-sans text-muted-foreground">Advance Paid</span><strong className="text-emerald">{rupees(num(d.advance))}</strong></div>
                    <div className="flex items-center justify-between border-t border-border/40 pt-3"><span className="font-sans font-semibold">Remaining Amount</span><strong className="text-base text-gold">{rupees(balance)}</strong></div>
                    <div className="flex items-center justify-between pt-1 text-xs"><span className="font-sans text-muted-foreground">Security Deposit (tracked separately)</span><strong className="text-muted-foreground">{rupees(num(d.deposit))}</strong></div>
                  </>
                )}
              </div>
              {editing && total < money(editing).paid ? <p className="text-xs text-rust">The new total is less than what was paid. Record a refund on the booking first.</p> : null}
            </div>

            <Field label="Notes" error={shown("notes", d.notes)}><textarea rows={2} maxLength={600} className={inputClass} placeholder="Anything staff should remember…" value={d.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>

            <button className={cn(goldButtonClass, "mt-1 w-full")} disabled={busy || !quote} onClick={submit}>
              {busy ? "Processing Booking..." : editing ? "Save change" : `Confirm Booking (${rupees(total)})`}
            </button>
          </section>
        )}

        <div className="mt-3 flex gap-2">
          {!editing ? (
            <button type="button" disabled={busy} onClick={() => setConfirmDiscard(true)}
              className="flex-1 rounded-lg border border-rust/40 bg-rust/10 py-2.5 text-xs font-semibold text-rust transition-colors hover:bg-rust/20">Discard Draft</button>
          ) : null}
          <button type="button" disabled={busy} onClick={closeForm}
            className="flex-1 rounded-lg border border-border py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground">
            {editing ? "Cancel" : "Close (Keep Draft)"}
          </button>
        </div>
      </div>
    </div>
  );
}
