"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { QrCode } from "@/components/shop/QrCode";
import { goldButtonClass } from "@/components/overbooked/primitives";
import type { Branch, Category, Product, Unit } from "@/lib/shop/types";

const SIZES = {
  small: { label: "Small, 38 × 25 mm", w: 38, h: 25, qr: 20 },
  medium: { label: "Medium, 50 × 30 mm", w: 50, h: 30, qr: 24 },
  large: { label: "Large, 70 × 40 mm", w: 70, h: 40, qr: 32 },
} as const;

export default function TagsPage() {
  return <Suspense fallback={null}><Tags /></Suspense>;
}

// Sticker labels for units: a QR code with the unit's code (the Today screen's scan finds it), the code
// in print, and the item name. Prints on A4 sticker sheets or a label printer.
function Tags() {
  const params = useSearchParams();
  const { shop } = useAuth();
  const [units, setUnits] = useState<Unit[]>([]);
  const [products, setProducts] = useState<(Product & { product_variations: { id: string; name: string }[] })[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [branch, setBranch] = useState("");
  const [cat, setCat] = useState("");
  const [product, setProduct] = useState(params.get("product") ?? "");
  const [size, setSize] = useState<keyof typeof SIZES>("medium");
  const [skip, setSkip] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!shop) return;
    const supabase = createClient();
    void Promise.all([
      supabase.from("units").select("*").neq("status", "retired").order("code").limit(5000),
      supabase.from("products").select("id, name, category_id, product_variations!product_variations_shop_product_fkey(id, name)"),
      supabase.from("branches").select("*").eq("is_active", true).order("created_at"),
      supabase.from("categories").select("*").order("name"),
    ]).then(([u, p, b, c]) => {
      setUnits((u.data as Unit[]) ?? []);
      setProducts((p.data as never) ?? []);
      setBranches((b.data as Branch[]) ?? []);
      setCategories((c.data as Category[]) ?? []);
    });
  }, [shop]);

  const productOf = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const list = units.filter((u) => (!branch || u.branch_id === branch) && (!product || u.product_id === product)
    && (!cat || productOf.get(u.product_id)?.category_id === cat));
  const printable = list.filter((u) => !skip.has(u.id));
  const s = SIZES[size];
  const label = (u: Unit) => {
    const p = productOf.get(u.product_id);
    const v = p?.product_variations.find((x) => x.id === u.variation_id);
    return v && v.name !== p?.name ? `${p?.name} · ${v.name}` : p?.name ?? "";
  };

  const field = "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-gold/60 focus:ring-2 focus:ring-ring";
  const labelCls = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
  const toggle = (id: string) => setSkip((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="min-h-screen bg-background text-foreground print:bg-white print:text-black">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 8mm; } body { background: white; } }`}</style>

      <div className="no-print border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <button onClick={() => history.back()} className="mb-2 text-xs text-muted-foreground hover:text-foreground">← Back</button>
              <h1 className="font-display text-2xl font-semibold">Print tags</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Sticker labels with a QR code for each piece. Scanning one on the Inventory Search screen finds the piece.
              </p>
            </div>
            <button onClick={() => window.print()} disabled={printable.length === 0}
              className={goldButtonClass + " px-5"}>
              Print {printable.length} tag{printable.length === 1 ? "" : "s"}
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label><span className={labelCls}>Branch</span>
              <select className={field} value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">All branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label><span className={labelCls}>Category</span>
              <select className={field} value={cat} onChange={(e) => { setCat(e.target.value); setProduct(""); }}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label><span className={labelCls}>Item</span>
              <select className={field} value={product} onChange={(e) => setProduct(e.target.value)}>
                <option value="">All items</option>
                {products.filter((p) => !cat || p.category_id === cat).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label><span className={labelCls}>Label size</span>
              <select className={field} value={size} onChange={(e) => setSize(e.target.value as keyof typeof SIZES)}>
                {Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              <strong className="text-foreground">{printable.length}</strong> of {list.length} selected. Click a tag to leave it out.
              {skip.size > 0 ? <button onClick={() => setSkip(new Set())} className="ml-2 text-gold hover:underline">Select all again</button> : null}
            </span>
            <span>In the print window choose your sticker sheet's paper size and 100% scale.</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl p-4 sm:p-6 print:max-w-none print:p-0">
        <div className="flex flex-wrap gap-[3mm] rounded-xl border border-border bg-white p-[5mm] shadow-sm print:gap-[2mm] print:rounded-none print:border-0 print:p-0 print:shadow-none">
          {list.map((u) => {
            const off = skip.has(u.id);
            return (
              <button key={u.id} type="button" onClick={() => toggle(u.id)} aria-pressed={!off} title={off ? "Left out: click to include" : "Click to leave this tag out"}
                className={`relative flex items-center gap-[2mm] overflow-hidden rounded-[1mm] border border-dashed p-[1.5mm] text-left text-black transition print:rounded-none print:border-gray-200 ${off ? "border-gray-200 opacity-30 print:hidden" : "border-gray-400 hover:border-gold hover:bg-gold/5"}`}
                style={{ width: `${s.w}mm`, height: `${s.h}mm` }}>
                <QrCode text={u.code} size={s.qr * 3.78} className="shrink-0" />
                <span className="min-w-0 leading-tight">
                  <span className="block break-all font-mono text-[9pt] font-bold">{u.code}</span>
                  <span className="block line-clamp-2 text-[7pt]">{label(u)}</span>
                  <span className="block truncate text-[6pt] text-gray-500">{shop?.name}</span>
                </span>
              </button>
            );
          })}
          {list.length === 0 ? <p className="w-full py-10 text-center text-sm text-gray-500">No pieces match these choices.</p> : null}
        </div>
      </div>
    </div>
  );
}
