"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import { Check, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { useCatalog } from "@/lib/shop/useCatalog";
import { errorText, num } from "@/lib/shop/format";
import type { Product, Unit } from "@/lib/shop/types";
import { Field, PageHeader, Panel, dangerButtonClass, ghostButtonClass, goldButtonClass, inputClass, monoInputClass } from "./ui";

// Add New Product, as in TRENDZ: three steps on one page.
//   1. Basic info  2. Attributes (Colour, Size... with their values)  3. Variations & stock
// Step 3 makes one variation for every mix of the values, each with its price and how many pieces each
// branch holds; saving creates those pieces with their own codes (printable as QR tags).
// Changing a product uses the same form: pieces can be added here, and removed from the Pieces list.
interface Attr { key: string; label: string; values: string[] }
interface VarRow { id?: string; key: string; attributes: Record<string, string>; name: string; sku: string; savedSku?: string; rate: string; enabled: boolean; stock: Record<string, string> }
// product and variation SKUs of bridal and groom shops, as in TRENDZ: BR-001, BR-001-GOLD-M
const SKU_PATTERN = /^[A-Z]{2,6}-[0-9]{3,4}(-[A-Za-z0-9]+)*$/;
interface Basic { category_id: string; name: string; sku: string; rate: string; replacement_value: string; description: string; image_url: string; is_active: boolean }
type Step = "basic" | "attributes" | "variations";

const skuPart = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 16);
const comboKey = (a: Record<string, string>) => Object.keys(a).sort().map((k) => `${k}=${a[k]}`).join("|");

function combos(attrs: Attr[]): Record<string, string>[] {
  const used = attrs.filter((a) => a.values.length);
  if (!used.length) return [{}];
  return used.reduce<Record<string, string>[]>((acc, a) => acc.flatMap((c) => a.values.map((v) => ({ ...c, [a.key]: v }))), [{}]);
}

export function ProductWizard({ product, onSaved }: { product?: Product; onSaved?: () => void }) {
  const router = useRouter();
  const { shop, categories, templates, templateOf, activeBranches, myBranchId, role, isOwner } = useShop();
  const wearCats = categories.filter((c) => templates.some((t) => t.key === c.template_key && t.kind === "wearable") && (!product || c.id === product.category_id || templateOf(c.id)?.key === templateOf(product.category_id)?.key));
  const draftKey = `ob_product_draft_${shop.id}`;
  const [step, setStep] = useState<Step>("basic");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({}); // existing pieces: `${variation}:${branch}`
  const [basic, setBasic] = useState<Basic>(() => ({
    category_id: product?.category_id ?? wearCats[0]?.id ?? "", name: product?.name ?? "", sku: product?.sku ?? "",
    rate: "", replacement_value: product ? String(product.replacement_value ?? "") : "", description: product?.description ?? "",
    image_url: product?.image_url ?? "", is_active: product?.is_active ?? true,
  }));
  const template = templateOf(basic.category_id);
  const [attrs, setAttrsRaw] = useState<Attr[]>([]);
  const [attrsTouched, setAttrsTouched] = useState(false);
  const setAttrs = (a: Attr[]) => { setAttrsRaw(a); setAttrsTouched(true); };
  const [rows, setRows] = useState<VarRow[]>([]);
  const restored = useRef(false);

  // fields of the business type (Colour, Size) come first; existing values when changing a product
  useEffect(() => {
    if (restored.current || !template) return;
    restored.current = true;
    if (!product) {
      try {
        const saved = localStorage.getItem(draftKey);
        if (saved) {
          const d = JSON.parse(saved) as { basic: Basic; attrs: Attr[]; rows: VarRow[] };
          setBasic(d.basic); setAttrsRaw(d.attrs); setRows(d.rows);
          toast.message("Your unfinished product was restored.");
          return;
        }
      } catch { /* storage unavailable */ }
      setAttrsRaw(template.variation_fields.map((f) => ({ key: f.key, label: f.label, values: [] })));
      return;
    }
    const vars = product.product_variations ?? [];
    const keys = new Set<string>([...template.variation_fields.map((f) => f.key), ...vars.flatMap((v) => Object.keys(v.attributes ?? {}))]);
    setAttrsRaw(Array.from(keys).map((k) => ({
      key: k, label: template.variation_fields.find((f) => f.key === k)?.label ?? k,
      values: Array.from(new Set(vars.filter((v) => v.is_enabled).map((v) => String(v.attributes?.[k] ?? "")).filter(Boolean))),
    })));
    setRows(vars.map((v) => {
      const a = Object.fromEntries(Object.entries(v.attributes ?? {}).map(([k, x]) => [k, String(x)]));
      return { id: v.id, key: comboKey(a), attributes: a, name: v.name, sku: v.sku, savedSku: v.sku, enabled: v.is_enabled, stock: {},
        rate: String(v.variation_rates?.find((r) => r.rate_type === "day")?.amount ?? "") };
    }));
    const first = vars.find((v) => v.variation_rates?.some((r) => r.rate_type === "day"));
    setBasic((b) => ({ ...b, rate: String(first?.variation_rates?.find((r) => r.rate_type === "day")?.amount ?? "") }));
  }, [template, product, draftKey]);

  // how many pieces each variation already has per branch
  useEffect(() => {
    if (!product) return;
    void createClient().from("units").select("variation_id, branch_id, status").eq("product_id", product.id).neq("status", "retired").limit(5000)
      .then(({ data }) => {
        const m: Record<string, number> = {};
        for (const u of (data ?? []) as Pick<Unit, "variation_id" | "branch_id">[]) m[`${u.variation_id}:${u.branch_id}`] = (m[`${u.variation_id}:${u.branch_id}`] ?? 0) + 1;
        setCounts(m);
      });
  }, [product]);

  // keep an unfinished new product if the page is left
  useEffect(() => {
    if (product || !restored.current) return;
    try { localStorage.setItem(draftKey, JSON.stringify({ basic, attrs, rows })); } catch { /* ignore */ }
  }, [basic, attrs, rows, product, draftKey]);

  // As in TRENDZ the product SKU cannot be typed: the category's base SKU and the next number (BR-001, BR-002...).
  // A product being changed keeps its SKU.
  const { products: allProducts } = useCatalog({ includeInactive: true });
  const prefix = categories.find((c) => c.id === basic.category_id)?.sku_prefix ?? "";
  const nextSku = useMemo(() => {
    if (!prefix) return "";
    let max = 0;
    for (const p of allProducts ?? []) {
      if (!p.sku.startsWith(prefix + "-")) continue;
      const n = parseInt(p.sku.slice(prefix.length + 1), 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return `${prefix}-${String(max + 1).padStart(3, "0")}`;
  }, [prefix, allProducts]);
  const productSku = product ? product.sku : nextSku;
  const autoName = (a: Record<string, string>) => Object.values(a).filter(Boolean).join(" / ") || basic.name.trim() || "Standard";
  const autoSku = (a: Record<string, string>) => `${productSku}${Object.values(a).filter(Boolean).length ? "-" + skuPart(Object.values(a).filter(Boolean).join("-")) : ""}`;

  // step 3 rows: one per mix of values; existing variations keep their place, new mixes are added
  const buildRows = () => {
    // changing a product: its variations stay as they are unless the attributes were changed
    if (product && !attrsTouched) { setStep("variations"); return; }
    const wanted = combos(attrs.filter((a) => a.key));
    setRows((prev) => {
      const byKey = new Map(prev.map((r) => [r.key, r]));
      const next: VarRow[] = wanted.map((a) => {
        const k = comboKey(a);
        // a new mix on an existing product starts unticked: tick only the ones the shop really has
        return byKey.get(k) ?? { key: k, attributes: a, name: "", sku: "", rate: basic.rate, enabled: !product, stock: Object.fromEntries(activeBranches.map((b) => [b.id, ""])) };
      });
      // a saved variation no longer in the mix is switched off, never lost (it may have history)
      for (const old of prev) if (old.id && !next.some((r) => r.key === old.key)) next.push({ ...old, enabled: false });
      return next;
    });
    setStep("variations");
  };
  const goVariations = () => { if (validBasic()) buildRows(); };

  const canStock = (branchId: string) => role === "owner" || role === "super_admin" || (role === "manager" && branchId === myBranchId);
  const validBasic = () => {
    if (!basic.category_id) { toast.error("Choose a category."); return false; }
    if (!basic.name.trim()) { toast.error("Name the product."); return false; }
    if (!product && !prefix) { toast.error("This category has no base SKU yet. Set it on the Categories page first."); return false; }
    if (!product && allProducts === null) { toast.error("Still loading the products. Try again in a moment."); return false; }
    return true;
  };
  const goAttributes = () => { if (validBasic()) setStep("attributes"); };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const small = await imageCompression(file, { maxSizeMB: 0.4, maxWidthOrHeight: 1400, useWebWorker: true });
      const path = `${shop.id}/${crypto.randomUUID()}.jpg`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("product_images").upload(path, small, { contentType: "image/jpeg" });
      if (error) throw error;
      setBasic((b) => ({ ...b, image_url: supabase.storage.from("product_images").getPublicUrl(path).data.publicUrl }));
    } catch (e) {
      toast.error("Could not upload the photo: " + errorText(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!template) return toast.error("Choose a category.");
    const live = rows.filter((r) => r.enabled);
    if (!live.length) return toast.error("Keep at least one variation.");
    for (const r of live) if (num(r.rate || basic.rate) <= 0) return toast.error(`Enter the price per day of ${r.name || autoName(r.attributes)}.`);
    // saved variations always go (unticked = switched off); a new mix goes only when ticked
    const sent = rows.filter((r) => r.id || r.enabled);
    const skus = sent.map((r) => (r.sku || autoSku(r.attributes)).toUpperCase());
    if (new Set(skus).size !== skus.length) return toast.error("Two variations have the same SKU. Change one of them.");
    // a new or changed variation SKU follows the shop's pattern (a saved one that was not touched is left alone)
    const bad = skus.find((s, i) => !SKU_PATTERN.test(s) && s !== sent[i].savedSku);
    if (bad) return toast.error(`SKU ${bad} is not allowed: start with ${productSku}, then more parts after hyphens (e.g. ${productSku}-GOLD-M).`);
    setBusy(true);
    try {
      const id = await call<string>("save_product", {
        p: {
          id: product?.id, category_id: basic.category_id, name: basic.name, sku: productSku, description: basic.description, image_url: basic.image_url,
          purchase_price: product?.purchase_price ?? 0, replacement_value: num(basic.replacement_value), is_active: basic.is_active,
          variations: sent.map((r, i) => ({
            id: r.id, name: r.name.trim() || autoName(r.attributes), sku: skus[i], attributes: r.attributes,
            rates: { day: String(num(r.rate || basic.rate)) }, is_enabled: r.enabled,
          })),
        },
      });
      // the new pieces, numbered after the ones each variation already has
      const supabase = createClient();
      const { data: vars, error: vErr } = await supabase.from("product_variations").select("id, sku").eq("product_id", id);
      if (vErr) throw vErr;
      const { data: existing } = await supabase.from("units").select("code").eq("product_id", id).limit(5000);
      const used = new Set((existing ?? []).map((u) => u.code));
      const units: { shop_id: string; product_id: string; variation_id: string; branch_id: string; code: string; attributes: Record<string, string> }[] = [];
      sent.forEach((r, i) => {
        const v = (vars ?? []).find((x) => x.sku === skus[i]);
        if (!v || !r.enabled) return;
        for (const b of activeBranches) {
          const add = Math.max(0, Math.floor(num(r.stock[b.id])) - (r.id ? counts[`${r.id}:${b.id}`] ?? 0 : 0));
          for (let n = 1, made = 0; made < add; n++) {
            const code = `${v.sku}-${n}`;
            if (used.has(code)) continue;
            used.add(code);
            units.push({ shop_id: shop.id, product_id: id, variation_id: v.id, branch_id: b.id, code, attributes: r.attributes });
            made++;
          }
        }
      });
      if (units.length) {
        const { error } = await supabase.from("units").insert(units);
        if (error) throw new Error(error.code === "23505" ? "A piece code is already used. Save again to number them after it." : errorText(error));
      }
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      toast.success(units.length ? `Saved, with ${units.length} new piece${units.length === 1 ? "" : "s"}` : "Saved");
      if (!product) router.replace(`/catalog/${id}`);
      else onSaved?.();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!product || !confirm(`Remove ${product.name}? If it was ever rented it is switched off instead, so history stays.`)) return;
    try {
      const res = await call<{ result: string }>("delete_or_deactivate_product", { p_product_id: product.id });
      toast.success(res.result === "deleted" ? "Deleted" : "Switched off (it has rental history)");
      router.push("/catalog");
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const discard = () => {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    restored.current = false;
    setBasic({ category_id: wearCats[0]?.id ?? "", name: "", sku: "", rate: "", replacement_value: "", description: "", image_url: "", is_active: true });
    setAttrsRaw(template ? template.variation_fields.map((f) => ({ key: f.key, label: f.label, values: [] })) : []);
    setRows([]);
    setStep("basic");
  };

  const steps: [Step, string][] = [["basic", "Basic Info"], ["attributes", "Attributes"], ["variations", "Variations & Stock"]];
  const stepIndex = steps.findIndex(([k]) => k === step);

  return (
    <>
      <PageHeader title={product ? product.name : "Add New Product"}
        actions={<>
          {product && isOwner ? <button className={dangerButtonClass} onClick={remove}><Trash2 className="h-4 w-4" /> Remove</button> : null}
          {!product ? <button className={ghostButtonClass} onClick={discard}>Clear form</button> : null}
          <button className={goldButtonClass} disabled={busy} onClick={() => (step === "variations" ? void save() : step === "basic" ? goAttributes() : buildRows())}>
            {busy ? "Saving..." : step === "variations" ? (product ? "Save changes" : "Save product") : "Next"}
          </button>
        </>} />

      <ol className="mb-4 flex flex-wrap gap-2" aria-label="Steps">
        {steps.map(([k, label], i) => (
          <li key={k}>
            <button type="button" aria-current={step === k ? "step" : undefined}
              onClick={() => (i === 0 ? setStep("basic") : i === 1 ? goAttributes() : goVariations())}
              className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", step === k ? "border-gold/60 bg-gold/10 font-medium text-foreground" : "border-border text-muted-foreground")}>
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", i < stepIndex ? "bg-emerald text-white" : step === k ? "bg-gold text-white" : "bg-black/10")}>
                {i < stepIndex ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      {step === "basic" ? (
        <Panel>
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Product name"><input className={inputClass} autoFocus value={basic.name} onChange={(e) => setBasic({ ...basic, name: e.target.value })} placeholder="e.g. Kanjivaram silk saree" /></Field>
              <Field label="Category">
                <select className={inputClass} value={basic.category_id} onChange={(e) => setBasic({ ...basic, category_id: e.target.value })}>
                  {wearCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Base SKU" hint={prefix || product ? "From the category and numbered for you" : "This category has no base SKU yet (Categories page)"}>
                <input className={cn(monoInputClass, "cursor-not-allowed bg-surface opacity-70")} value={productSku} readOnly />
              </Field>
              <Field label="Price per day (₹)" hint="Starting price for every size; agree any price per booking">
                <input className={monoInputClass} inputMode="decimal" value={basic.rate} onChange={(e) => setBasic({ ...basic, rate: e.target.value })} />
              </Field>
              <Field label="Replacement value (₹)" hint="Charged if it is lost">
                <input className={monoInputClass} inputMode="decimal" value={basic.replacement_value} onChange={(e) => setBasic({ ...basic, replacement_value: e.target.value })} />
              </Field>
              <Field label="Description" className="sm:col-span-2"><textarea className={inputClass} rows={2} value={basic.description} onChange={(e) => setBasic({ ...basic, description: e.target.value })} /></Field>
            </div>
            <div>
              <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Photo</span>
              <label className="flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/30">
                {basic.image_url ? <img src={basic.image_url} alt="" className="h-full w-full object-cover" />
                  : <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground"><ImagePlus className="h-6 w-6" />{uploading ? "Uploading..." : "Add photo"}</span>}
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); }} />
              </label>
              {basic.image_url ? <button type="button" className="mt-1 text-xs text-muted-foreground hover:underline" onClick={() => setBasic({ ...basic, image_url: "" })}>Remove photo</button> : null}
            </div>
          </div>
        </Panel>
      ) : null}

      {step === "attributes" ? (
        <Panel title="Attributes" actions={<button type="button" className={ghostButtonClass} onClick={() => setAttrs([...attrs, { key: "", label: "", values: [] }])}><Plus className="h-4 w-4" /> Add attribute</button>}>
          <p className="mb-3 text-xs text-muted-foreground">Type each value and press Enter (for example sizes S, M, L and colours Red, Gold). Leave them empty for a product with one variation.</p>
          <ul className="space-y-3">
            {attrs.map((a, i) => (
              <li key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[180px_1fr_auto] sm:items-start">
                <AttributeName attr={a} locked={!!template?.variation_fields.some((f) => f.key === a.key)}
                  choices={[...(template?.variation_fields.map((f) => f.label) ?? []), ...EXTRA_ATTRIBUTES].filter((n, k, all) => all.indexOf(n) === k
                    && !attrs.some((x, j) => j !== i && x.label.toLowerCase() === n.toLowerCase()))}
                  onChange={(label) => setAttrs(attrs.map((x, j) => j === i ? { ...x, label, key: label.trim().toLowerCase().replace(/\s+/g, "_") } : x))} />
                <ChipInput values={a.values} label={a.label || "attribute"} suggestions={template?.variation_fields.find((f) => f.key === a.key)?.suggestions ?? []}
                  onChange={(values) => setAttrs(attrs.map((x, j) => j === i ? { ...x, values } : x))} />
                <button type="button" aria-label={`Remove ${a.label || "attribute"}`} className="rounded p-2 hover:bg-black/5" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">This makes <strong className="text-foreground">{combos(attrs.filter((a) => a.key)).length}</strong> variation{combos(attrs.filter((a) => a.key)).length === 1 ? "" : "s"}.</p>
        </Panel>
      ) : null}

      {step === "variations" ? (
        <Panel title={`Variations & stock (${rows.filter((r) => r.enabled).length})`}>
          <p className="mb-3 text-xs text-muted-foreground">How many pieces each branch holds. Each piece gets its own code, like {(rows[0]?.sku || autoSku(rows[0]?.attributes ?? {})) + "-1"}, for its QR tag.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-2">Variation</th><th className="py-2 pr-2">SKU</th><th className="py-2 pr-2">₹ / day</th>
                  {activeBranches.map((b) => <th key={b.id} className="py-2 pr-2">{b.name}</th>)}<th className="py-2">Bookable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={r.key + (r.id ?? "")} className={cn(!r.enabled && "opacity-50")}>
                    <td className="py-2 pr-2"><input className={cn(inputClass, "py-1.5")} aria-label="Variation name" value={r.name} placeholder={autoName(r.attributes)}
                      onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></td>
                    <td className="py-2 pr-2"><input className={cn(monoInputClass, "py-1.5 text-xs")} aria-label="Variation SKU" value={r.sku} placeholder={autoSku(r.attributes)}
                      onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, sku: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") } : x))} /></td>
                    <td className="py-2 pr-2"><input className={cn(monoInputClass, "w-24 py-1.5")} inputMode="decimal" aria-label="Price per day" value={r.rate} placeholder={basic.rate}
                      onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))} /></td>
                    {activeBranches.map((b) => {
                      const have = r.id ? counts[`${r.id}:${b.id}`] ?? 0 : 0;
                      return (
                        <td key={b.id} className="py-2 pr-2">
                          <input type="number" min={have} className={cn(monoInputClass, "w-20 py-1.5")} aria-label={`Pieces at ${b.name}`} disabled={!canStock(b.id) || !r.enabled}
                            value={r.stock[b.id] ?? ""} placeholder={String(have)}
                            onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, stock: { ...x.stock, [b.id]: e.target.value } } : x))} />
                          {have ? <span className="mt-0.5 block text-[10px] text-muted-foreground">has {have}</span> : null}
                        </td>
                      );
                    })}
                    <td className="py-2"><input type="checkbox" aria-label="Bookable" checked={r.enabled} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {product ? <p className="mt-3 text-xs text-muted-foreground">A number above what a branch has adds pieces. To remove a piece, use the Pieces list below.</p> : null}
        </Panel>
      ) : null}

      <div className="mt-4 flex justify-between">
        {stepIndex > 0 ? <button className={ghostButtonClass} onClick={() => setStep(steps[stepIndex - 1][0])}>Back</button> : <span />}
        <button className={goldButtonClass} disabled={busy} onClick={() => (step === "variations" ? void save() : step === "basic" ? goAttributes() : buildRows())}>
          {busy ? "Saving..." : step === "variations" ? (product ? "Save changes" : "Save product") : step === "basic" ? "Next: Attributes" : "Next: Variations & Stock"}
        </button>
      </div>
    </>
  );
}

// Names offered besides the business type's own attributes; "Custom..." lets the shop type its own.
const EXTRA_ATTRIBUTES = ["Fabric", "Fit", "Length", "Work", "Style", "Occasion"];

function AttributeName({ attr, locked, choices, onChange }: { attr: Attr; locked: boolean; choices: string[]; onChange: (label: string) => void }) {
  const known = choices.includes(attr.label);
  const [custom, setCustom] = useState(!!attr.label && !known);
  return (
    <div className="space-y-1.5">
      <select className={inputClass} aria-label="Attribute name" disabled={locked} value={locked || known ? attr.label : custom ? "__custom" : ""}
        onChange={(e) => { if (e.target.value === "__custom") { setCustom(true); onChange(""); } else { setCustom(false); onChange(e.target.value); } }}>
        {locked ? <option value={attr.label}>{attr.label}</option> : <>
          <option value="" disabled>Choose...</option>
          {choices.map((n) => <option key={n} value={n}>{n}</option>)}
          <option value="__custom">Custom...</option>
        </>}
      </select>
      {!locked && custom ? <input className={inputClass} aria-label="Custom attribute name" placeholder="e.g. Sleeve type" value={attr.label} onChange={(e) => onChange(e.target.value)} /> : null}
    </div>
  );
}

function ChipInput({ values, label, onChange, suggestions = [] }: { values: string[]; label: string; onChange: (v: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(",").map((s) => s.trim()).filter(Boolean).filter((s) => !values.includes(s));
    if (parts.length) onChange([...values, ...parts]);
    setText("");
  };
  const left = suggestions.filter((s) => !values.includes(s));
  return (
    <div>
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-xs">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}><X className="h-3 w-3" /></button>
        </span>
      ))}
      <input className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none" aria-label={`${label} values`} placeholder={values.length ? "Add another" : "Type a value, press Enter"}
        value={text} onChange={(e) => setText(e.target.value)} onBlur={add}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } else if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1)); }} />
    </div>
    {left.length ? (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Suggestions:</span>
        {left.map((s) => <button key={s} type="button" className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-black/5" onClick={() => onChange([...values, s])}>{s}</button>)}
      </div>
    ) : null}
    </div>
  );
}
