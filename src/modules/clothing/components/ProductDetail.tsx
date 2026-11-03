"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Pencil, QrCode, ShoppingBag, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_LIST_COLUMNS } from "@/lib/shop/api";
import { fmtDate, rupees } from "@/lib/shop/format";
import { headlinePrice } from "@/lib/shop/useCatalog";
import type { Product, Unit } from "@/lib/shop/types";
import type { ListRental } from "@/components/shop/RentalList";
import { StatusBadge, dangerButtonClass, ghostButtonClass, goldButtonClass } from "@/components/shop/ui";
import { stockTotals, type StockRow } from "@/modules/clothing/components/StockCard";

type PieceRow = Pick<Unit, "id" | "code" | "variation_id" | "branch_id" | "status" | "status_reason">;

const label = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// Everything about one product in one place, for the person running the shop: what it is, what is on the shelf and out,
// who has it and who is next, what it has earned, and every piece with its tag. Renting starts from the Rent button.
export function ProductDetail({ product, stock, onRent, onRemove }: {
  product: Product;
  stock: Map<string, StockRow> | null;
  onRent: () => void;
  onRemove: () => void;
}) {
  const { tz, branches, activeBranches, categories, canManage, isOwner } = useShop();
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "";
  const variations = (product.product_variations ?? []).filter((v) => v.is_enabled);
  const [rentals, setRentals] = useState<ListRental[] | null>(null);
  const [earned, setEarned] = useState(0);
  const [pieces, setPieces] = useState<PieceRow[] | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const supabase = createClient();
      const [{ data: lines }, { data: units }] = await Promise.all([
        supabase.from("rental_lines").select("rental_id, amount").eq("product_id", product.id).limit(2000),
        supabase.from("units").select("id, code, variation_id, branch_id, status, status_reason").eq("product_id", product.id).order("code").limit(2000),
      ]);
      if (!live) return;
      setPieces((units as PieceRow[]) ?? []);
      const ids = Array.from(new Set((lines ?? []).map((l) => l.rental_id))).slice(0, 300);
      if (!ids.length) { setRentals([]); setEarned(0); return; }
      const { data } = await supabase.from("rentals").select(RENTAL_LIST_COLUMNS).in("id", ids).in("status", ["reserved", "active", "completed"]).order("start_at");
      if (!live) return;
      const rows = (data as unknown as ListRental[]) ?? [];
      setRentals(rows);
      const done = new Set(rows.filter((r) => r.status === "completed").map((r) => r.id));
      setEarned((lines ?? []).filter((l) => done.has(l.rental_id)).reduce((s, l) => s + Number(l.amount), 0));
    })();
    return () => { live = false; };
  }, [product.id]);

  const { total, free } = stockTotals(stock, product);
  const sums = useMemo(() => {
    let out = 0; let ahead = 0; let off = 0;
    for (const v of variations) for (const r of stock?.values() ?? []) {
      if (r.variation_id === v.id) { out += r.out_now; ahead += Number(r.reserved_ahead ?? 0); off += Number(r.maintenance ?? 0) + Number(r.lost ?? 0); }
    }
    return { out, ahead, off };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stock, product]);
  const rates = variations.map((v) => headlinePrice(v)?.amount).filter((x): x is number => x !== undefined);
  const lo = rates.length ? Math.min(...rates) : 0;
  const hi = rates.length ? Math.max(...rates) : 0;
  const category = categories.find((c) => c.id === product.category_id)?.name;
  const out = (rentals ?? []).filter((r) => r.status === "active");
  const ahead = (rentals ?? []).filter((r) => r.status === "reserved");
  const timesRented = (rentals ?? []).filter((r) => r.status === "completed" || r.status === "active").length;
  const recovered = product.purchase_price > 0 ? Math.round((earned / Number(product.purchase_price)) * 100) : null;
  const attrValues = useMemo(() => {
    const keys = Array.from(new Set(variations.flatMap((v) => Object.keys(v.attributes ?? {}))));
    return keys.map((k) => ({ key: k, values: Array.from(new Set(variations.map((v) => String(v.attributes?.[k] ?? "").trim()).filter(Boolean))) })).filter((a) => a.values.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);

  const tile = (title: string, value: ReactNode, tone?: string, sub?: string) => (
    <div className="rounded-2xl border border-border bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
      <p className={cn("mt-1 font-display text-3xl font-bold", tone)}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
  const h = (t: string, extra?: ReactNode) => (
    <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t}</h3>{extra}</div>
  );
  const badge = !product.is_active ? <StatusBadge tone="muted">Switched off</StatusBadge>
    : free > 0 ? <StatusBadge tone="emerald">In stock</StatusBadge> : total === 0 ? <StatusBadge tone="muted">No pieces</StatusBadge> : <StatusBadge tone="rust">All out</StatusBadge>;

  return (
    <div className="space-y-6">
      {/* who and what */}
      <div className="flex flex-col gap-5 pr-8 sm:flex-row sm:items-start">
        <div className="flex h-36 w-36 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#101715] sm:h-40 sm:w-40">
          {product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-cover" /> : <span className="text-sm text-white/60">No image</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">{badge}{category ? <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">{category}</span> : null}</div>
          <h2 className="mt-2 font-display text-3xl font-bold leading-tight sm:text-4xl">{product.name}</h2>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{product.sku}</p>
          <p className="mt-2 font-mono text-2xl text-gold">{rates.length ? (lo === hi ? rupees(lo) : `${rupees(lo)} – ${rupees(hi)}`) : "No price"}<span className="text-base">/day</span></p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={cn(goldButtonClass, "min-h-11 px-6")} onClick={onRent}><ShoppingBag className="h-4 w-4" /> Rent</button>
            {canManage ? <Link href={`/catalog/${product.id}`} className={cn(ghostButtonClass, "min-h-11 px-5")}><Pencil className="h-4 w-4" /> Edit</Link> : null}
            {canManage ? <Link href={`/print/tags?product=${product.id}`} className={cn(ghostButtonClass, "min-h-11 px-5")}><QrCode className="h-4 w-4" /> Print tags</Link> : null}
            {isOwner ? <button type="button" className={cn(dangerButtonClass, "min-h-11 rounded-full px-5")} onClick={onRemove}><Trash2 className="h-4 w-4" /> Remove</button> : null}
          </div>
        </div>
      </div>

      {product.description ? <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{product.description}</p> : null}

      {attrValues.length ? (
        <div className="space-y-2">
          {attrValues.map((a) => (
            <p key={a.key} className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="w-16 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label(a.key)}</span>
              {a.values.map((v) => <span key={v} className="rounded-full border border-border bg-white px-2.5 py-0.5 text-xs">{v}</span>)}
            </p>
          ))}
        </div>
      ) : null}

      {/* on the shelf and out */}
      {product.is_set ? <p className="rounded-xl bg-accent/60 p-3 text-sm text-muted-foreground">A set is free when every piece in it is free; checkout checks it for the dates.</p> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tile("Total pieces", total)}
          {tile("Available now", free, free > 0 ? "text-emerald" : "text-muted-foreground")}
          {tile("Out on rent", sums.out, sums.out ? "text-amber" : undefined)}
          {tile("Booked ahead", sums.ahead, undefined, sums.off ? `${sums.off} in repair or lost` : undefined)}
        </div>
      )}

      {/* what the shop has earned with it: money figures are for owners and managers */}
      {canManage ? (
        <div>
          {h("Business")}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tile("Times rented", rentals === null ? "…" : timesRented)}
            {tile("Earned", rentals === null ? "…" : rupees(earned), undefined, "from returned rentals")}
            {tile("Cost price", product.purchase_price > 0 ? rupees(product.purchase_price) : "—", undefined, recovered !== null ? `${recovered}% earned back` : undefined)}
            {tile("Replacement value", product.replacement_value > 0 ? rupees(product.replacement_value) : "—", undefined, "charged if lost")}
          </div>
        </div>
      ) : null}

      {/* variations by branch: one row per variation, one column per branch, so any number of branches stays tidy (it scrolls sideways) */}
      <div>
        {h(`Variations (${variations.length})`, <span className="text-xs text-muted-foreground">free / total pieces</span>)}
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 min-w-[11rem] bg-muted px-4 py-2.5">Variation</th>
                <th className="whitespace-nowrap px-3 py-2.5">Price / day</th>
                {activeBranches.map((b) => <th key={b.id} title={b.name} className="max-w-[7rem] truncate px-3 py-2.5 text-center">{b.name}</th>)}
                {activeBranches.length > 1 ? <th className="px-3 py-2.5 text-center">All</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {variations.map((v) => {
                const attrs = Object.entries(v.attributes ?? {}).filter(([, x]) => String(x ?? "").trim()).map(([k, x]) => `${label(k)}: ${x}`).join(", ");
                let all = 0; let allFree = 0;
                return (
                  <tr key={v.id}>
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5"><p className="font-medium">{attrs || v.name}</p><p className="font-mono text-[11px] text-muted-foreground">{v.sku}</p></td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-gold">{headlinePrice(v) ? rupees(headlinePrice(v)!.amount) : "—"}</td>
                    {activeBranches.map((b) => {
                      const s = stock?.get(`${v.id}:${b.id}`);
                      all += s?.total ?? 0; allFree += s?.available_now ?? 0;
                      return <td key={b.id} className={cn("px-3 py-2.5 text-center font-mono text-sm", (s?.available_now ?? 0) > 0 ? "font-semibold text-emerald" : "text-muted-foreground")}>{s?.total ? `${s.available_now}/${s.total}` : "–"}</td>;
                    })}
                    {activeBranches.length > 1 ? <td className="px-3 py-2.5 text-center font-mono text-sm font-semibold">{all ? `${allFree}/${all}` : "–"}</td> : null}
                  </tr>
                );
              })}
              {variations.length === 0 ? <tr><td colSpan={3 + activeBranches.length} className="p-4 text-center text-muted-foreground">No bookable variations.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* who has it and who is next */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          {h("Out now", <span className="text-xs text-muted-foreground">{rentals === null ? "" : out.length}</span>)}
          {rentals === null ? <p className="text-sm text-muted-foreground">Loading...</p> : out.length === 0 ? <p className="rounded-xl bg-accent/40 p-3 text-sm text-muted-foreground">None of it is out right now.</p> : (
            <ul className="space-y-2">
              {out.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-white p-3">
                  <Link href={`/rentals/${r.id}`} className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.customers?.full_name} <span className="font-mono text-[11px] text-gold">{r.token}</span></p>
                    <p className={cn("text-[11px]", Date.parse(r.end_at) < Date.now() ? "font-semibold text-rust" : "text-muted-foreground")}>{Date.parse(r.end_at) < Date.now() ? "Overdue · was due " : "Due "}{fmtDate(r.end_at, tz)}{branchName(r.branch_id) ? ` · ${branchName(r.branch_id)}` : ""}</p>
                  </Link>
                  <Link href={`/rentals/${r.id}?receive=1`} className={cn(goldButtonClass, "px-3 py-1.5 text-xs")}>Return</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          {h("Booked ahead", <span className="text-xs text-muted-foreground">{rentals === null ? "" : ahead.length}</span>)}
          {rentals === null ? <p className="text-sm text-muted-foreground">Loading...</p> : ahead.length === 0 ? <p className="rounded-xl bg-accent/40 p-3 text-sm text-muted-foreground">No upcoming bookings.</p> : (
            <ul className="space-y-2">
              {ahead.map((r) => (
                <li key={r.id}>
                  <Link href={`/rentals/${r.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-white p-3 hover:bg-accent/40">
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{r.customers?.full_name} <span className="font-mono text-[11px] text-gold">{r.token}</span></span>
                      <span className="block text-[11px] text-muted-foreground">Pickup {fmtDate(r.start_at, tz)} → {fmtDate(r.end_at, tz)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* every piece, so a lost or repaired one can be found by its tag */}
      <details className="rounded-xl border border-border bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Pieces and tags {pieces ? `(${pieces.length})` : ""}</summary>
        <div className="max-h-72 overflow-y-auto border-t border-border">
          {pieces === null ? <p className="p-4 text-sm text-muted-foreground">Loading...</p> : pieces.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No pieces yet. Add stock from Edit.</p> : (
            <ul className="divide-y divide-border">
              {pieces.map((p) => {
                const v = variations.find((x) => x.id === p.variation_id);
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="font-mono text-xs">{p.code}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{v ? Object.values(v.attributes ?? {}).join(" / ") || v.name : ""} · {branchName(p.branch_id)}</span>
                    <StatusBadge tone={p.status === "available" ? "emerald" : p.status === "retired" ? "muted" : "rust"}>{p.status === "available" ? "Available" : p.status_reason || p.status}</StatusBadge>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
