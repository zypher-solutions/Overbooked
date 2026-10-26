"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, ScanLine, Search, ShoppingBag, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { useCart } from "@/lib/shop/cart";
import { RENTAL_LIST_COLUMNS } from "@/lib/shop/api";
import { errorText, fmtDateTime } from "@/lib/shop/format";
import { useCatalog, variationLabel } from "@/lib/shop/useCatalog";
import type { Product, Unit } from "@/lib/shop/types";
import { CameraScanner } from "@/components/overbooked/CameraScanner";
import { StockCard, useStock } from "@/components/shop/StockCard";
import type { ListRental } from "@/components/shop/RentalList";
import { Empty, PageHeader, Panel, StatusBadge, ghostButtonClass, goldButtonClass, inputClass } from "@/components/shop/ui";

// Inventory Search, as in TRENDZ: scan a tag (camera or USB scanner) or type a name, SKU, piece code or
// booking number. "Find and book" shows stock per branch with Add to Cart; "Receive back" takes a scanned
// piece straight to its return.
type Mode = "book" | "receive";
type UnitHit = Unit & { reservation: { rental_id: string; state: "held" | "out"; token: string } | null };

export default function InventorySearch() {
  const router = useRouter();
  const { tz, branches, myBranchId } = useShop();
  const cart = useCart();
  const { products } = useCatalog();
  const { stock, reload: reloadStock } = useStock();
  const [mode, setMode] = useState<Mode>("book");
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [product, setProduct] = useState<{ p: Product; variationId?: string } | null>(null);
  const [unit, setUnit] = useState<UnitHit | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [active, setActive] = useState<ListRental[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => (products ?? []).flatMap((p) => (p.product_variations ?? []).filter((v) => v.is_enabled).map((v) => ({ p, v }))), [products]);

  // live suggestions while typing (top 8), exact SKU first
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const hits = all.filter(({ p, v }) => `${p.name} ${p.sku} ${v.name} ${v.sku}`.toLowerCase().includes(q));
    hits.sort((a, b) => Number(b.v.sku.toLowerCase() === q || b.p.sku.toLowerCase() === q) - Number(a.v.sku.toLowerCase() === q || a.p.sku.toLowerCase() === q));
    return hits.slice(0, 8);
  }, [query, all]);

  // rentals out now with this product, each with Return
  useEffect(() => {
    if (!product) { setActive(null); return; }
    void (async () => {
      const supabase = createClient();
      const { data: lines } = await supabase.from("rental_lines").select("rental_id").eq("product_id", product.p.id).limit(1000);
      const ids = Array.from(new Set((lines ?? []).map((l) => l.rental_id)));
      if (!ids.length) { setActive([]); return; }
      const { data } = await supabase.from("rentals").select(RENTAL_LIST_COLUMNS).in("id", ids.slice(0, 300)).eq("status", "active").order("end_at");
      setActive((data as unknown as ListRental[]) ?? []);
    })();
  }, [product]);

  const showProduct = (p: Product, variationId?: string) => {
    setUnit(null);
    setNotFound(null);
    setProduct({ p, variationId });
  };

  const lookup = useCallback(async (raw: string, how: Mode = mode) => {
    const text = raw.trim();
    if (!text) return;
    setFocused(false);
    const lower = text.toLowerCase();
    const supabase = createClient();
    try {
      // 1. a piece's tag
      const { data: u, error } = await supabase.from("units").select("*").ilike("code", text.replace(/[%_]/g, "")).maybeSingle();
      if (error) throw error;
      if (u) {
        const { data: res } = await supabase.from("unit_reservations")
          .select("rental_id, state, rentals!unit_reservations_shop_rental_fkey(token, start_at)")
          .eq("unit_id", u.id).in("state", ["held", "out"]).order("state", { ascending: false }).limit(5);
        const rows = (res ?? []) as unknown as { rental_id: string; state: "held" | "out"; rentals: { token: string } | null }[];
        const current = rows.find((r) => r.state === "out") ?? rows[0];
        if (how === "receive" && current?.state === "out") {
          router.push(`/rentals/${current.rental_id}?receive=${u.id}`);
          return;
        }
        const hit: UnitHit = { ...(u as Unit), reservation: current ? { rental_id: current.rental_id, state: current.state, token: current.rentals?.token ?? "" } : null };
        const p = (products ?? []).find((x) => x.id === u.product_id);
        setProduct(p ? { p, variationId: u.variation_id } : null);
        setUnit(hit);
        setNotFound(null);
        if (how === "receive") toast.message(`${u.code} is not out on a rental.`);
        return;
      }
      // 2. a booking number
      const { data: r } = await supabase.from("rentals").select("id, status").ilike("token", text.replace(/[%_]/g, "")).maybeSingle();
      if (r) {
        router.push(r.status === "active" && how === "receive" ? `/rentals/${r.id}?receive=1` : `/rentals/${r.id}`);
        return;
      }
      // 3. a SKU, then a name
      const exact = all.find(({ p, v }) => v.sku.toLowerCase() === lower || p.sku.toLowerCase() === lower);
      if (exact) return showProduct(exact.p, exact.v.sku.toLowerCase() === lower ? exact.v.id : undefined);
      const named = (products ?? []).filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(lower));
      if (named.length === 1) return showProduct(named[0]);
      if (named.length > 1) { setFocused(true); return; }
      setProduct(null);
      setUnit(null);
      setNotFound(text);
    } catch (e) {
      toast.error(errorText(e));
    }
  }, [mode, products, all, router]);

  const onScan = useCallback((text: string) => {
    setScanning(false);
    setQuery(text);
    void lookup(text);
  }, [lookup]);
  const onScanError = useCallback(() => { setScanning(false); toast.error("Could not open the camera. Type the code instead."); }, []);

  const clear = () => {
    setQuery("");
    setProduct(null);
    setUnit(null);
    setNotFound(null);
    inputRef.current?.focus();
  };
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "";
  const canBook = (branchId: string) => !myBranchId || myBranchId === branchId;

  return (
    <>
      <PageHeader title="Inventory Search" subtitle="Scan a tag or type a name, SKU, piece code or booking number."
        actions={cart.count ? <Link href="/book" className={goldButtonClass}><ShoppingBag className="h-4 w-4" /> Checkout ({cart.count})</Link> : null} />

      <div className="mb-3 inline-flex rounded-lg border border-border p-1" role="tablist" aria-label="What are you doing">
        {([["book", "Find and book"], ["receive", "Receive back"]] as [Mode, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={mode === k} onClick={() => { setMode(k); inputRef.current?.focus(); }}
            className={cn("rounded-md px-4 py-1.5 text-sm", mode === k ? "bg-gold/15 font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>

      <form className="relative mb-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); void lookup(query); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          {/* a USB barcode scanner types the code and presses Enter, so this box is all it needs */}
          <input ref={inputRef} autoFocus className={cn(inputClass, "h-12 pl-9 pr-9 text-base")} aria-label="Scan or type"
            placeholder={mode === "receive" ? "Scan the piece coming back, or type its code" : "Product name, SKU or piece code"}
            value={query} onChange={(e) => { setQuery(e.target.value); setFocused(true); }}
            onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)} />
          {query ? (
            <button type="button" aria-label="Clear" onClick={clear} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          ) : null}
          {focused && suggestions.length ? (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
              {suggestions.map(({ p, v }) => (
                <li key={v.id}>
                  <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gold/5"
                    onMouseDown={(e) => e.preventDefault()} onClick={() => { setQuery(v.sku); showProduct(p, v.id); setFocused(false); }}>
                    {p.image_url ? <img src={p.image_url} alt="" className="h-8 w-8 rounded object-cover" /> : null}
                    <span className="min-w-0 flex-1 truncate">{variationLabel(p, v)}</span>
                    <span className="font-mono text-xs text-muted-foreground">{v.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button type="submit" className={cn(goldButtonClass, "h-12 px-5")}>{mode === "receive" ? "Receive" : "Search"}</button>
        <button type="button" className={cn(ghostButtonClass, "h-12")} onClick={() => setScanning(true)} aria-label="Scan with the camera">
          <ScanLine className="h-5 w-5" /> <span className="hidden sm:inline">Camera</span>
        </button>
      </form>

      {notFound ? (
        <Panel className="mb-4"><p className="text-sm text-muted-foreground">Nothing found for <span className="font-mono text-foreground">{notFound}</span>. Check the code or search by name.</p></Panel>
      ) : null}

      {unit ? (
        <Panel className="mb-4" title={<span className="flex flex-wrap items-center gap-2">Piece <span className="font-mono text-gold">{unit.code}</span>
          <StatusBadge tone={unit.reservation?.state === "out" ? "gold" : unit.status === "available" ? "emerald" : "rust"}>
            {unit.reservation?.state === "out" ? "Out on rental" : unit.status === "available" ? (unit.reservation ? "Booked" : "Available") : unit.status_reason || unit.status}
          </StatusBadge>
          <span className="text-xs font-normal text-muted-foreground">{branchName(unit.branch_id)}</span></span>}>
          <div className="flex flex-wrap items-center gap-2">
            {unit.reservation?.state === "out" ? (
              <Link href={`/rentals/${unit.reservation.rental_id}?receive=${unit.id}`} className={goldButtonClass}><LogOut className="h-4 w-4" /> Receive (return) · {unit.reservation.token}</Link>
            ) : null}
            {unit.reservation?.state === "held" ? (
              <Link href={`/rentals/${unit.reservation.rental_id}`} className={ghostButtonClass}>Booked on {unit.reservation.token}</Link>
            ) : null}
            {unit.status === "available" && unit.reservation?.state !== "out" && canBook(unit.branch_id) ? (
              <button className={goldButtonClass} onClick={() => { cart.add(unit.branch_id, unit.variation_id, unit.id); toast.success(`${unit.code} added to the cart`); void reloadStock(); }}>
                <ShoppingBag className="h-4 w-4" /> Add this piece to cart
              </button>
            ) : null}
          </div>
          {unit.reservation?.state === "held" ? <p className="mt-2 text-xs text-muted-foreground">It can still be booked for other dates; the booking form checks the dates.</p> : null}
        </Panel>
      ) : null}

      {product && mode === "book" ? <StockCard product={product.p} stock={stock} highlight={product.variationId} /> : null}

      {product ? (
        <Panel className="mt-4" title={`Active rentals${active ? ` (${active.length})` : ""}`}>
          {active === null ? <p className="text-sm text-muted-foreground">Loading...</p> : active.length === 0 ? <Empty>None of these are out right now.</Empty> : (
            <ul className="divide-y divide-border">
              {active.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <Link href={`/rentals/${r.id}`} className="min-w-0">
                    <p className="text-sm font-medium">{r.customers?.full_name} <span className="ml-1 font-mono text-xs text-gold">{r.token}</span></p>
                    <p className="text-xs text-muted-foreground">{branchName(r.branch_id)} · due {fmtDateTime(r.end_at, tz)}</p>
                  </Link>
                  <Link href={`/rentals/${r.id}?receive=1`} className={goldButtonClass}>Return</Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {!product && !unit && !notFound ? (
        <Panel>
          <p className="text-sm text-muted-foreground">
            {mode === "receive"
              ? "When a customer brings pieces back, scan each tag here (or type its code). It opens the return with that piece ticked."
              : "Scan an item's tag or type its name. You will see how many are free in each branch, and can add them to the cart. Checkout opens the booking form."}
          </p>
        </Panel>
      ) : null}

      {scanning ? <CameraScanner onClose={() => setScanning(false)} onScan={onScan} onError={onScanError} /> : null}
    </>
  );
}
