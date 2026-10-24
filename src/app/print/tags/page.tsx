"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { QrCode } from "@/components/shop/QrCode";
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

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 8mm; } body { background: white; } }`}</style>
      <div className="no-print space-y-3 border-b bg-gray-50 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => history.back()} className="rounded border bg-white px-3 py-1.5">Back</button>
          <select className="rounded border bg-white px-2 py-1.5" aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="rounded border bg-white px-2 py-1.5" aria-label="Category" value={cat} onChange={(e) => { setCat(e.target.value); setProduct(""); }}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="rounded border bg-white px-2 py-1.5" aria-label="Item" value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">All items</option>
            {products.filter((p) => !cat || p.category_id === cat).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="rounded border bg-white px-2 py-1.5" aria-label="Label size" value={size} onChange={(e) => setSize(e.target.value as keyof typeof SIZES)}>
            {Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button onClick={() => window.print()} disabled={printable.length === 0} className="ml-auto rounded bg-black px-4 py-1.5 font-semibold text-white disabled:opacity-40">
            Print {printable.length} tag{printable.length === 1 ? "" : "s"}
          </button>
        </div>
        <p className="text-xs text-gray-600">Click a tag to leave it out. In the print window choose the paper size of your sticker sheet and 100% scale.</p>
      </div>

      <div className="flex flex-wrap gap-[2mm] p-[4mm] print:p-0">
        {list.map((u) => (
          <button key={u.id} type="button" onClick={() => setSkip((x) => { const n = new Set(x); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); return n; })}
            className={`flex items-center gap-[2mm] overflow-hidden border border-dashed border-gray-300 p-[1.5mm] text-left print:border-gray-200 ${skip.has(u.id) ? "opacity-25 print:hidden" : ""}`}
            style={{ width: `${s.w}mm`, height: `${s.h}mm` }}>
            <QrCode text={u.code} size={s.qr * 3.78} className="shrink-0" />
            <span className="min-w-0 leading-tight">
              <span className="block break-all font-mono text-[9pt] font-bold">{u.code}</span>
              <span className="block line-clamp-2 text-[7pt]">{label(u)}</span>
              <span className="block truncate text-[6pt] text-gray-500">{shop?.name}</span>
            </span>
          </button>
        ))}
        {list.length === 0 ? <p className="p-4 text-sm text-gray-500">No units match.</p> : null}
      </div>
    </div>
  );
}
