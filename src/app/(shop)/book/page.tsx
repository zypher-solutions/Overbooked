"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { headlinePrice, useCatalog, variationLabel } from "@/lib/shop/useCatalog";
import {
  BASIS_LABELS, addDays, errorText, isoToZoned, lineMath, num, plural, rupees, todayLocal, zonedToIso,
} from "@/lib/shop/format";
import type { Customer, Method, Product, Quote, Template, Variation } from "@/lib/shop/types";
import { CustomerPicker, emptyCustomer, type NewCustomer } from "@/components/shop/CustomerPicker";
import {
  Field, MethodPicker, MoneyRows, PageHeader, Panel, StatusBadge, ghostButtonClass, goldButtonClass, inputClass, monoInputClass,
} from "@/components/shop/ui";

interface Line { variation_id: string; qty: number; amount_override: string; unit_ids: string[] }
interface Draft {
  branchId: string;
  start: string;
  end: string;
  lines: Line[];
  adults: number;
  children: number;
  withDriver: boolean;
  wholeProperty: boolean;
  addOns: Record<string, number>; // add_on_id -> quantity
  customer: NewCustomer;
  customerId: string | null;
  discount: string;
  depositAgreed: string;
  advance: string;
  advanceMethod: Method | "";
  deposit: string;
  depositMethod: Method | "";
  notes: string;
}

export default function NewBookingPage() {
  // defaults (branch, times) come from the shop setup, so wait for it
  const { loading } = useShop();
  if (loading) return <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p>;
  return <Suspense fallback={null}><NewBooking /></Suspense>;
}

function defaultPeriod(kind: Template["kind"] | undefined, tz: string, checkIn: string, checkOut: string) {
  const today = todayLocal(tz);
  if (kind === "room") return { start: `${today}T${checkIn}`, end: `${addDays(today, 1)}T${checkOut}` };
  if (kind === "vehicle") {
    const next = isoToZoned(new Date(Date.now() + 60 * 60 * 1000).toISOString(), tz).slice(0, 13) + ":00";
    return { start: next, end: isoToZoned(new Date(Date.parse(zonedToIso(next, tz)) + 24 * 3600 * 1000).toISOString(), tz) };
  }
  return { start: `${addDays(today, 1)}T10:00`, end: `${addDays(today, 3)}T18:00` };
}

function NewBooking() {
  const router = useRouter();
  const params = useSearchParams();
  const { shop, tz, myBranchId, activeBranches, categories, templates, addOns, templateOf, feature, setting, word } = useShop();
  const { products } = useCatalog();
  const storageKey = `ob_booking_${shop.id}`;

  const initial = (): Draft => {
    const p = defaultPeriod(templates[0]?.kind, tz, setting("check_in_time", "14:00"), setting("check_out_time", "11:00"));
    return {
      branchId: myBranchId ?? activeBranches[0]?.id ?? "", start: p.start, end: p.end, lines: [], adults: 1, children: 0,
      withDriver: false, wholeProperty: false, addOns: {}, customer: emptyCustomer, customerId: null, discount: "",
      depositAgreed: "", advance: "", advanceMethod: "", deposit: "", depositMethod: "", notes: "",
    };
  };
  const [d, setD] = useState<Draft>(initial);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const restored = useRef(false);

  // keep a half-filled booking if the page is left by accident (this tab only)
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const draft = JSON.parse(saved) as Draft;
        const fresh = initial();
        const branchOk = activeBranches.some((b) => b.id === draft.branchId);
        setD({ ...fresh, ...draft, branchId: myBranchId ?? (branchOk ? draft.branchId : fresh.branchId) });
        if (draft.customerId) {
          void createClient().from("customers").select("*").eq("id", draft.customerId).maybeSingle()
            .then(({ data }) => setCustomer((data as Customer) ?? null));
        }
      }
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ ...d, customerId: customer?.id ?? null })); } catch { /* ignore */ }
  }, [d, customer, storageKey]);

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  // ---- catalog lookups ----
  const variations = useMemo(() => {
    const map = new Map<string, { product: Product; variation: Variation; template: Template | undefined }>();
    for (const p of products ?? []) for (const v of p.product_variations ?? []) {
      if (v.is_enabled) map.set(v.id, { product: p, variation: v, template: templateOf(p.category_id) });
    }
    return map;
  }, [products, templateOf]);

  // ?variation=... from the catalog's "Book" button
  const prefill = params.get("variation");
  useEffect(() => {
    if (prefill && variations.has(prefill)) {
      setD((x) => x.lines.some((l) => l.variation_id === prefill) ? x
        : { ...x, lines: [...x.lines, { variation_id: prefill, qty: 1, amount_override: "", unit_ids: [] }] });
      router.replace("/book");
    }
  }, [prefill, variations, router]);

  // ?customer=... from a customer's page
  const prefillCustomer = params.get("customer");
  useEffect(() => {
    if (!prefillCustomer) return;
    void createClient().from("customers").select("*").eq("id", prefillCustomer).maybeSingle().then(({ data }) => {
      if (data) { setCustomer(data as Customer); setD((x) => ({ ...x, customerId: (data as Customer).id })); }
      router.replace("/book");
    });
  }, [prefillCustomer, router]);

  const startIso = d.start ? zonedToIso(d.start, tz) : "";
  const endIso = d.end ? zonedToIso(d.end, tz) : "";
  const periodOk = !!startIso && !!endIso && endIso > startIso;

  const cartTemplates = useMemo(() => {
    const keys = new Set<string>();
    for (const l of d.lines) { const t = variations.get(l.variation_id)?.template; if (t) keys.add(t.key); }
    if (d.wholeProperty) templates.filter((t) => t.kind === "room").forEach((t) => keys.add(t.key));
    return templates.filter((t) => keys.has(t.key));
  }, [d.lines, d.wholeProperty, variations, templates]);
  const kinds = new Set(cartTemplates.map((t) => t.kind));
  const hasRoom = kinds.has("room");
  const hasVehicle = kinds.has("vehicle");
  const roomShop = templates.some((t) => t.kind === "room");

  // ---- availability for the period ----
  const [avail, setAvail] = useState<Record<string, { free: number; total: number }>>({});
  useEffect(() => {
    if (!periodOk || !d.branchId) return;
    const t = setTimeout(async () => {
      try {
        const rows = await call<{ variation_id: string; free: number; total: number }[]>("branch_availability",
          { p_branch_id: d.branchId, p_start: startIso, p_end: endIso });
        setAvail(Object.fromEntries(rows.map((r) => [r.variation_id, { free: r.free, total: r.total }])));
      } catch (e) {
        toast.error(errorText(e));
      }
    }, 250);
    return () => clearTimeout(t);
  }, [d.branchId, startIso, endIso, periodOk]);

  // ---- live quote ----
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quoteInput = useMemo(() => ({
    branch_id: d.branchId, start_at: startIso, end_at: endIso, adults: d.adults, children: d.children,
    with_driver: d.withDriver && hasVehicle, whole_property: d.wholeProperty,
    lines: d.lines.map((l) => ({
      variation_id: l.variation_id, qty: l.qty,
      ...(l.amount_override.trim() !== "" ? { amount_override: num(l.amount_override) } : {}),
      ...(l.unit_ids.length === l.qty ? { unit_ids: l.unit_ids } : {}),
    })),
    add_ons: Object.entries(d.addOns).map(([add_on_id, quantity]) => ({ add_on_id, quantity })),
  }), [d, startIso, endIso, hasVehicle]);

  useEffect(() => {
    if (!periodOk || !d.branchId || (d.lines.length === 0 && !d.wholeProperty)) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setQuote(await call<Quote>("quote_rental", { p: quoteInput }));
        setQuoteError(null);
      } catch (e) {
        setQuote(null);
        setQuoteError(errorText(e));
      }
    }, 350);
    return () => clearTimeout(t);
  }, [quoteInput, periodOk, d.branchId, d.lines.length, d.wholeProperty]);

  // ---- cart ----
  const addLine = (variationId: string) => setD((x) => {
    const existing = x.lines.find((l) => l.variation_id === variationId);
    if (existing) return { ...x, lines: x.lines.map((l) => l === existing ? { ...l, qty: l.qty + 1, unit_ids: [] } : l) };
    return { ...x, lines: [...x.lines, { variation_id: variationId, qty: 1, amount_override: "", unit_ids: [] }] };
  });
  const updateLine = (variationId: string, patch: Partial<Line>) =>
    set({ lines: d.lines.map((l) => l.variation_id === variationId ? { ...l, ...patch } : l).filter((l) => l.qty > 0) });

  // ---- submit ----
  const [busy, setBusy] = useState(false);
  const total = Math.max(0, (quote?.total_before_discount ?? 0) - num(d.discount));

  const submit = async () => {
    if (!periodOk) return toast.error(`The ${word("end").toLowerCase()} must be after the ${word("start").toLowerCase()}.`);
    if (!quote) return toast.error(quoteError ?? "Add at least one item.");
    if (!customer && (!d.customer.full_name.trim() || !d.customer.phone.trim())) return toast.error("Enter the customer's name and phone.");
    if (num(d.advance) > 0 && !d.advanceMethod) return toast.error("Choose how the advance was paid.");
    if (num(d.deposit) > 0 && !d.depositMethod) return toast.error("Choose how the deposit was paid.");
    setBusy(true);
    try {
      const supabase = createClient();
      // a returning customer's licence, filled in here
      if (customer && hasVehicle && d.customer.licence_number.trim()) {
        const { error } = await supabase.from("customers").update({
          licence_number: d.customer.licence_number.trim(), licence_expiry: d.customer.licence_expiry || null,
        }).eq("id", customer.id);
        if (error) throw error;
      }
      const res = await call<{ rental_id: string; token: string }>("create_rental", {
        p: {
          ...quoteInput,
          customer: customer ? { id: customer.id } : Object.fromEntries(Object.entries(d.customer).map(([k, v]) => [k, v.trim()])),
          discount: num(d.discount),
          deposit_agreed: num(d.depositAgreed),
          notes: d.notes,
          advance: num(d.advance) > 0 ? { amount: num(d.advance), method: d.advanceMethod } : null,
          deposit: num(d.deposit) > 0 ? { amount: num(d.deposit), method: d.depositMethod } : null,
        },
      });
      try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
      toast.success(`Booked: ${res.token}`);
      router.push(`/rentals/${res.rental_id}?new=1`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
    setCustomer(null);
    setD(initial());
  };

  const visibleAddOns = addOns.filter((a) => a.is_active
    && (a.template_keys.length === 0 || a.template_keys.some((k) => cartTemplates.some((t) => t.key === k))));
  const quoteLineFor = (variationId: string) => quote?.lines.find((l) => l.variation_id === variationId && l.reserve);

  return (
    <>
      <PageHeader title="New booking" actions={<button className={ghostButtonClass} onClick={reset}>Start over</button>} />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Panel title="When">
            <div className="grid gap-3 sm:grid-cols-3">
              {activeBranches.length > 1 ? (
                <Field label="Branch">
                  <select className={inputClass} value={d.branchId} disabled={!!myBranchId}
                    onChange={(e) => set({ branchId: e.target.value, lines: d.lines.map((l) => ({ ...l, unit_ids: [] })) })}>
                    {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
              ) : null}
              <Field label={hasRoom ? "Check-in" : word("start")}>
                <input type="datetime-local" className={inputClass} value={d.start} onChange={(e) => set({ start: e.target.value })} />
              </Field>
              <Field label={hasRoom ? "Check-out" : word("end")}
                error={d.start && d.end && !periodOk ? "Must be after the start" : undefined}
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
              inCart={Object.fromEntries(d.lines.map((l) => [l.variation_id, l.qty]))} onAdd={addLine} />
          ) : null}

          <Panel title="Customer">
            <CustomerPicker selected={customer} onSelect={(c) => { setCustomer(c); set({ customerId: c?.id ?? null }); }}
              draft={d.customer} onDraft={(c) => set({ customer: c })} needsLicence={hasVehicle} />
          </Panel>
        </div>

        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Panel title="Booking">
            {d.lines.length === 0 && !d.wholeProperty ? (
              <p className="text-sm text-muted-foreground">Add {word("items").toLowerCase()} from the list.</p>
            ) : null}
            <ul className="space-y-3">
              {d.lines.map((l) => {
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
                      <button aria-label="One less" className="rounded border border-border p-1" onClick={() => updateLine(l.variation_id, { qty: l.qty - 1, unit_ids: [] })}>
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
                      <UnitChooser branchId={d.branchId} variationId={l.variation_id} startIso={startIso} endIso={endIso}
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
        </div>
      </div>
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
