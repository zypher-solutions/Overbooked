"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { RATE_LABELS, errorText, fmtInterval, intervalHours, num } from "@/lib/shop/format";
import type { FieldDef, Product, SetItem, Template } from "@/lib/shop/types";
import { useCatalog, variationLabel } from "@/lib/shop/useCatalog";
import { Field, PageHeader, Panel, dangerButtonClass, ghostButtonClass, goldButtonClass, inputClass, monoInputClass } from "./ui";

interface VarDraft {
  id?: string;
  name: string;
  sku: string;
  attributes: Record<string, string>;
  rates: Record<string, string>;
  base_occupancy: string;
  max_occupancy: string;
  km_included_per_day: string;
  turnaround_hours: string;
  is_enabled: boolean;
}
interface ProductDraft {
  id?: string;
  category_id: string;
  name: string;
  sku: string;
  description: string;
  image_url: string;
  purchase_price: string;
  replacement_value: string;
  is_active: boolean;
  variations: VarDraft[];
}

const emptyVar = (): VarDraft => ({
  name: "", sku: "", attributes: {}, rates: {}, base_occupancy: "", max_occupancy: "", km_included_per_day: "", turnaround_hours: "", is_enabled: true,
});

export function toDraft(p: Product): ProductDraft {
  return {
    id: p.id, category_id: p.category_id, name: p.name, sku: p.sku, description: p.description ?? "", image_url: p.image_url ?? "",
    purchase_price: String(p.purchase_price ?? ""), replacement_value: String(p.replacement_value ?? ""), is_active: p.is_active,
    variations: (p.product_variations ?? []).map((v) => ({
      id: v.id, name: v.name, sku: v.sku,
      attributes: Object.fromEntries(Object.entries(v.attributes ?? {}).map(([k, x]) => [k, String(x)])),
      rates: Object.fromEntries((v.variation_rates ?? []).map((r) => [r.rate_type, String(r.amount)])),
      base_occupancy: v.base_occupancy?.toString() ?? "", max_occupancy: v.max_occupancy?.toString() ?? "",
      km_included_per_day: v.km_included_per_day?.toString() ?? "", turnaround_hours: String(intervalHours(v.turnaround)), is_enabled: v.is_enabled,
    })),
  };
}

const skuPart = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 16);

// asSet: a set (optional feature): one price, booked as its pieces
export function ProductEditor({ product, onSaved, asSet = false }: { product?: Product; onSaved?: () => void; asSet?: boolean }) {
  const isSet = asSet || !!product?.is_set;
  const [setItems, setSetItems] = useState<SetItem[]>([]);
  const { products: catalog } = useCatalog();
  useEffect(() => {
    if (!product?.is_set) return;
    void createClient().from("set_items").select("variation_id, qty").eq("set_product_id", product.id)
      .then(({ data }) => setSetItems((data as SetItem[]) ?? []));
  }, [product]);
  const router = useRouter();
  const { shop, categories, templateOf, isOwner, canManage, word } = useShop();
  const [d, setD] = useState<ProductDraft>(() => product ? toDraft(product) : {
    category_id: categories[0]?.id ?? "", name: "", sku: "", description: "", image_url: "", purchase_price: "", replacement_value: "",
    is_active: true, variations: [emptyVar()],
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => { if (product) setD(toDraft(product)); }, [product]);

  const template = templateOf(d.category_id);
  const set = (patch: Partial<ProductDraft>) => setD((x) => ({ ...x, ...patch }));
  const setVar = (i: number, patch: Partial<VarDraft>) => set({ variations: d.variations.map((v, j) => j === i ? { ...v, ...patch } : v) });
  const prefix = categories.find((c) => c.id === d.category_id)?.sku_prefix;

  // SKUs filled in from the names unless typed by hand
  const productSku = d.sku || (d.name ? `${prefix ? prefix + "-" : ""}${skuPart(d.name)}` : "");
  const varSku = (v: VarDraft, i: number) => v.sku
    || `${productSku}-${skuPart(Object.values(v.attributes).filter(Boolean).join("-") || v.name || String(i + 1)) || i + 1}`;

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const small = await imageCompression(file, { maxSizeMB: 0.4, maxWidthOrHeight: 1400, useWebWorker: true });
      const path = `${shop.id}/${crypto.randomUUID()}.jpg`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("product_images").upload(path, small, { contentType: "image/jpeg" });
      if (error) throw error;
      set({ image_url: supabase.storage.from("product_images").getPublicUrl(path).data.publicUrl });
    } catch (e) {
      toast.error("Could not upload the photo: " + errorText(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!template) return toast.error("Choose a category.");
    if (!d.name.trim()) return toast.error("Name the item.");
    if (isSet && setItems.filter((x) => x.variation_id).length === 0) return toast.error("Add the pieces of the set.");
    setBusy(true);
    try {
      const id = await call<string>("save_product", {
        p: {
          id: d.id, category_id: d.category_id, name: d.name, sku: productSku, description: d.description, image_url: d.image_url,
          purchase_price: num(d.purchase_price), replacement_value: num(d.replacement_value), is_active: d.is_active,
          variations: d.variations.map((v, i) => ({
            id: v.id, name: v.name.trim() || d.name.trim(), sku: varSku(v, i),
            attributes: Object.fromEntries(Object.entries(v.attributes).filter(([, x]) => x !== "").map(([k, x]) =>
              [k, template.variation_fields.find((f) => f.key === k)?.type === "number" ? num(x) : x])),
            rates: Object.fromEntries(Object.entries(v.rates).filter(([, x]) => x.trim() !== "")),
            base_occupancy: v.base_occupancy || null, max_occupancy: v.max_occupancy || null,
            km_included_per_day: v.km_included_per_day || null, turnaround_hours: v.turnaround_hours === "" ? null : num(v.turnaround_hours),
            is_enabled: v.is_enabled,
          })),
        },
      });
      if (isSet) await call("save_set_items", { p_product_id: id, p_items: setItems.filter((x) => x.variation_id) });
      toast.success("Saved");
      if (!d.id) router.replace(`/catalog/${id}`);
      else onSaved?.();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!d.id || !confirm(`Remove ${d.name}? If it was ever rented it is switched off instead, so history stays.`)) return;
    try {
      const res = await call<{ result: string }>("delete_or_deactivate_product", { p_product_id: d.id });
      toast.success(res.result === "deleted" ? "Deleted" : "Switched off (it has rental history)");
      router.push("/catalog");
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const readOnly = !canManage;
  return (
    <>
      <PageHeader title={d.id ? d.name || "Item" : isSet ? "New set" : `New ${word("item").toLowerCase()}`}
        actions={readOnly ? null : <>
          {d.id && isOwner ? <button className={dangerButtonClass} onClick={remove}><Trash2 className="h-4 w-4" /> Remove</button> : null}
          <button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button>
        </>} />
      <fieldset disabled={readOnly} className="space-y-4">
        <Panel>
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Category">
                <select className={inputClass} value={d.category_id} onChange={(e) => set({ category_id: e.target.value })}>
                  {/* an existing item can only move to a category of the same type: its prices and fields depend on it */}
                  {categories.filter((c) => !product || c.template_key === templateOf(product.category_id)?.key).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Name"><input className={inputClass} value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="SKU" hint="Filled in for you; change it if you have your own codes">
                <input className={monoInputClass} value={d.sku} placeholder={productSku} onChange={(e) => set({ sku: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Replacement value (₹)" hint="Charged if it is lost">
                <input className={monoInputClass} inputMode="decimal" value={d.replacement_value} onChange={(e) => set({ replacement_value: e.target.value })} />
              </Field>
              <Field label="Purchase price (₹)" hint="For your own records">
                <input className={monoInputClass} inputMode="decimal" value={d.purchase_price} onChange={(e) => set({ purchase_price: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={d.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> Can be booked</label>
              <Field label="Description" className="sm:col-span-2"><textarea className={inputClass} rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            </div>
            <div>
              <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Photo</span>
              <label className={cn("flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/30", readOnly && "cursor-default")}>
                {d.image_url ? <img src={d.image_url} alt="" className="h-full w-full object-cover" />
                  : <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground"><ImagePlus className="h-6 w-6" />{uploading ? "Uploading..." : "Add photo"}</span>}
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); }} />
              </label>
              {d.image_url && !readOnly ? <button type="button" className="mt-1 text-xs text-muted-foreground hover:underline" onClick={() => set({ image_url: "" })}>Remove photo</button> : null}
            </div>
          </div>
        </Panel>

        {isSet ? (
          <Panel title="Pieces in this set" actions={<button type="button" className={ghostButtonClass} onClick={() => setSetItems([...setItems, { variation_id: "", qty: 1 }])}><Plus className="h-4 w-4" /> Add piece</button>}>
            <p className="mb-3 text-xs text-muted-foreground">Booking the set reserves one of each piece; it is free only when every piece is free.</p>
            <ul className="space-y-2">
              {setItems.map((it, i) => (
                <li key={i} className="flex gap-2">
                  <select className={inputClass} aria-label="Piece" value={it.variation_id}
                    onChange={(e) => setSetItems(setItems.map((x, j) => j === i ? { ...x, variation_id: e.target.value } : x))}>
                    <option value="">Choose a piece</option>
                    {(catalog ?? []).filter((p) => !p.is_set && p.id !== d.id && templateOf(p.category_id)?.kind === "wearable")
                      .flatMap((p) => (p.product_variations ?? []).map((v) => <option key={v.id} value={v.id}>{variationLabel(p, v)} ({v.sku})</option>))}
                  </select>
                  <input className={cn(monoInputClass, "w-20")} type="number" min={1} aria-label="How many" value={it.qty}
                    onChange={(e) => setSetItems(setItems.map((x, j) => j === i ? { ...x, qty: Math.max(1, Math.floor(num(e.target.value))) } : x))} />
                  <button type="button" aria-label="Remove piece" className="rounded p-2 hover:bg-black/5" onClick={() => setSetItems(setItems.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
        {template ? d.variations.map((v, i) => (
          <VariationCard key={v.id ?? `new-${i}`} template={template} v={v} sku={varSku(v, i)} index={i} count={d.variations.length}
            onChange={(patch) => setVar(i, patch)} onRemove={() => set({ variations: d.variations.filter((_, j) => j !== i) })} />
        )) : null}
        {!readOnly ? (
          <button type="button" className={ghostButtonClass} onClick={() => set({ variations: [...d.variations, emptyVar()] })}>
            <Plus className="h-4 w-4" /> Add a {template?.labels.variation?.toLowerCase() ?? "variation"}
          </button>
        ) : null}
      </fieldset>
    </>
  );
}

function VariationCard({ template, v, sku, index, count, onChange, onRemove }: {
  template: Template; v: VarDraft; sku: string; index: number; count: number; onChange: (p: Partial<VarDraft>) => void; onRemove: () => void;
}) {
  const kind = template.kind;
  const fieldInput = (f: FieldDef) => f.type === "select" ? (
    <select className={inputClass} value={v.attributes[f.key] ?? ""} onChange={(e) => onChange({ attributes: { ...v.attributes, [f.key]: e.target.value } })}>
      <option value="">—</option>
      {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  ) : (
    <input className={f.type === "number" ? monoInputClass : inputClass} inputMode={f.type === "number" ? "numeric" : undefined}
      value={v.attributes[f.key] ?? ""} onChange={(e) => onChange({ attributes: { ...v.attributes, [f.key]: e.target.value } })} />
  );
  const rateTypes = useMemo(() => template.rate_types, [template]);

  return (
    <Panel title={`${template.labels.variation ?? "Variation"} ${count > 1 ? index + 1 : ""}`}
      actions={<div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={v.is_enabled} onChange={(e) => onChange({ is_enabled: e.target.checked })} /> Bookable</label>
        {count > 1 ? <button type="button" aria-label="Remove this variation" className="rounded p-1 hover:bg-black/5" onClick={onRemove}><Trash2 className="h-4 w-4" /></button> : null}
      </div>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" hint="Leave empty to use the item name"><input className={inputClass} value={v.name} onChange={(e) => onChange({ name: e.target.value })} /></Field>
        {template.variation_fields.map((f) => <Field key={f.key} label={f.label}>{fieldInput(f)}</Field>)}
        <Field label="SKU"><input className={monoInputClass} value={v.sku} placeholder={sku} onChange={(e) => onChange({ sku: e.target.value.toUpperCase() })} /></Field>
      </div>
      <p className="mb-2 mt-4 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Prices (starting points; agree any price per booking)</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rateTypes.map((r) => (
          <Field key={r} label={RATE_LABELS[r] ?? r}>
            <input className={monoInputClass} inputMode="decimal" value={v.rates[r] ?? ""} onChange={(e) => onChange({ rates: { ...v.rates, [r]: e.target.value } })} />
          </Field>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kind === "room" ? <>
          <Field label="Guests included"><input className={monoInputClass} inputMode="numeric" value={v.base_occupancy} onChange={(e) => onChange({ base_occupancy: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Most guests"><input className={monoInputClass} inputMode="numeric" value={v.max_occupancy} onChange={(e) => onChange({ max_occupancy: e.target.value.replace(/\D/g, "") })} /></Field>
        </> : null}
        {kind === "vehicle" ? (
          <Field label="Free km per day"><input className={monoInputClass} inputMode="numeric" value={v.km_included_per_day} onChange={(e) => onChange({ km_included_per_day: e.target.value.replace(/\D/g, "") })} /></Field>
        ) : null}
        <Field label={`${template.labels.turnaround ?? "Turnaround"} (hours)`} hint={`Default ${fmtInterval(template.turnaround)}`}>
          <input className={monoInputClass} inputMode="decimal" value={v.turnaround_hours} placeholder={String(intervalHours(template.turnaround))}
            onChange={(e) => onChange({ turnaround_hours: e.target.value })} />
        </Field>
      </div>
    </Panel>
  );
}
