"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Minus, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { useCart, type CartLine } from "@/modules/clothing/cart";
import { call, loadRental, money, type RentalDetail } from "@/lib/shop/api";
import { headlinePrice, useCatalog, variationLabel } from "@/lib/shop/useCatalog";
import {
  BASIS_LABELS, METHOD_LABELS, addDays, errorText, fmtDate, isoToZoned, lineMath, num, plural, rupees, todayLocal, zonedToIso,
} from "@/lib/shop/format";
import type { Customer, Method, Product, Quote, Template, Variation } from "@/lib/shop/types";
import { CustomerPicker, emptyCustomer, type NewCustomer } from "@/components/shop/CustomerPicker";
import { DateInput, isoToDisplay } from "@/components/shop/DateInput";
import {
  Field, MethodPicker, Modal, MoneyRows, PageHeader, Panel, StatusBadge, dangerButtonClass, ghostButtonClass, goldButtonClass, inputClass, monoInputClass,
} from "@/components/shop/ui";

type Line = CartLine;
interface Draft {
  branchId: string;
  start: string;
  end: string;
  lines: Line[];
  adults: number;
  children: number;
  withDriver: boolean;
  wholeProperty: boolean;
  cleaningDays: string; // bridal and groom: days the pieces are kept back for cleaning after the return
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
  // clothes: pickup today at the usual hour; the return date is chosen first, so availability is checked for real dates
  if (kind === "wearable") return { start: `${today}T10:00`, end: "" };
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
  const { shop, tz, myBranchId, activeBranches, categories, templates, addOns, templateOf, feature, setting, word, trendz } = useShop();
  const { products } = useCatalog();
  const storageKey = `ob_booking_${shop.id}`;
  // ?edit=<rental id>: change a booking that has not been picked up
  const editId = params.get("edit");
  const [editing, setEditing] = useState<RentalDetail | null>(null);

  const initial = (): Draft => {
    const p = defaultPeriod(templates[0]?.kind, tz, setting("check_in_time", "14:00"), setting("check_out_time", "11:00"));
    return {
      branchId: myBranchId ?? activeBranches[0]?.id ?? "", start: p.start, end: p.end, lines: [], adults: 1, children: 0,
      withDriver: false, wholeProperty: false, cleaningDays: "", addOns: {}, customer: emptyCustomer, customerId: null, discount: "",
      depositAgreed: "", advance: "", advanceMethod: "", deposit: "", depositMethod: "", notes: "",
    };
  };
  const [d, setD] = useState<Draft>(initial);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const restored = useRef(false);

  // keep a half-filled booking if the page is left by accident (this tab only)
  useEffect(() => {
    if (restored.current || editId) return;
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
    if (editId) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ ...d, customerId: customer?.id ?? null })); } catch { /* ignore */ }
  }, [d, customer, storageKey, editId]);

  // the booking being changed, as a draft of this form
  useEffect(() => {
    if (!editId) return;
    void loadRental(editId).then((r) => {
      if (!r || r.status !== "reserved") {
        toast.error(r ? "Only a booking that has not been picked up can be changed." : "Booking not found.");
        router.replace(r ? `/rentals/${r.id}` : "/rentals");
        return;
      }
      const days = Math.max(1, Math.ceil((Date.parse(r.end_at) - Date.parse(r.start_at)) / 86_400_000));
      setEditing(r);
      setCustomer(r.customers);
      setD({
        ...initial(), branchId: r.branch_id, start: isoToZoned(r.start_at, tz), end: isoToZoned(r.end_at, tz),
        lines: r.rental_lines.filter((l) => l.rate_type !== "driver_day" && l.rate_type !== "extra_person").map((l) => ({
          variation_id: l.variation_id, qty: l.qty, amount_override: l.is_override ? String(l.amount) : "", unit_ids: [],
        })),
        adults: r.adults, children: r.children, withDriver: r.with_driver, wholeProperty: r.whole_property,
        cleaningDays: r.cleaning_days ? String(r.cleaning_days) : "",
        // the form asks "how many" for once-off and per-day extras; the booking stores the worked-out quantity
        addOns: Object.fromEntries(r.rental_add_ons.map((a) => [a.add_on_id,
          a.basis === "per_rental" ? Number(a.quantity) : a.basis === "per_day" ? Math.max(1, Math.round(Number(a.quantity) / days)) : 1])),
        customerId: r.customer_id, discount: Number(r.discount) ? String(r.discount) : "",
        depositAgreed: Number(r.deposit_agreed) ? String(r.deposit_agreed) : "", notes: r.notes ?? "",
      });
    }).catch((e) => toast.error(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  // A new booking takes its items and branch from the cart (filled from Inventory Search, All Rentals or
  // the list below); changing a booking works on its own copy.
  const cart = useCart();
  const lines = editId ? d.lines : cart.lines;
  const branchId = editId ? d.branchId : (myBranchId ?? (cart.lines.length && cart.branchId ? cart.branchId : d.branchId));
  const setLines = (fn: (ls: Line[]) => Line[]) => {
    if (editId) setD((x) => ({ ...x, lines: fn(x.lines).filter((l) => l.qty > 0) }));
    else cart.setLines(fn);
  };
  const setBranch = (id: string) => {
    set({ branchId: id, lines: d.lines.map((l) => ({ ...l, unit_ids: [] })) });
    if (!editId) cart.setBranch(id);
  };

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
      if (!lines.some((l) => l.variation_id === prefill)) cart.add(branchId, prefill);
      router.replace("/book");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const startInPast = trendz && !editId && !!d.start && d.start.slice(0, 10) < todayLocal(tz);
  const periodOk = !!startIso && !!endIso && endIso > startIso && !startInPast;
  // bridal and groom: cleaning days are typed per booking (blank = none), like TRENDZ's maintenance buffer
  const cleaningBad = trendz && d.cleaningDays.trim() !== "" && num(d.cleaningDays) < 0;
  const cleaning = trendz ? Math.min(365, Math.max(0, Math.floor(num(d.cleaningDays)))) : undefined;

  const cartTemplates = useMemo(() => {
    const keys = new Set<string>();
    for (const l of lines) { const t = variations.get(l.variation_id)?.template; if (t) keys.add(t.key); }
    if (d.wholeProperty) templates.filter((t) => t.kind === "room").forEach((t) => keys.add(t.key));
    return templates.filter((t) => keys.has(t.key));
  }, [lines, d.wholeProperty, variations, templates]);
  const kinds = new Set(cartTemplates.map((t) => t.kind));
  const hasRoom = kinds.has("room");
  const hasVehicle = kinds.has("vehicle");
  const roomShop = templates.some((t) => t.kind === "room");

  // ---- availability for the period ----
  const [avail, setAvail] = useState<Record<string, { free: number; total: number }>>({});
  useEffect(() => {
    if (!periodOk || !branchId) return;
    const t = setTimeout(async () => {
      try {
        const rows = await call<{ variation_id: string; free: number; total: number }[]>("branch_availability",
          { p_branch_id: branchId, p_start: startIso, p_end: endIso, ...(cleaning !== undefined ? { p_cleaning_days: cleaning } : {}) });
        // when changing a booking, the units it already holds count as free for it
        const own = new Map<string, number>();
        for (const u of editing?.unit_reservations ?? []) {
          if (u.state === "held" && u.units) own.set(u.units.variation_id, (own.get(u.units.variation_id) ?? 0) + 1);
        }
        setAvail(Object.fromEntries(rows.map((r) => [r.variation_id, { free: Math.min(r.total, r.free + (own.get(r.variation_id) ?? 0)), total: r.total }])));
      } catch (e) {
        toast.error(errorText(e));
      }
    }, 250);
    return () => clearTimeout(t);
  }, [branchId, startIso, endIso, periodOk, editing, cleaning]);

  // ---- exact pieces (bridal and groom): the free pieces of every item for these dates, each booked piece
  // is chosen, as in TRENDZ. A set is made of other items, so it only needs enough free sets.
  type Piece = { unit_id: string; code: string };
  const pieceLines = useMemo(() => (trendz ? lines.filter((l) => {
    const v = variations.get(l.variation_id);
    return v?.template?.kind === "wearable" && !v.product.is_set;
  }) : []), [trendz, lines, variations]);
  const pieceKey = pieceLines.map((l) => l.variation_id).join(",");
  const [pieces, setPieces] = useState<Record<string, Piece[]> | null>(null); // null: not checked for these dates yet
  useEffect(() => {
    setPieces(null);
    if (!trendz || !periodOk || !branchId || !pieceKey) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const entries = await Promise.all(pieceKey.split(",").map(async (vid) => {
          const rows = await call<Piece[]>("find_available_units",
            { p_branch_id: branchId, p_variation_id: vid, p_start: startIso, p_end: endIso, p_cleaning_days: cleaning });
          // when changing a booking, the pieces it already holds are free for it
          const own = (editing?.unit_reservations ?? [])
            .filter((u) => u.state === "held" && u.units?.variation_id === vid && !rows.some((r) => r.unit_id === u.unit_id))
            .map((u) => ({ unit_id: u.unit_id, code: u.units!.code }));
          return [vid, [...own, ...rows].sort((a, b) => a.code.localeCompare(b.code))] as const;
        }));
        if (live) setPieces(Object.fromEntries(entries));
      } catch (e) {
        if (live) { setPieces({}); toast.error(errorText(e)); }
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [trendz, periodOk, branchId, pieceKey, startIso, endIso, cleaning, editing]);

  // every booked piece starts on the first free one; staff can change it (a piece that is no longer free is replaced)
  const lineSig = lines.map((l) => `${l.variation_id}:${l.qty}`).join(",");
  useEffect(() => {
    if (!pieces) return;
    setLines((ls) => ls.map((l) => {
      const list = pieces[l.variation_id];
      if (!list) return l;
      const keep = l.unit_ids.filter((id, i) => list.some((p) => p.unit_id === id) && l.unit_ids.indexOf(id) === i).slice(0, l.qty);
      const fill = list.filter((p) => !keep.includes(p.unit_id)).slice(0, l.qty - keep.length).map((p) => p.unit_id);
      const ids = [...keep, ...fill];
      return ids.length === l.unit_ids.length && ids.every((id, i) => id === l.unit_ids[i]) ? l : { ...l, unit_ids: ids };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces, lineSig]);

  // customer and payment open only when every item is free for the dates (TRENDZ: "unlocked when products are available")
  const shortItems = useMemo(() => lines.filter((l) => {
    const v = variations.get(l.variation_id);
    if (!trendz || !v) return false;
    if (pieceLines.includes(l)) return pieces !== null && (pieces[l.variation_id]?.length ?? 0) < l.qty;
    return (avail[l.variation_id]?.free ?? 0) < l.qty;
  }), [trendz, lines, variations, pieceLines, pieces, avail]);
  const checkingStock = trendz && periodOk && lines.length > 0 && pieceLines.length > 0 && pieces === null;
  const detailsOpen = !trendz || !!editing || (periodOk && lines.length > 0 && !checkingStock && shortItems.length === 0);

  // ---- live quote ----
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quoteInput = useMemo(() => ({
    branch_id: branchId, start_at: startIso, end_at: endIso, adults: d.adults, children: d.children,
    with_driver: d.withDriver && hasVehicle, whole_property: d.wholeProperty,
    lines: lines.map((l) => ({
      variation_id: l.variation_id, qty: l.qty,
      ...(l.amount_override.trim() !== "" ? { amount_override: num(l.amount_override) } : {}),
      ...(l.unit_ids.length === l.qty ? { unit_ids: l.unit_ids } : {}),
    })),
    add_ons: Object.entries(d.addOns).map(([add_on_id, quantity]) => ({ add_on_id, quantity })),
    ...(cleaning !== undefined ? { cleaning_days: cleaning } : {}),
  }), [d, branchId, lines, startIso, endIso, hasVehicle, cleaning]);

  useEffect(() => {
    if (!periodOk || !branchId || (lines.length === 0 && !d.wholeProperty)) {
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
  }, [quoteInput, periodOk, branchId, lines.length, d.wholeProperty]);

  // ---- cart ----
  const addLine = (variationId: string) => {
    if (!editId) return cart.add(branchId, variationId);
    setD((x) => {
      const existing = x.lines.find((l) => l.variation_id === variationId);
      if (existing) return { ...x, lines: x.lines.map((l) => l === existing ? { ...l, qty: l.qty + 1, unit_ids: [] } : l) };
      return { ...x, lines: [...x.lines, { variation_id: variationId, qty: 1, amount_override: "", unit_ids: [] }] };
    });
  };
  const updateLine = (variationId: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => l.variation_id === variationId ? { ...l, ...patch } : l));

  // ---- submit ----
  const [busy, setBusy] = useState(false);
  const total = Math.max(0, (quote?.total_before_discount ?? 0) - num(d.discount));

  const submit = async () => {
    if (!periodOk) return toast.error(`The ${word("end").toLowerCase()} must be after the ${word("start").toLowerCase()}.`);
    if (!quote) return toast.error(quoteError ?? "Add at least one item.");
    if (cleaningBad) return toast.error("Cleaning days cannot be negative.");
    for (const l of pieceLines) {
      const label = variations.get(l.variation_id)?.product.name ?? "this item";
      const free = pieces?.[l.variation_id] ?? [];
      for (let i = 0; i < l.qty; i++) {
        const id = l.unit_ids[i];
        if (!id) return toast.error(`Please choose a piece for ${label} (piece ${i + 1}).`);
        if (!free.some((p) => p.unit_id === id)) return toast.error(`The piece chosen for ${label} (piece ${i + 1}) is no longer free. Choose another.`);
      }
    }
    if (!customer && (!d.customer.full_name.trim() || !d.customer.phone.trim())) return toast.error("Enter the customer's name and phone.");
    if (num(d.advance) > 0 && !d.advanceMethod) return toast.error("Choose how the advance was paid.");
    if (num(d.deposit) > 0 && !d.depositMethod) return toast.error("Choose how the deposit was paid.");
    setBusy(true);
    try {
      if (editing) {
        const { branch_id: _branch, ...change } = quoteInput;
        void _branch;
        await call("update_rental", {
          p_rental_id: editing.id,
          p: { ...change, discount: num(d.discount), deposit_agreed: num(d.depositAgreed), notes: d.notes },
        });
        toast.success(`${editing.token} changed`);
        router.push(`/rentals/${editing.id}`);
        return;
      }
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
      cart.clear();
      toast.success(`Booked: ${res.token}`);
      router.push(`/rentals/${res.rental_id}?new=1`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const reset = () => {
    try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
    cart.clear();
    setCustomer(null);
    setD(initial());
    setConfirmDiscard(false);
  };

  const visibleAddOns = addOns.filter((a) => a.is_active
    && (a.template_keys.length === 0 || a.template_keys.some((k) => cartTemplates.some((t) => t.key === k))));
  const quoteLineFor = (variationId: string) => quote?.lines.find((l) => l.variation_id === variationId && l.reserve);

  // ---- bridal and groom: the TRENDZ "Create Booking" pop-up (one column, dates first) ----
  if (trendz) {
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
        <div className="my-auto w-full max-w-2xl rounded-xl border border-border bg-surface p-4 shadow-xl sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-semibold text-foreground">{editing ? `Change booking ${editing.token}` : "Create Booking"}</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {editing ? "Change dates, items or extras. The pieces it already has are kept where possible." : "Select rental dates first to check product availability."}
              </p>
            </div>
            <button type="button" aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-black/5" onClick={closeForm}><X className="h-5 w-5" /></button>
          </div>
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
              <div className="rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">The cart is empty. Add items below.</div>
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
                  <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-3 text-xs">
                    <span className="text-muted-foreground">Agreed price for this line (₹)</span>
                    <input className={cn(monoInputClass, "ml-auto w-28 py-1 text-xs")} inputMode="decimal" placeholder="Optional" aria-label="Agreed price for this line"
                      value={l.amount_override} onChange={(e) => updateLine(l.variation_id, { amount_override: e.target.value })} />
                  </div>
                  {pieceLines.includes(l) && periodOk ? (
                    <div className="mt-3 space-y-2.5 border-t border-border/40 pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-gold">Assign Physical Piece(s) (Mandatory)</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{list ? `${list.length} Available for dates` : ""}</span>
                      </div>
                      {!list ? <p className="animate-pulse text-xs text-muted-foreground">Loading pieces...</p>
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

            <details open={lines.length === 0} className="rounded-xl border border-dashed border-border">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Add more items</summary>
              <div className="p-2">
                <ItemPicker products={products} categories={categories} templateOf={templateOf} avail={avail} periodOk={periodOk}
                  inCart={Object.fromEntries(lines.map((l) => [l.variation_id, l.qty]))} onAdd={addLine} />
              </div>
            </details>
          </section>

          {/* 2. customer and payment: open once every item is free */}
          {!detailsOpen ? (
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
                  <Field label="Advance Paid (₹)" hint="Amount collected upfront from customer">
                    <input className={monoInputClass} inputMode="decimal" value={d.advance} onChange={(e) => set({ advance: e.target.value })} />
                  </Field>
                  <Field label="Advance Payment Method">{methodSelect(d.advanceMethod, (m) => set({ advanceMethod: m }), "Advance payment method")}</Field>
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Discount (₹)" hint="Negotiated reduction on the rental charge">
                  <input className={monoInputClass} inputMode="decimal" value={d.discount} onChange={(e) => set({ discount: e.target.value })} />
                </Field>
                <Field label="Security Deposit agreed (₹)" hint="Tracked separately from rental charge">
                  <input className={monoInputClass} inputMode="decimal" value={d.depositAgreed} onChange={(e) => set({ depositAgreed: e.target.value })} />
                </Field>
                {!editing ? (
                  <>
                    <Field label="Deposit received now (₹)" hint={num(d.depositAgreed) ? `Agreed ${rupees(num(d.depositAgreed))}; the rest can be taken at pickup` : undefined}>
                      <input className={monoInputClass} inputMode="decimal" value={d.deposit} onChange={(e) => set({ deposit: e.target.value })} />
                    </Field>
                    <Field label="Deposit Payment Method">{methodSelect(d.depositMethod, (m) => set({ depositMethod: m }), "Deposit payment method")}</Field>
                  </>
                ) : null}
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gold">Payment Summary</p>
                <div className="space-y-2 font-mono text-sm">
                  <div className="flex items-center justify-between"><span className="font-sans text-muted-foreground">Rental Total{num(d.discount) > 0 ? ` (after ${rupees(num(d.discount))} discount)` : ""}</span><strong>{rupees(total)}</strong></div>
                  {editing ? (
                    <>
                      <div className="flex items-center justify-between"><span className="font-sans text-muted-foreground">Paid so far</span><strong className="text-emerald">{rupees(money(editing).paid)}</strong></div>
                      <div className="flex items-center justify-between border-t border-border/40 pt-3"><span className="font-sans font-semibold">Balance after this</span><strong className="text-base text-gold">{rupees(Math.max(0, total - money(editing).paid))}</strong></div>
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

              <Field label="Notes"><textarea rows={2} className={inputClass} placeholder="Anything staff should remember…" value={d.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>

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

  return (
    <>
      <PageHeader title={editing ? `Change booking ${editing.token}` : trendz ? "Create Booking" : "New booking"}
        subtitle={editing ? "Change dates, items, guests or extras. The pieces it already has are kept where possible."
          : trendz ? "Pick the dates first: each item is checked for them and a free piece is kept for it." : undefined}
        actions={editing
          ? <button className={ghostButtonClass} onClick={() => router.push(`/rentals/${editing.id}`)}>Cancel</button>
          : <>
            {trendz ? <button className={ghostButtonClass} onClick={() => router.push("/scan")}>Close (keep draft)</button> : null}
            <button className={trendz ? dangerButtonClass : ghostButtonClass} onClick={() => (trendz ? setConfirmDiscard(true) : reset())}>
              {trendz ? "Discard draft" : "Start over"}
            </button>
          </>} />
      <Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="Discard this draft?"
        description="All cart items and the customer details typed in are cleared."
        footer={<>
          <button className={ghostButtonClass} onClick={() => setConfirmDiscard(false)}>Keep it</button>
          <button className={goldButtonClass} onClick={reset}>Discard</button>
        </>}>
        <span />
      </Modal>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Panel title="When">
            <div className={cn("grid gap-3", trendz ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
              {activeBranches.length > 1 ? (
                <Field label="Branch">
                  <select className={inputClass} value={branchId} disabled={!!myBranchId || !!editing}
                    onChange={(e) => setBranch(e.target.value)}>
                    {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
              ) : null}
              <Field label={hasRoom ? "Check-in" : word("start")}
                error={startInPast ? `The ${word("start").toLowerCase()} cannot be in the past` : undefined}>
                <input type="datetime-local" className={inputClass} value={d.start} onChange={(e) => set({ start: e.target.value })} />
              </Field>
              <Field label={hasRoom ? "Check-out" : word("end")}
                error={d.start && d.end && endIso <= startIso ? "Must be after the start" : undefined}
                hint={quote ? periodText(quote, kinds) : undefined}>
                <input type="datetime-local" className={inputClass} value={d.end} onChange={(e) => set({ end: e.target.value })} />
              </Field>
              {trendz ? (
                <Field label="Cleaning days" hint="Days the piece is kept back for cleaning after the return"
                  error={cleaningBad ? "Cannot be negative" : undefined}>
                  <input type="number" min={0} className={monoInputClass} inputMode="numeric" value={d.cleaningDays}
                    onChange={(e) => set({ cleaningDays: e.target.value })} />
                </Field>
              ) : null}
            </div>
            {trendz && periodOk ? (
              <p className="mt-3 border-t border-border/40 pt-3 font-mono text-xs text-muted-foreground">
                Cleaning: <strong className="text-foreground">{plural(cleaning ?? 0, "day")}</strong>
                {" · "}Free again: <strong className="text-emerald">{fmtDate(addDays(d.end.slice(0, 10), (cleaning ?? 0) + 1))}</strong>
              </p>
            ) : null}
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

          {!detailsOpen ? (
            <div className="glass rounded-xl border border-dashed border-border/80 p-6 text-center">
              <h2 className="text-sm font-semibold">Customer and payment</h2>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                {!periodOk
                  ? "Select the pickup and return dates above to check availability before entering customer details."
                  : lines.length === 0 ? "Add the items from the list above first."
                  : checkingStock ? "Checking stock across the pieces..."
                  : "Some cart items are unavailable for the selected dates. Change the dates or the cart items to unlock customer details."}
              </p>
              {periodOk && shortItems.length > 0 ? (
                <ul className="mx-auto mt-3 max-w-md space-y-0.5 text-left text-xs font-medium text-rust">
                  {shortItems.map((l) => {
                    const v = variations.get(l.variation_id);
                    const free = pieceLines.includes(l) ? pieces?.[l.variation_id]?.length ?? 0 : avail[l.variation_id]?.free ?? 0;
                    return <li key={l.variation_id}>{v ? variationLabel(v.product, v.variation) : "Item"}: needed {l.qty}, free {free}</li>;
                  })}
                </ul>
              ) : null}
            </div>
          ) : (
          <Panel title="Customer">
            {editing ? (
              <p className="text-sm"><span className="font-medium">{editing.customers.full_name}</span> · {editing.customers.phone}</p>
            ) : (
              <CustomerPicker selected={customer} onSelect={(c) => { setCustomer(c); set({ customerId: c?.id ?? null }); }}
                draft={d.customer} onDraft={(c) => set({ customer: c })} needsLicence={hasVehicle} />
            )}
          </Panel>
          )}
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
                      <button aria-label="One more" className="rounded border border-border p-1" onClick={() => updateLine(l.variation_id, { qty: l.qty + 1, unit_ids: trendz ? l.unit_ids : [] })}>
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
                    {pieceLines.includes(l) && pieces?.[l.variation_id] ? (
                      <div className="mt-2 space-y-1.5">
                        {Array.from({ length: l.qty }, (_, i) => {
                          const val = l.unit_ids[i] ?? "";
                          return (
                            <label key={i} className="flex items-center gap-2 text-xs">
                              <span className="w-14 shrink-0 text-muted-foreground">Piece {i + 1}</span>
                              <select className={cn(inputClass, "py-1 text-xs")} value={val}
                                aria-label={`Piece ${i + 1} of ${info ? variationLabel(info.product, info.variation) : "item"}`}
                                onChange={(e) => {
                                  const ids = Array.from({ length: l.qty }, (_, k) => l.unit_ids[k] ?? "");
                                  ids[i] = e.target.value;
                                  updateLine(l.variation_id, { unit_ids: ids.filter(Boolean) });
                                }}>
                                <option value="" disabled>Choose a piece</option>
                                {pieces[l.variation_id].map((p) => {
                                  const elsewhere = l.unit_ids.includes(p.unit_id) && val !== p.unit_id;
                                  return <option key={p.unit_id} value={p.unit_id} disabled={elsewhere}>{p.code}{elsewhere ? " (chosen for another piece)" : ""}</option>;
                                })}
                              </select>
                            </label>
                          );
                        })}
                      </div>
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
          ) : !detailsOpen ? (
            <Panel title="Paid now">
              <p className="text-sm text-muted-foreground">Payment opens once the dates are set and every item is free.</p>
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
