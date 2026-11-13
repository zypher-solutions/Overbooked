"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { useCart, type CartLine } from "@/modules/clothing/cart";
import { call, loadRental, money, type RentalDetail } from "@/lib/shop/api";
import { useCatalog } from "@/lib/shop/useCatalog";
import { addDays, errorText, isoToZoned, num, rupees, todayLocal, zonedToIso } from "@/lib/shop/format";
import type { Customer, Method, Product, Quote, Template, Variation } from "@/lib/shop/types";
import { emptyCustomer, type NewCustomer } from "@/components/shop/CustomerPicker";
import { customerProblem } from "@/components/shop/CustomerForm";
import { moneyError, normalizeEmail, normalizePhone, textLimitError } from "@/lib/validate";
import { buildMessage, waLink } from "@/lib/shop/whatsapp";
import { logCartEvent } from "@/lib/shop/activity";
import { shopModules } from "@/modules/registry";

// The booking form's state and rules, shared by every kind of shop. The screens are in src/app/(shop)/book/page.tsx
// and, for a module with its own (clothing), in its folder.
export type Line = CartLine;
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

export type Piece = { unit_id: string; code: string };
type Availability = Record<string, { free: number; total: number }>;
const EMPTY_AVAILABILITY: Availability = {};

export interface BookedRental {
  rentalId: string;
  token: string;
  wa: string;
  customer: string;
  phone: string;
  start: string;
  end: string;
  total: number;
  paid: number;
}

/** everything the booking form knows and does; the shared form and a module's own form draw it */
export function useBookingForm(onBooked?: (booking: BookedRental) => void) {
  const router = useRouter();
  const params = useSearchParams();
  const { shop, tz, myBranchId, activeBranches, categories, templates, addOns, templateOf, feature, setting, branchSetting, word, businessModule } = useShop();
  // TRENDZ rules for clothes: dates first, each booked piece chosen, cleaning days, no pickup in the past, back to Bookings
  const byPiece = !!shopModules[businessModule].bookingByPiece;
  const { products } = useCatalog();
  const cart = useCart();
  const legacyKey = `ob_booking_${shop.id}`;
  const storageKey = byPiece ? cart.draftKey(cart.id) : legacyKey;
  // ?edit=<rental id>: change a booking that has not been picked up
  const editId = params.get("edit");
  const [editing, setEditing] = useState<RentalDetail | null>(null);

  const initial = (): Draft => {
    // the usual times of the branch the booking starts in (its own, else the shop's; migration 038)
    const b = myBranchId ?? activeBranches[0]?.id;
    const p = defaultPeriod(templates[0]?.kind, tz, branchSetting(b, "check_in_time", "14:00"), branchSetting(b, "check_out_time", "11:00"));
    return {
      branchId: myBranchId ?? activeBranches[0]?.id ?? "", start: p.start, end: p.end, lines: [], adults: 1, children: 0,
      withDriver: false, wholeProperty: false, cleaningDays: "", addOns: {}, customer: emptyCustomer, customerId: null, discount: "",
      depositAgreed: "", advance: "", advanceMethod: "", deposit: "", depositMethod: "", notes: "",
    };
  };
  const [d, setD] = useState<Draft>(initial);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [restored, setRestored] = useState(false);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const completed = useRef(false);

  // Checkout is keyed by cart id, so switching carts restores only that cart's fields.
  useEffect(() => {
    if (editId) return;
    let live = true;
    try {
      const saved = sessionStorage.getItem(storageKey) ??
        (byPiece && cart.id === 1 ? sessionStorage.getItem(legacyKey) : null);
      if (saved) {
        const draft = JSON.parse(saved) as Draft;
        const fresh = initial();
        const branchOk = activeBranches.some((b) => b.id === draft.branchId);
        setD({ ...fresh, ...draft, branchId: myBranchId ?? (branchOk ? draft.branchId : fresh.branchId) });
        if (draft.customerId && !params.get("customer")) {
          setLoadingCustomer(true);
          void createClient().from("customers").select("*").eq("id", draft.customerId).maybeSingle()
            .then(({ data, error }) => {
              if (!live) return;
              if (error) toast.error("Could not restore the selected customer. Choose them again.");
              setCustomer((data as Customer) ?? null);
              setLoadingCustomer(false);
            });
        }
      }
    } catch { /* storage unavailable or unreadable */ }
    setRestored(true);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (editId || !restored || loadingCustomer || completed.current) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ ...d, customerId: customer?.id ?? null, customerLabel: customer?.full_name }));
      if (byPiece && cart.id === 1) sessionStorage.removeItem(legacyKey);
    } catch { /* storage unavailable */ }
  }, [d, customer, storageKey, editId, restored, loadingCustomer, byPiece, cart.id, legacyKey]);

  // the activity log: who the cart is for, once the name stops changing (not every key pressed)
  const cartCustomer = customer?.full_name ?? d.customer.full_name.trim();
  useEffect(() => {
    if (!byPiece || editId || !restored || loadingCustomer || completed.current || !cartCustomer) return;
    const t = setTimeout(() => {
      try {
        const loggedKey = storageKey + "_logged_customer";
        const previous = sessionStorage.getItem(loggedKey) ?? "";
        if (previous === cartCustomer) return;
        sessionStorage.setItem(loggedKey, cartCustomer);
        logCartEvent({ kind: "customer_set", cart: cart.id, customer: cartCustomer, previous });
      } catch { /* storage unavailable */ }
    }, 2500);
    return () => clearTimeout(t);
  }, [cartCustomer, byPiece, editId, restored, loadingCustomer, storageKey, cart.id]);

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

  // A new booking's deposit starts as the products' deposits added up (one per piece), as in Rentopus. It follows the cart
  // while it still shows the last suggestion; once staff type their own amount it is left alone.
  const suggestedDeposit = useMemo(() => lines.reduce((s, l) =>
    s + l.qty * Number(variations.get(l.variation_id)?.product.security_deposit ?? 0), 0), [lines, variations]);
  const lastSuggested = useRef<string | null>(null);
  useEffect(() => {
    if (editId || products === null) return;
    const next = suggestedDeposit > 0 ? String(suggestedDeposit) : "";
    const prev = lastSuggested.current;
    lastSuggested.current = next;
    setD((x) => {
      const untouched = prev === null ? x.deposit === "" : x.deposit === prev;
      if (!untouched || x.deposit === next) return x;
      return { ...x, deposit: next, depositAgreed: next, depositMethod: next ? x.depositMethod : "" };
    });
  }, [suggestedDeposit, editId, products]);

  // ?variation=... from the catalog's "Book" button
  const prefill = params.get("variation");
  useEffect(() => {
    if (!editId && prefill && variations.has(prefill)) {
      if (!lines.some((l) => l.variation_id === prefill)) cart.add(branchId, prefill);
      const remaining = new URLSearchParams(params);
      remaining.delete("variation");
      router.replace(`${byPiece ? "/checkout" : "/book"}${remaining.size ? `?${remaining}` : ""}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, variations, router]);

  // ?customer=... from a customer's page
  const prefillCustomer = params.get("customer");
  useEffect(() => {
    if (!prefillCustomer || editId) return;
    let live = true;
    setLoadingCustomer(true);
    void createClient().from("customers").select("*").eq("id", prefillCustomer).maybeSingle().then(({ data, error }) => {
      if (!live) return;
      if (data) { setCustomer(data as Customer); setD((x) => ({ ...x, customerId: (data as Customer).id })); }
      if (error || !data) toast.error("Could not load the selected customer.");
      setLoadingCustomer(false);
      const remaining = new URLSearchParams(params);
      remaining.delete("customer");
      router.replace(`${byPiece ? "/checkout" : "/book"}${remaining.size ? `?${remaining}` : ""}`);
    });
    return () => { live = false; };
  }, [prefillCustomer, router, editId, byPiece, params]);

  const startIso = d.start ? zonedToIso(d.start, tz) : "";
  const endIso = d.end ? zonedToIso(d.end, tz) : "";
  const startInPast = byPiece && !editId && !!d.start && d.start.slice(0, 10) < todayLocal(tz);
  const periodOk = !!startIso && !!endIso && endIso > startIso && !startInPast;
  // bridal and groom: cleaning days are typed per booking (blank = none), like TRENDZ's maintenance buffer
  const cleaningBad = byPiece && d.cleaningDays.trim() !== "" && num(d.cleaningDays) < 0;
  const cleaning = byPiece ? Math.min(365, Math.max(0, Math.floor(num(d.cleaningDays)))) : undefined;

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

  // the first check of each kind goes out at once; only later changes (typing a date) wait a moment
  const firstCheck = useRef({ avail: true, pieces: true, quote: true });
  const wait = (k: "avail" | "pieces" | "quote", ms: number) => { const w = firstCheck.current[k] ? 0 : ms; firstCheck.current[k] = false; return w; };

  // ---- availability for the period ----
  const [checkVersion, setCheckVersion] = useState(0);
  const availabilityKey = JSON.stringify([branchId, startIso, endIso, cleaning, editing?.id, checkVersion]);
  const [availability, setAvailability] = useState<{ key: string; rows: Availability; error?: string } | null>(null);
  const currentAvailability = availability?.key === availabilityKey ? availability : null;
  const avail = currentAvailability?.rows ?? EMPTY_AVAILABILITY;
  useEffect(() => {
    if (!periodOk || !branchId) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const rows = await call<{ variation_id: string; free: number; total: number }[]>("branch_availability",
          { p_branch_id: branchId, p_start: startIso, p_end: endIso, ...(cleaning !== undefined ? { p_cleaning_days: cleaning } : {}) });
        // when changing a booking, the units it already holds count as free for it
        const own = new Map<string, number>();
        for (const u of editing?.unit_reservations ?? []) {
          if (u.state === "held" && u.units) own.set(u.units.variation_id, (own.get(u.units.variation_id) ?? 0) + 1);
        }
        if (live) setAvailability({ key: availabilityKey, rows: Object.fromEntries(rows.map((r) => [
          r.variation_id, { free: Math.min(r.total, r.free + (own.get(r.variation_id) ?? 0)), total: r.total },
        ])) });
      } catch (e) {
        if (!live) return;
        const error = errorText(e);
        setAvailability({ key: availabilityKey, rows: EMPTY_AVAILABILITY, error });
        if (!byPiece) toast.error(error);
      }
    }, wait("avail", 250));
    return () => { live = false; clearTimeout(t); };
  }, [availabilityKey, branchId, startIso, endIso, periodOk, editing, cleaning, byPiece]);

  // ---- exact pieces (bridal and groom): the free pieces of every item for these dates, each booked piece
  // is chosen, as in TRENDZ. A set is made of other items, so it only needs enough free sets.
  const pieceLines = useMemo(() => (byPiece ? lines.filter((l) => {
    const v = variations.get(l.variation_id);
    return v?.template?.kind === "wearable" && !v.product.is_set;
  }) : []), [byPiece, lines, variations]);
  const pieceKey = pieceLines.map((l) => l.variation_id).join(",");
  const pieceRequestKey = JSON.stringify([availabilityKey, pieceKey]);
  const [pieceResult, setPieceResult] = useState<{ key: string; rows: Record<string, Piece[]>; error?: string } | null>(null);
  const currentPieces = pieceResult?.key === pieceRequestKey ? pieceResult : null;
  const pieces = currentPieces?.rows ?? null;
  useEffect(() => {
    if (!byPiece || !periodOk || !branchId || !pieceKey) return;
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
        if (live) setPieceResult({ key: pieceRequestKey, rows: Object.fromEntries(entries) });
      } catch (e) {
        if (live) setPieceResult({ key: pieceRequestKey, rows: {}, error: errorText(e) });
      }
    }, wait("pieces", 250));
    return () => { live = false; clearTimeout(t); };
  }, [byPiece, periodOk, branchId, pieceKey, pieceRequestKey, startIso, endIso, cleaning, editing]);

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

  // Clothing checkout can continue once each cart line has stock for the selected dates.
  const shortItems = useMemo(() => lines.filter((l) => {
    const v = variations.get(l.variation_id);
    if (!byPiece || !v) return false;
    if (pieceLines.includes(l)) return pieces !== null && (pieces[l.variation_id]?.length ?? 0) < l.qty;
    return (avail[l.variation_id]?.free ?? 0) < l.qty;
  }), [byPiece, lines, variations, pieceLines, pieces, avail]);
  const needsBranchAvailability = pieceLines.length < lines.length;
  const checkingStock = byPiece && periodOk && !!branchId && lines.length > 0 && (
    !products || (pieceLines.length > 0 && !currentPieces) || (needsBranchAvailability && !currentAvailability)
  );
  const stockError = (pieceLines.length ? currentPieces?.error : undefined)
    ?? (needsBranchAvailability ? currentAvailability?.error : undefined);
  const pieceProblem = (): string | null => {
    for (const line of pieceLines) {
      const label = variations.get(line.variation_id)?.product.name ?? "this item";
      const free = pieces?.[line.variation_id] ?? [];
      for (let i = 0; i < line.qty; i++) {
        const id = line.unit_ids[i];
        if (!id) return `Choose a physical piece for ${label} (piece ${i + 1}).`;
        if (!free.some((piece) => piece.unit_id === id)) return `The piece chosen for ${label} (piece ${i + 1}) is no longer free. Choose another.`;
      }
    }
    return null;
  };

  // ---- live quote ----
  const { adults, children, withDriver, wholeProperty, addOns: draftAddOns } = d;
  const quoteInput = useMemo(() => ({
    branch_id: branchId, start_at: startIso, end_at: endIso, adults, children,
    with_driver: withDriver && hasVehicle, whole_property: wholeProperty,
    lines: lines.map((l) => ({
      variation_id: l.variation_id, qty: l.qty,
      ...(l.amount_override.trim() !== "" ? { amount_override: num(l.amount_override) } : {}),
      ...(l.unit_ids.length === l.qty ? { unit_ids: l.unit_ids } : {}),
    })),
    add_ons: Object.entries(draftAddOns).map(([add_on_id, quantity]) => ({ add_on_id, quantity })),
    ...(cleaning !== undefined ? { cleaning_days: cleaning } : {}),
  }), [branchId, startIso, endIso, adults, children, withDriver, hasVehicle, wholeProperty, lines, draftAddOns, cleaning]);
  const canQuote = periodOk && !!branchId && (lines.length > 0 || wholeProperty);
  const [quoteResult, setQuoteResult] = useState<{ input: typeof quoteInput; version: number; quote?: Quote; error?: string } | null>(null);
  const currentQuote = canQuote && quoteResult?.input === quoteInput && quoteResult.version === checkVersion ? quoteResult : null;
  const quote = currentQuote?.quote ?? null;
  const quoteError = currentQuote?.error ?? null;
  const quotePending = canQuote && !currentQuote;

  useEffect(() => {
    if (!canQuote) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const quote = await call<Quote>("quote_rental", { p: quoteInput });
        if (live) setQuoteResult({ input: quoteInput, version: checkVersion, quote });
      } catch (e) {
        if (live) setQuoteResult({ input: quoteInput, version: checkVersion, error: errorText(e) });
      }
    }, wait("quote", 350));
    return () => { live = false; clearTimeout(t); };
  }, [quoteInput, canQuote, checkVersion]);

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
  const [saving, setSaving] = useState(false);
  const busy = saving || (byPiece && !editId && cart.booking);
  const submitting = useRef(false);
  // changing a booking can also take money (the balance is the new total less what was paid)
  const [editPay, setEditPay] = useState<{ amount: string; method: Method | "" }>({ amount: "", method: "" });
  const total = Math.max(0, (quote?.total_before_discount ?? 0) - num(d.discount));

  // what is wrong with the money fields; shown under a field once something is typed in it, and for all of them after a try to confirm
  const [tried, setTried] = useState(false);
  const money_ = {
    discount: moneyError(d.discount, { label: "discount", max: quote?.total_before_discount, maxText: `the rental total (${rupees(quote?.total_before_discount)})` }),
    advance: moneyError(d.advance, {
      label: byPiece ? "advance paid" : "advance",
      required: byPiece && !editId,
      max: quote ? total : undefined,
      maxText: `the total (${rupees(total)})`,
    }),
    deposit: moneyError(byPiece && editing ? d.depositAgreed : d.deposit, { label: "deposit", max: 1_000_000 }),
    advanceMethod: num(d.advance) > 0 && !d.advanceMethod ? "Choose how the advance was paid." : null,
    depositMethod: num(d.deposit) > 0 && !d.depositMethod ? "Choose how the deposit was paid." : null,
    notes: textLimitError(d.notes, "notes", 500),
    // a price agreed with the customer for one line, typed over the catalogue price
    agreedPrice: lines.map((l) => moneyError(l.amount_override, { label: "agreed price", max: 10_000_000 })).find(Boolean) ?? null,
    editPay: editing ? moneyError(editPay.amount, { label: "payment", positive: true, max: quote ? Math.max(0, total - money(editing).paid) : undefined, maxText: `the balance after this change (${rupees(Math.max(0, total - money(editing).paid))})` }) : null,
    editPayMethod: editing && num(editPay.amount) > 0 && !editPay.method ? "Choose how the payment was made." : null,
  };
  const shown = (k: keyof typeof money_, typed: string) => (tried || typed.trim() ? money_[k] ?? undefined : undefined);

  const submit = async () => {
    if (submitting.current || completed.current || loadingCustomer) return;
    setTried(true);
    const moneyBad = Object.values(money_).find(Boolean);
    if (moneyBad) return toast.error(moneyBad);
    if (!periodOk) return toast.error(`The ${word("end").toLowerCase()} must be after the ${word("start").toLowerCase()}.`);
    if (!quote) return toast.error(quoteError ?? "Add at least one item.");
    if (cleaningBad) return toast.error("Cleaning days cannot be negative.");
    const invalidPiece = pieceProblem();
    if (invalidPiece) return toast.error(invalidPiece);
    if (!customer) { const bad = customerProblem(d.customer); if (bad) return toast.error(bad); }
    if (num(d.advance) > 0 && !d.advanceMethod) return toast.error("Choose how the advance was paid.");
    if (num(d.deposit) > 0 && !d.depositMethod) return toast.error("Choose how the deposit was paid.");
    const releaseCart = !editId && byPiece ? cart.beginBooking(cart.id) : undefined;
    if (!editId && byPiece && !releaseCart) return;
    submitting.current = true;
    setSaving(true);
    try {
      if (editing) {
        const { branch_id: _branch, ...change } = quoteInput;
        void _branch;
        await call("update_rental", {
          p_rental_id: editing.id,
          p: { ...change, discount: num(d.discount), deposit_agreed: num(d.depositAgreed), notes: d.notes },
        });
        if (num(editPay.amount) > 0) {
          await call("record_rental_payment", { p_rental_id: editing.id, p_kind: "payment", p_amount: num(editPay.amount), p_method: editPay.method, p_note: null });
        }
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
      // the same person is not saved twice: a saved customer with this phone and name is used as it is
      let reuseId: string | null = null;
      if (!customer) {
        const { data: same } = await supabase.from("customers").select("id, full_name").eq("phone", normalizePhone(d.customer.phone)).limit(5);
        const wanted = d.customer.full_name.trim().replace(/\s+/g, " ").toLowerCase();
        reuseId = (same ?? []).find((c) => c.full_name.trim().replace(/\s+/g, " ").toLowerCase() === wanted)?.id ?? null;
      }
      const res = await call<{ rental_id: string; token: string }>("create_rental", {
        p: {
          ...quoteInput,
          customer: customer ? { id: customer.id } : reuseId ? { id: reuseId } : {
            ...Object.fromEntries(Object.entries(d.customer).map(([k, v]) => [k, v.trim()])),
            full_name: d.customer.full_name.trim().replace(/\s+/g, " "), phone: normalizePhone(d.customer.phone), email: normalizeEmail(d.customer.email),
          },
          discount: num(d.discount),
          deposit_agreed: num(d.depositAgreed),
          notes: d.notes,
          advance: num(d.advance) > 0 ? { amount: num(d.advance), method: d.advanceMethod } : null,
          deposit: num(d.deposit) > 0 ? { amount: num(d.deposit), method: d.depositMethod } : null,
        },
      });
      completed.current = true;
      try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(storageKey + "_logged_customer"); } catch { /* storage unavailable */ }
      if (byPiece) {
        // bridal and groom: back to the Bookings list; the message to the customer is one tap on the notice
        const rental = await loadRental(res.rental_id).catch(() => null);
        const br = rental ? activeBranches.find((x) => x.id === rental.branch_id) : undefined;
        const wa = rental ? waLink(rental.customers.phone, buildMessage("confirmation", rental, {
          shopName: shop.name, branchName: br?.name, branchPhone: br?.phone ?? shop.phone, tz, startWord: word("start"), endWord: word("end"),
        })) : "";
        // a pop-up says it is done; closing it opens the Bookings list
        const confirmation: BookedRental = {
          rentalId: res.rental_id, token: res.token, wa,
          customer: rental?.customers.full_name ?? customer?.full_name ?? d.customer.full_name.trim(),
          phone: rental?.customers.phone ?? customer?.phone ?? d.customer.phone,
          start: rental?.start_at ?? startIso, end: rental?.end_at ?? endIso,
          total: rental ? Number(rental.total) : total, paid: rental ? Number(rental.paid) : num(d.advance),
        };
        cart.remove(cart.id);
        if (onBooked) onBooked(confirmation);
        else router.push("/bookings");
        return;
      }
      cart.remove(cart.id);
      toast.success(`Booked: ${res.token}`);
      router.push(`/rentals/${res.rental_id}?new=1`);
    } catch (e) {
      toast.error(errorText(e));
      if (byPiece && !completed.current) setCheckVersion((version) => version + 1);
    } finally {
      submitting.current = false;
      releaseCart?.();
      setSaving(false);
    }
  };

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const reset = () => {
    if (byPiece && (cart.count > 0 || cartCustomer))
      logCartEvent({ kind: "cart_discarded", cart: cart.id, customer: cartCustomer || undefined, items: cart.count });
    try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(storageKey + "_logged_customer"); } catch { /* ignore */ }
    cart.remove(cart.id);
    setCustomer(null);
    setD(initial());
    setConfirmDiscard(false);
  };

  // an accessory linked to categories is offered only when the cart holds one of them (left unticked: the customer may not want it)
  const cartCategories = new Set(lines.map((l) => variations.get(l.variation_id)?.product.category_id));
  const visibleAddOns = addOns.filter((a) => a.is_active
    && (a.template_keys.length === 0 || a.template_keys.some((k) => cartTemplates.some((t) => t.key === k)))
    && (!a.category_ids?.length || a.category_ids.some((c) => cartCategories.has(c)) || d.addOns[a.id] !== undefined));
  const quoteLineFor = (variationId: string) => quote?.lines.find((l) => l.variation_id === variationId && l.reserve);

  return {
    router, shop, tz, myBranchId, activeBranches, categories, addOns, templateOf, feature, word, businessModule, products, editId, editing, d, customer, setCustomer, set, cart, lines, branchId, setBranch, variations, startIso, endIso, startInPast, periodOk, cleaningBad, cleaning, kinds, hasRoom, hasVehicle, roomShop, avail, pieceLines, pieces, shortItems, checkingStock, quote, quoteError, addLine, updateLine, busy, editPay, setEditPay, total, shown, submit, confirmDiscard, setConfirmDiscard, reset, visibleAddOns, quoteLineFor, loadingCustomer,
    stockError, quotePending, pieceProblem, moneyErrors: money_, suggestedDeposit, showErrors: () => setTried(true),
  };
}
export type BookingForm = ReturnType<typeof useBookingForm>;
