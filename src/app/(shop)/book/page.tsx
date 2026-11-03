"use client";

import { Suspense, useEffect, useState } from "react";
import { Check, Minus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import { call, money } from "@/lib/shop/api";
import { headlinePrice, variationLabel } from "@/lib/shop/useCatalog";
import { BASIS_LABELS, errorText, lineMath, num, plural, rupees } from "@/lib/shop/format";
import type { Customer, Product, Quote, Template } from "@/lib/shop/types";
import { CustomerPicker } from "@/components/shop/CustomerPicker";
import { Field, MethodPicker, MoneyRows, PageHeader, Panel, StatusBadge, ghostButtonClass, goldButtonClass, inputClass, monoInputClass, PageSkeleton } from "@/components/shop/ui";
import { useBookingForm, type BookingForm as BookingFormState } from "@/components/shop/useBookingForm";
import { shopModules } from "@/modules/registry";

export default function NewBookingPage() {
  // defaults (branch, times) come from the shop setup, so wait for it
  const { loading } = useShop();
  if (loading) return <PageSkeleton columns={false} />;
  return <Suspense fallback={<PageSkeleton columns={false} />}><NewBooking /></Suspense>;
}

function NewBooking() {
  const f = useBookingForm();
  const { BookingForm } = shopModules[f.businessModule];
  // changing a booking: nothing half-drawn until the booking has loaded
  if (f.editId && !f.editing) return <PageSkeleton columns={false} />;
  return BookingForm ? <BookingForm f={f} /> : <StandardBookingForm f={f} />;
}

// cars, bikes and resorts (and any shop without a booking form of its own)
function StandardBookingForm({ f }: { f: BookingFormState }) {
  const { router, myBranchId, activeBranches, categories, addOns, templateOf, feature, word, products, editing, d, customer, setCustomer, set, lines, branchId, setBranch, variations, startIso, endIso, periodOk, kinds, hasRoom, hasVehicle, roomShop, avail, pieces, quote, quoteError, addLine, updateLine, busy, total, submit, reset, visibleAddOns, quoteLineFor } = f;
  return (
    <>
      <PageHeader title={editing ? `Change booking ${editing.token}` : "New booking"}
        subtitle={editing ? "Change dates, items, guests or extras. The pieces it already has are kept where possible." : undefined}
        actions={editing
          ? <button className={ghostButtonClass} onClick={() => router.push(`/rentals/${editing.id}`)}>Cancel</button>
          : <>
            <button className={ghostButtonClass} onClick={reset}>Start over</button>
          </>} />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Panel title="When">
            <div className={"grid gap-3 sm:grid-cols-3"}>
              {activeBranches.length > 1 ? (
                <Field label="Branch">
                  <select className={inputClass} value={branchId} disabled={!!myBranchId || !!editing}
                    onChange={(e) => setBranch(e.target.value)}>
                    {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
              ) : null}
              <Field label={hasRoom ? "Check-in" : word("start")}
                >
                <input type="datetime-local" className={inputClass} value={d.start} onChange={(e) => set({ start: e.target.value })} />
              </Field>
              <Field label={hasRoom ? "Check-out" : word("end")}
                error={d.start && d.end && endIso <= startIso ? "Must be after the start" : undefined}
                hint={quote ? periodText(quote, kinds) : undefined}>
                <input type="datetime-local" className={inputClass} value={d.end} onChange={(e) => set({ end: e.target.value })} />
              </Field>
            </div>
            {(hasRoom || (roomShop && feature("guests"))) ? (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Adults"><input type="number" min={0} className={monoInputClass} value={d.adults} onChange={(e) => set({ adults: Math.max(0, Math.floor(num(e.target.value))) })} /></Field>
                <Field label="Children"><input type="number" min={0} className={monoInputClass} value={d.children} onChange={(e) => set({ children: Math.max(0, Math.floor(num(e.target.value))) })} /></Field>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              {roomShop && feature("whole_property") ? (
                <label className="flex items-center gap-2"><input type="checkbox" checked={d.wholeProperty} onChange={(e) => set({ wholeProperty: e.target.checked })} /> Book the whole property</label>
              ) : null}
              {hasVehicle && feature("with_driver") ? (
                <label className="flex items-center gap-2"><input type="checkbox" checked={d.withDriver} onChange={(e) => set({ withDriver: e.target.checked })} /> With driver</label>
              ) : null}
            </div>
          </Panel>

          {!d.wholeProperty ? (
            <ItemPicker products={products} categories={categories} templateOf={templateOf} avail={avail} periodOk={periodOk}
              inCart={Object.fromEntries(lines.map((l) => [l.variation_id, l.qty]))} onAdd={addLine} />
          ) : null}

          <Panel title="Customer">
            {editing ? (
              <p className="text-sm"><span className="font-medium">{editing.customers.full_name}</span> · {editing.customers.phone}</p>
            ) : (
              <CustomerPicker selected={customer} onSelect={(c) => { setCustomer(c); set({ customerId: c?.id ?? null }); }}
                draft={d.customer} onDraft={(c) => set({ customer: c })} needsLicence={hasVehicle} />
            )}
          </Panel>
        </div>

        <div id="booking-summary" className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Panel title="Booking">
            {lines.length === 0 && !d.wholeProperty ? (
              <p className="text-sm text-muted-foreground">Add {word("items").toLowerCase()} from the list.</p>
            ) : null}
            <ul className="space-y-3">
              {lines.map((l) => {
                const info = variations.get(l.variation_id);
                const ql = quoteLineFor(l.variation_id);
                const free = avail[l.variation_id]?.free;
                return (
                  <li key={l.variation_id} className="rounded-lg border border-border p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{info ? variationLabel(info.product, info.variation) : "…"}</p>
                        <p className="text-xs text-muted-foreground">
                          {ql ? (ql.is_override ? "Agreed price" : lineMath(ql)) : ""}
                          {free !== undefined && l.qty > free ? <span className="ml-1 text-rust">only {free} free</span> : null}
                        </p>
                      </div>
                      <span className="font-mono text-sm">{ql ? rupees(ql.amount) : ""}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button aria-label="One less" className="rounded border border-border p-1" onClick={() => updateLine(l.variation_id, { qty: l.qty - 1, unit_ids: l.unit_ids.slice(0, l.qty - 1) })}>
                        {l.qty === 1 ? <Trash2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                      </button>
                      <span className="w-6 text-center font-mono text-sm">{l.qty}</span>
                      <button aria-label="One more" className="rounded border border-border p-1" onClick={() => updateLine(l.variation_id, { qty: l.qty + 1, unit_ids: [] })}>
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <input className={cn(monoInputClass, "ml-auto w-28 py-1 text-xs")} inputMode="decimal" placeholder="Agreed price"
                        aria-label="Agreed price for this line" value={l.amount_override}
                        onChange={(e) => updateLine(l.variation_id, { amount_override: e.target.value })} />
                    </div>
                    {periodOk && (info?.template?.kind === "vehicle" || info?.template?.kind === "room") ? (
                      <UnitChooser branchId={branchId} variationId={l.variation_id} startIso={startIso} endIso={endIso}
                        qty={l.qty} chosen={l.unit_ids} onChange={(ids) => updateLine(l.variation_id, { unit_ids: ids })} />
                    ) : null}
                  </li>
                );
              })}
              {quote?.lines.filter((l) => !l.reserve || d.wholeProperty).map((l, i) => (
                <li key={"x" + i} className="flex justify-between gap-2 text-sm">
                  <span>{l.description} <span className="text-xs text-muted-foreground">({lineMath(l)})</span></span>
                  <span className="font-mono">{rupees(l.amount)}</span>
                </li>
              ))}
            </ul>
            {quoteError ? <p className="mt-3 text-sm text-rust">{quoteError}</p> : null}

            {visibleAddOns.length ? (
              <div className="mt-4 border-t border-border pt-3">
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

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
              <Field label="Discount"><input className={monoInputClass} inputMode="decimal" value={d.discount} onChange={(e) => set({ discount: e.target.value })} /></Field>
              <Field label="Deposit agreed"><input className={monoInputClass} inputMode="decimal" value={d.depositAgreed} onChange={(e) => set({ depositAgreed: e.target.value })} /></Field>
            </div>
            <div className="mt-3">
              <MoneyRows rows={[
                ["Items", rupees(quote?.items_total ?? 0), "muted"],
                ...(quote?.add_ons_total ? [["Extras", rupees(quote.add_ons_total), "muted"] as [string, string, "muted"]] : []),
                ...(num(d.discount) > 0 ? [["Discount", "−" + rupees(num(d.discount)), "muted"] as [string, string, "muted"]] : []),
                ["Total", rupees(total), "strong"],
              ]} />
            </div>
          </Panel>

          {editing ? (
            <Panel title="Save the change">
              <div className="space-y-3">
                <Field label="Notes"><textarea className={inputClass} rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
                <MoneyRows rows={[
                  ["New total", rupees(total)],
                  ["Paid so far", rupees(money(editing).paid), "muted"],
                  ["Balance after this", rupees(Math.max(0, total - money(editing).paid)), total > money(editing).paid ? "rust" : "emerald"],
                ]} />
                {total < money(editing).paid ? (
                  <p className="text-xs text-rust">The new total is less than what was paid. Record a refund on the booking first.</p>
                ) : null}
                <button className={cn(goldButtonClass, "w-full")} disabled={busy || !quote} onClick={submit}>
                  {busy ? "Saving..." : "Save change"}
                </button>
              </div>
            </Panel>
          ) : (
          <Panel title="Paid now">
            <div className="space-y-3">
              <Field label="Advance"><input className={monoInputClass} inputMode="decimal" value={d.advance} onChange={(e) => set({ advance: e.target.value })} /></Field>
              {num(d.advance) > 0 ? <MethodPicker value={d.advanceMethod} onChange={(m) => set({ advanceMethod: m })} /> : null}
              <Field label="Deposit received" hint={num(d.depositAgreed) ? `Agreed ${rupees(num(d.depositAgreed))}; the rest can be taken at ${word("start").toLowerCase()}` : undefined}>
                <input className={monoInputClass} inputMode="decimal" value={d.deposit} onChange={(e) => set({ deposit: e.target.value })} />
              </Field>
              {num(d.deposit) > 0 ? <MethodPicker value={d.depositMethod} onChange={(m) => set({ depositMethod: m })} /> : null}
              <Field label="Notes"><textarea className={inputClass} rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
              <MoneyRows rows={[["Balance after this", rupees(Math.max(0, total - num(d.advance))), num(d.advance) < total ? "rust" : "emerald"]]} />
              <button className={cn(goldButtonClass, "w-full")} disabled={busy || !quote} onClick={submit}>
                {busy ? "Booking..." : "Confirm booking"}
              </button>
            </div>
          </Panel>
          )}
        </div>
      </div>

      {/* phones: the total stays in sight while picking items */}
      {quote ? (
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg lg:hidden">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Total</p>
            <p className="font-mono text-lg font-semibold">{rupees(total)}</p>
          </div>
          <button className={goldButtonClass} onClick={() => document.getElementById("booking-summary")?.scrollIntoView({ behavior: "smooth" })}>
            {editing ? "Review and save" : "Payment and confirm"}
          </button>
        </div>
      ) : null}
    </>
  );
}

function periodText(q: Quote, kinds: Set<string>) {
  if (kinds.has("room")) return plural(q.nights, "night");
  if (kinds.has("vehicle")) return q.hours >= 24 ? `${plural(Math.floor(q.hours / 24), "day")}${q.hours % 24 ? ` ${plural(q.hours % 24, "hour")}` : ""}` : plural(q.hours, "hour");
  return plural(q.days, "day");
}

function ItemPicker({ products, categories, templateOf, avail, periodOk, inCart, onAdd }: {
  products: Product[] | null;
  categories: { id: string; name: string }[];
  templateOf: (id: string) => Template | undefined;
  avail: Record<string, { free: number; total: number }>;
  periodOk: boolean;
  inCart: Record<string, number>;
  onAdd: (variationId: string) => void;
}) {
  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const list = (products ?? [])
    .filter((p) => !cat || p.category_id === cat)
    .flatMap((p) => (p.product_variations ?? []).filter((v) => v.is_enabled).map((v) => ({ p, v })))
    .filter(({ p, v }) => !term || `${p.name} ${v.name} ${v.sku} ${Object.values(v.attributes).join(" ")}`.toLowerCase().includes(term));

  return (
    <Panel title="What" actions={
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input className={cn(inputClass, "w-48 py-1.5 pl-8 text-xs")} placeholder="Search" aria-label="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
    }>
      {categories.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[{ id: "", name: "All" }, ...categories].map((c) => (
            <button key={c.id || "all"} onClick={() => setCat(c.id)} aria-pressed={cat === c.id}
              className={cn("rounded-full border px-3 py-1 text-xs", cat === c.id ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}>
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      {products === null ? <p className="text-sm text-muted-foreground">Loading...</p> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing matches.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {list.map(({ p, v }) => {
            const a = avail[v.id];
            const price = headlinePrice(v);
            const left = a ? a.free - (inCart[v.id] ?? 0) : undefined;
            const kind = templateOf(p.category_id)?.kind;
            return (
              <li key={v.id}>
                <button type="button" onClick={() => onAdd(v.id)} disabled={periodOk && left !== undefined && left <= 0}
                  className="flex w-full items-start gap-3 rounded-lg border border-border p-2.5 text-left transition-colors hover:border-gold/40 disabled:opacity-50">
                  {p.image_url ? <img src={p.image_url} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{variationLabel(p, v)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[price ? `${rupees(price.amount)} / ${price.unit}` : "No price", kind === "room" && v.max_occupancy ? `up to ${v.max_occupancy} guests` : "",
                        ...Object.values(v.attributes ?? {})].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {periodOk && a ? (
                    <StatusBadge tone={left! > 0 ? "emerald" : "rust"}>
                      {inCart[v.id] ? `${Math.max(0, left!)} more free` : `${a.free} of ${a.total} free`}
                    </StatusBadge>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// pick exact rooms or vehicles (optional; otherwise the system picks free ones)
function UnitChooser({ branchId, variationId, startIso, endIso, qty, chosen, onChange }: {
  branchId: string; variationId: string; startIso: string; endIso: string; qty: number; chosen: string[]; onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [units, setUnits] = useState<{ unit_id: string; code: string }[] | null>(null);

  useEffect(() => {
    if (!open) return;
    void call<{ unit_id: string; code: string }[]>("find_available_units",
      { p_branch_id: branchId, p_variation_id: variationId, p_start: startIso, p_end: endIso })
      .then(setUnits).catch((e) => toast.error(errorText(e)));
  }, [open, branchId, variationId, startIso, endIso]);

  if (!open) {
    return (
      <button type="button" className="mt-1.5 text-xs text-gold hover:underline" onClick={() => setOpen(true)}>
        {chosen.length ? `Chosen: ${chosen.length}. Change` : "Choose which one"}
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {units === null ? <span className="text-xs text-muted-foreground">Loading...</span> : units.length === 0 ? (
        <span className="text-xs text-rust">None free for these dates.</span>
      ) : units.map((u) => {
        const on = chosen.includes(u.unit_id);
        return (
          <button key={u.unit_id} type="button" aria-pressed={on}
            onClick={() => onChange(on ? chosen.filter((x) => x !== u.unit_id) : chosen.length < qty ? [...chosen, u.unit_id] : [...chosen.slice(1), u.unit_id])}
            className={cn("rounded-md border px-2 py-0.5 font-mono text-xs", on ? "border-gold bg-gold/10" : "border-border")}>
            {u.code}
          </button>
        );
      })}
      <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => { onChange([]); setOpen(false); }}>Let the system choose</button>
    </div>
  );
}
