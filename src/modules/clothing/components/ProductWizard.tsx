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
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { useCatalog } from "@/lib/shop/useCatalog";
import { businessNameError, moneyError, textLimitError } from "@/lib/validate";
import { errorText, num, rupees } from "@/lib/shop/format";
import type { Product, Template, Unit } from "@/lib/shop/types";
import { SKU_PATTERN } from "../sku";
import { Field, Modal, PageHeader, Panel, dangerButtonClass, ghostButtonClass, goldButtonClass, inputClass, monoInputClass } from "@/components/shop/ui";

// Add New Product, as in TRENDZ: three steps on one page.
//   1. Basic info  2. Attributes (Colour, Size... with their values)  3. Variations & stock
// Step 3 makes one variation for every mix of the values, each with its price and how many pieces each
// branch holds; saving creates those pieces with their own codes (printable as QR tags).
// Changing a product uses the same form: pieces can be added here, and removed from the Pieces list.
interface Attr { key: string; label: string; values: string[] }
interface VarRow { id?: string; key: string; attributes: Record<string, string>; name: string; sku: string; savedSku?: string; rate: string; enabled: boolean; stock: Record<string, string> }
interface Basic {
  category_id: string; name: string; sku: string; rate: string; replacement_value: string; description: string; image_url: string; is_active: boolean;
  mrp: string; purchase_price: string; security_deposit: string;
  /** a new product's SKU typed by hand instead of numbered from the category */
  ownSku: boolean;
}
const money = (n: number | undefined) => (Number(n) ? String(n) : "");
// a typed product SKU follows the shop's pattern, as the database checks (migration 013): LH-101
const TYPED_SKU = /^[A-Z]{2,6}-[0-9]{3,4}$/;
type Step = "basic" | "attributes" | "variations";

const skuPart = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 16);
const comboKey = (a: Record<string, string>) => Object.keys(a).sort().map((k) => `${k}=${a[k]}`).join("|");

// One spelling for every value, so "blue", "Blue" and "BLUE" are the same: a suggestion keeps its own spelling (Royal Blue, XL),
// sizes are capitals (xl -> XL, 3xl -> 3XL, 32), anything else is Title Case.
function tidy(value: string, suggestions: string[]): string {
  const v = value.trim().replace(/\s+/g, " ");
  const known = suggestions.find((s) => s.toLowerCase() === v.toLowerCase());
  if (known) return known;
  if (/^(\d*x*[sml]|\d+)$/i.test(v)) return v.toUpperCase();
  return v.toLowerCase().replace(/(^|\s)(\S)/g, (_, sp: string, ch: string) => sp + ch.toUpperCase());
}
function tidyAll(values: string[], suggestions: string[]): string[] {
  const seen = new Set<string>();
  return values.map((v) => tidy(v, suggestions)).filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
}
// the business type's suggestions for an attribute, found by key or by name (any capitals)
function suggestionsFor(template: Template | undefined, a: { key: string; label: string }): string[] {
  const f = template?.variation_fields.find((x) => x.key === a.key || x.label.toLowerCase() === a.label.trim().toLowerCase());
  return f?.suggestions ?? [];
}

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
    category_id: product?.category_id ?? (wearCats.length === 1 ? wearCats[0].id : ""), name: product?.name ?? "", sku: product?.sku ?? "",
    rate: "", replacement_value: product ? String(product.replacement_value ?? "") : "", description: product?.description ?? "",
    image_url: product?.image_url ?? "", is_active: product?.is_active ?? true,
    mrp: money(product?.mrp), purchase_price: money(product?.purchase_price), security_deposit: money(product?.security_deposit), ownSku: false,
  }));
  const template = templateOf(basic.category_id);
  const [attrs, setAttrsRaw] = useState<Attr[]>([]);
  const [attrsTouched, setAttrsTouched] = useState(false);
  const setAttrs = (a: Attr[]) => { setAttrsRaw(a); setAttrsTouched(true); };
  const [rows, setRows] = useState<VarRow[]>([]);
  // mixes taken out by hand (Black / L does not exist): going back to the attributes does not bring them back
  const [dropped, setDropped] = useState<string[]>([]);
  // a saved variation that cannot be removed now (out with a customer, or booked): said before anything is asked
  const [blocked, setBlocked] = useState<{ label: string; out: string[]; booked: string[] } | null>(null);
  const askRemove = async (r: VarRow) => {
    if (!r.id) { setAsking({ kind: "variation", key: r.key }); return; }
    const supabase = createClient();
    const { data: lines } = await supabase.from("rental_lines").select("rental_id").eq("variation_id", r.id).limit(1000);
    const ids = Array.from(new Set((lines ?? []).map((l) => l.rental_id))).slice(0, 300);
    const out: string[] = []; const booked: string[] = [];
    if (ids.length) {
      const { data } = await supabase.from("rentals").select("token, status").in("id", ids).in("status", ["active", "reserved"]);
      for (const x of data ?? []) (x.status === "active" ? out : booked).push(x.token);
    }
    if (out.length || booked.length) setBlocked({ label: r.name || autoName(r.attributes), out, booked });
    else setAsking({ kind: "variation", key: r.key });
  };
  const [sameQty, setSameQty] = useState(false);
  const [askEmpty, setAskEmpty] = useState(false);
  // the "Remove ...?" card: a variation row (by its key) or the whole product
  const [asking, setAsking] = useState<{ kind: "variation"; key: string } | { kind: "product" } | null>(null);
  const [bulk, setBulk] = useState<Record<string, string>>({});
  const restored = useRef(false);

  // A shop with one category starts on it; with several the person chooses. The setup may load after the form opens, and a
  // saved draft may name a category that is gone: either way the form never holds a category that is not in the list.
  const onlyCatId = wearCats.length === 1 ? wearCats[0].id : "";
  const catValid = wearCats.some((c) => c.id === basic.category_id);
  useEffect(() => {
    if (product || catValid) return;
    if (basic.category_id || onlyCatId) setBasic((b) => ({ ...b, category_id: onlyCatId }));
  }, [product, onlyCatId, catValid, basic.category_id]);

  // fields of the business type (Colour, Size) come first; existing values when changing a product
  useEffect(() => {
    if (restored.current || !template) return;
    restored.current = true;
    if (!product) {
      try {
        const saved = localStorage.getItem(draftKey);
        if (saved) {
          const d = JSON.parse(saved) as { basic: Basic; attrs: Attr[]; rows: VarRow[] };
          // a draft saved before the money fields existed has no values for them
          setBasic((b) => ({ ...b, ...d.basic, mrp: d.basic.mrp ?? "", purchase_price: d.basic.purchase_price ?? "", security_deposit: d.basic.security_deposit ?? "", ownSku: !!d.basic.ownSku })); setRows(d.rows);
          setAttrsRaw(d.attrs.map((a) => ({ ...a, values: tidyAll(a.values, suggestionsFor(template, a)) })));
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
  const typedSku = basic.sku.trim().toUpperCase();
  const productSku = product ? product.sku : basic.ownSku ? typedSku : nextSku;
  const autoName = (a: Record<string, string>) => Object.values(a).filter(Boolean).join(" / ") || basic.name.trim() || "Standard";
  const autoSku = (a: Record<string, string>) => `${productSku}${Object.values(a).filter(Boolean).length ? "-" + skuPart(Object.values(a).filter(Boolean).join("-")) : ""}`;

  // step 3 rows: one per mix of values; existing variations keep their place, new mixes are added
  const buildRows = () => {
    // changing a product: its variations stay as they are unless the attributes were changed
    if (product && !attrsTouched) { setStep("variations"); return; }
    const wanted = combos(attrs.filter((a) => a.key)).filter((a) => !dropped.includes(comboKey(a)));
    setRows((prev) => {
      const byKey = new Map(prev.map((r) => [r.key, r]));
      const next: VarRow[] = wanted.map((a) => {
        const k = comboKey(a);
        // a new mix starts ticked, with its piece counts empty; the stock step says which saved ones were switched off
        return byKey.get(k) ?? { key: k, attributes: a, name: "", sku: "", rate: basic.rate, enabled: true, stock: Object.fromEntries(activeBranches.map((b) => [b.id, ""])) };
      });
      // a saved variation no longer in the mix is switched off, never lost (it may have history)
      for (const old of prev) if (old.id && !next.some((r) => r.key === old.key)) next.push({ ...old, enabled: false });
      return next;
    });
    setStep("variations");
  };
  const goVariations = () => { if (validBasic()) buildRows(); };

  const canStock = (branchId: string) => role === "owner" || role === "super_admin" || (role === "manager" && branchId === myBranchId);
  // "same quantity for every variation": one number per branch, never below the pieces a variation already has there
  const stockOf = (r: VarRow, branchId: string): string => {
    const n = bulk[branchId];
    if (!sameQty || !canStock(branchId) || n === undefined || n === "") return r.stock[branchId] ?? "";
    return String(Math.max(Math.floor(num(n)), r.id ? counts[`${r.id}:${branchId}`] ?? 0 : 0));
  };
  const setSame = (on: boolean) => {
    // switching it off keeps the numbers it had filled in, so they can be changed one by one
    if (!on) setRows((rs) => rs.map((r) => ({ ...r, stock: Object.fromEntries(activeBranches.map((b) => [b.id, stockOf(r, b.id)])) })));
    setSameQty(on);
  };
  // what is wrong on the first step; shown under a field once it has been left, and for all of them after Next is pressed
  const [triedBasic, setTriedBasic] = useState(false);
  const basicErr = {
    category: basic.category_id ? null : "Choose a category.",
    name: businessNameError(basic.name, "product name", 80),
    rate: moneyError(basic.rate, { label: "price per day", required: true, positive: true, max: 1_000_000 }),
    replacement: moneyError(basic.replacement_value, { label: "replacement value", max: 10_000_000 }),
    mrp: moneyError(basic.mrp, { label: "MRP", max: 10_000_000 }),
    purchase: moneyError(basic.purchase_price, { label: "purchase price", max: 10_000_000 }),
    deposit: moneyError(basic.security_deposit, { label: "security deposit", max: 1_000_000 }),
    description: textLimitError(basic.description, "description", 500),
    sku: product || !basic.ownSku ? null
      : !typedSku ? "Type the SKU, or switch back to numbering it for you."
      : !TYPED_SKU.test(typedSku) ? "Use 2 to 6 letters, a hyphen, then 3 or 4 digits, e.g. LH-101."
      : (allProducts ?? []).some((p) => p.sku.toUpperCase() === typedSku) ? `${typedSku} is already used by another product.`
      : null,
  };
  const showBasic = (k: keyof typeof basicErr, typed: string) => (triedBasic || typed.trim() ? basicErr[k] ?? undefined : undefined);
  const validBasic = () => {
    setTriedBasic(true);
    const first = Object.values(basicErr).find(Boolean);
    if (first) { toast.error(first); return false; }
    if (!basic.category_id) { toast.error("Choose a category."); return false; }
    if (!basic.name.trim()) { toast.error("Name the product."); return false; }
    if (!product && !basic.ownSku && !prefix) { toast.error("This category has no base SKU yet. Set it on the Categories page, or type your own SKU."); return false; }
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

  const save = async (confirmedEmpty = false) => {
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
    // no pieces anywhere would leave a product that can never show as free: ask first
    const pieces = live.reduce((n, r) => n + activeBranches.reduce((m, b) => m + Math.max(Math.floor(num(stockOf(r, b.id))), r.id ? counts[`${r.id}:${b.id}`] ?? 0 : 0), 0), 0);
    if (!pieces && !confirmedEmpty) { setAskEmpty(true); return; }
    setBusy(true);
    try {
      const id = await call<string>("save_product", {
        p: {
          id: product?.id, category_id: basic.category_id, name: basic.name, sku: productSku, description: basic.description, image_url: basic.image_url,
          purchase_price: num(basic.purchase_price), replacement_value: num(basic.replacement_value), is_active: basic.is_active,
          mrp: num(basic.mrp), security_deposit: num(basic.security_deposit),
          variations: sent.map((r, i) => ({
            id: r.id, name: r.name.trim() || autoName(r.attributes), sku: skus[i], attributes: r.attributes,
            rates: { day: String(num(r.rate || basic.rate)) }, is_enabled: r.enabled,
            stock: Object.fromEntries(activeBranches.map((b) => [b.id, Math.max(0, Math.floor(num(stockOf(r, b.id))))])),
          })),
        },
      });
      // the pieces were made by the database in the same step, numbered after the ones each variation already has
      const made = sent.reduce((n, r) => n + (r.enabled ? activeBranches.reduce((m, b) =>
        m + Math.max(0, Math.floor(num(stockOf(r, b.id))) - (r.id ? counts[`${r.id}:${b.id}`] ?? 0 : 0)), 0) : 0), 0);
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      toast.success(made ? `Saved, with ${made} new piece${made === 1 ? "" : "s"}` : "Saved");
      void id;
      // back to the product list, as in TRENDZ
      router.push("/catalog");
      onSaved?.();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!product) return;
    setAsking(null);
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
    setBasic({ category_id: wearCats.length === 1 ? wearCats[0].id : "", name: "", sku: "", rate: "", replacement_value: "", description: "", image_url: "", is_active: true,
      mrp: "", purchase_price: "", security_deposit: "", ownSku: false });
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
          {product && isOwner ? <button className={dangerButtonClass} onClick={() => setAsking({ kind: "product" })}><Trash2 className="h-4 w-4" /> Remove</button> : null}
          {!product ? <button className={ghostButtonClass} onClick={discard}>Clear form</button> : null}
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
              <Field label="Product name" error={showBasic("name", basic.name)}><input className={inputClass} autoFocus maxLength={80} value={basic.name} onChange={(e) => setBasic({ ...basic, name: e.target.value })} placeholder="e.g. Kanjivaram silk saree" /></Field>
              <Field label="Category">
                <select className={inputClass} value={basic.category_id} onChange={(e) => setBasic({ ...basic, category_id: e.target.value })}>
                  {basic.category_id ? null : <option value="" disabled>Choose a category...</option>}
                  {wearCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <div>
              <Field label="Base SKU" error={showBasic("sku", basic.sku)}
                hint={product ? "A saved product keeps its SKU" : basic.ownSku ? "2 to 6 letters, a hyphen, 3 or 4 digits, e.g. LH-101" : prefix ? "From the category and numbered for you" : "This category has no base SKU yet (Categories page)"}>
                {basic.ownSku && !product ? (
                  <input className={monoInputClass} maxLength={40} value={basic.sku} placeholder="e.g. LH-101" aria-label="Your own SKU"
                    onChange={(e) => setBasic({ ...basic, sku: e.target.value.toUpperCase().replace(/\s+/g, "-") })} />
                ) : (
                  <input className={cn(monoInputClass, "cursor-default bg-muted/50 font-medium text-foreground")} value={productSku} readOnly aria-readonly="true" />
                )}
              </Field>
              {product ? null : (
                <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={basic.ownSku} onChange={(e) => setBasic({ ...basic, ownSku: e.target.checked, sku: e.target.checked ? basic.sku : "" })} />
                  Type my own SKU
                </label>
              )}
              </div>
              <Field label="Price per day (₹)" hint="Starting price for every size; agree any price per booking" error={showBasic("rate", basic.rate)}>
                <input className={monoInputClass} inputMode="decimal" value={basic.rate}
                  // one price for every size and colour: changing it here changes it on every variation
                  onChange={(e) => { setBasic({ ...basic, rate: e.target.value }); setRows((rs) => rs.map((r) => ({ ...r, rate: e.target.value }))); }} />
              </Field>
              <Field label="Replacement value (₹)" hint="Charged if it is lost" error={showBasic("replacement", basic.replacement_value)}>
                <input className={monoInputClass} inputMode="decimal" value={basic.replacement_value} onChange={(e) => setBasic({ ...basic, replacement_value: e.target.value })} />
              </Field>
              <Field label="Security deposit (₹)" hint="Filled in on the bill for each piece; can be changed there" error={showBasic("deposit", basic.security_deposit)}>
                <input className={monoInputClass} inputMode="decimal" placeholder="0" value={basic.security_deposit} onChange={(e) => setBasic({ ...basic, security_deposit: e.target.value })} />
              </Field>
              <Field label="MRP (₹)" hint="Its selling price, for your records" error={showBasic("mrp", basic.mrp)}>
                <input className={monoInputClass} inputMode="decimal" placeholder="0" value={basic.mrp} onChange={(e) => setBasic({ ...basic, mrp: e.target.value })} />
              </Field>
              <Field label="Purchase price (₹)" hint="What you paid; shows when it has earned itself back" error={showBasic("purchase", basic.purchase_price)}>
                <input className={monoInputClass} inputMode="decimal" placeholder="0" value={basic.purchase_price} onChange={(e) => setBasic({ ...basic, purchase_price: e.target.value })} />
              </Field>
              <Field label="Description" className="sm:col-span-2" error={showBasic("description", basic.description)}><textarea className={inputClass} rows={2} maxLength={520} value={basic.description} onChange={(e) => setBasic({ ...basic, description: e.target.value })} /></Field>
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
                <AttributeName attr={a} locked={!!template?.variation_fields.some((f) => f.key === a.key || f.label.toLowerCase() === a.label.trim().toLowerCase())}
                  choices={[...(template?.variation_fields.map((f) => f.label) ?? []), ...EXTRA_ATTRIBUTES].filter((n, k, all) => all.indexOf(n) === k
                    && !attrs.some((x, j) => j !== i && x.label.toLowerCase() === n.toLowerCase()))}
                  onChange={(label) => setAttrs(attrs.map((x, j) => j === i ? { ...x, label, key: label.trim().toLowerCase().replace(/\s+/g, "_") } : x))} />
                <ChipInput values={a.values} label={a.label || "attribute"} suggestions={suggestionsFor(template, a)}
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
          {product && attrsTouched && rows.some((r) => r.id && !r.enabled) ? (
            <p className="mb-3 rounded-md border border-gold/40 bg-gold/10 p-2.5 text-sm text-foreground">
              Switched off, because they are not in the attributes any more: <strong>{rows.filter((r) => r.id && !r.enabled).map((r) => r.name || autoName(r.attributes)).join(", ")}</strong>. Their pieces and history stay. New variations below start ticked: enter how many pieces each branch holds.
            </p>
          ) : null}
          <p className="mb-3 text-xs text-muted-foreground">How many pieces each branch holds. Each piece gets its own code, like {(rows[0]?.sku || autoSku(rows[0]?.attributes ?? {})) + "-1"}, for its QR tag.</p>
          <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={sameQty} onChange={(e) => setSame(e.target.checked)} />
              Same quantity for every variation
            </label>
            {sameQty ? (
              <div className="mt-3 flex flex-wrap gap-3">
                {activeBranches.filter((b) => canStock(b.id)).map((b) => (
                  <label key={b.id} className="text-sm">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">Pieces of each at {b.name}</span>
                    <input type="number" min={0} className={cn(monoInputClass, "w-28")} aria-label={`Same quantity at ${b.name}`} value={bulk[b.id] ?? ""}
                      onChange={(e) => setBulk({ ...bulk, [b.id]: e.target.value })} />
                  </label>
                ))}
                {product ? <p className="w-full text-xs text-muted-foreground">A variation that already has more pieces keeps them: stock only goes up here.</p> : null}
              </div>
            ) : <p className="mt-1 text-xs text-muted-foreground">Tick to give every variation the same number of pieces in a branch. Leave it unticked to type each one.</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-2">Variation</th><th className="py-2 pr-2">SKU</th><th className="py-2 pr-2">₹ / day</th>
                  {activeBranches.map((b) => <th key={b.id} className="py-2 pr-2">{b.name}</th>)}<th className="py-2 pr-2">Bookable</th><th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={r.key + (r.id ?? "")}>
                    {/* name, code and price follow from the attributes and Basic Info: shown, not typed */}
                    <td className={cn("py-2 pr-2 text-sm font-medium text-foreground", !r.enabled && "opacity-50")}>{r.name || autoName(r.attributes)}</td>
                    <td className={cn("py-2 pr-2 font-mono text-xs text-foreground", !r.enabled && "opacity-50")}>{r.sku || autoSku(r.attributes)}</td>
                    <td className={cn("py-2 pr-2 font-mono text-sm text-foreground", !r.enabled && "opacity-50")}>{rupees(num(r.rate || basic.rate))}</td>
                    {activeBranches.map((b) => {
                      const have = r.id ? counts[`${r.id}:${b.id}`] ?? 0 : 0;
                      return (
                        <td key={b.id} className={cn("py-2 pr-2", !r.enabled && "opacity-50")}>
                          <input type="number" min={have} className={cn(monoInputClass, "w-20 py-1.5")} aria-label={`Pieces at ${b.name}`} disabled={!canStock(b.id) || !r.enabled || (sameQty && bulk[b.id] !== undefined && bulk[b.id] !== "")}
                            value={stockOf(r, b.id)} placeholder={have ? String(have) : "qty"}
                            onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, stock: { ...x.stock, [b.id]: e.target.value } } : x))} />
                          {have ? <span className="mt-1 block whitespace-nowrap text-[11px] text-muted-foreground">Current stock: <strong className="font-semibold text-foreground">{have}</strong></span> : null}
                        </td>
                      );
                    })}
                    <td className="py-2 pr-2"><input type="checkbox" aria-label="Bookable" checked={r.enabled} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))} /></td>
                    <td className="py-2 text-right">
                      <button type="button" aria-label={`Remove ${r.name || autoName(r.attributes)}`} className="inline-flex items-center gap-1 rounded-full border border-rust/40 px-3 py-1 text-xs font-medium text-rust hover:bg-rust/10"
                        onClick={() => void askRemove(r)}><Trash2 className="h-3.5 w-3.5" /> Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {product ? <p className="mt-3 text-xs text-muted-foreground">A number above what a branch has adds pieces. To remove a piece, use the Pieces list below.</p> : null}
        </Panel>
      ) : null}

      {(() => {
        const row = asking?.kind === "variation" ? rows.find((x) => x.key === asking.key) : undefined;
        const label = row ? row.name || autoName(row.attributes) : "";
        const have = row?.id ? activeBranches.reduce((n, br) => n + (counts[`${row.id}:${br.id}`] ?? 0), 0) : 0;
        const takeOut = () => {
          if (!row) return;
          setDropped((d) => [...d, row.key]);
          setRows((rs) => rs.filter((x) => x.key !== row.key));
          setAsking(null);
        };
        return (
          <Modal open={asking?.kind === "product" || !!row} onClose={() => setAsking(null)}
            title={asking?.kind === "product" ? `Remove ${product?.name ?? "this product"}?` : `Remove ${label}?`}
            description={asking?.kind === "product" ? "The product and all its variations and pieces are removed." : "This variation is taken out of the product."}
            footer={<>
              <button className={ghostButtonClass} onClick={() => setAsking(null)}>Keep it</button>
              <button className={dangerButtonClass} onClick={asking?.kind === "product" ? () => void remove() : takeOut}><Trash2 className="h-4 w-4" /> {asking?.kind === "product" ? "Remove product" : "Remove variation"}</button>
            </>}>
            <ul className="space-y-2 text-sm">
              {asking?.kind === "variation" && have ? <li className="rounded-lg bg-rust/10 p-3 text-rust">Its {have} piece{have === 1 ? "" : "s"} will be removed too.</li> : null}
              {asking?.kind === "product" ? <li className="rounded-lg bg-accent/60 p-3 text-muted-foreground">If it was ever rented it is switched off instead of deleted, so booking history stays correct.</li> : null}
              {row?.id ? <li className="rounded-lg bg-accent/60 p-3 text-muted-foreground">If it has booking history it is archived: it disappears from your lists, and the old bookings and the ledger keep their record. Adding the same variation again brings it back.</li> : null}
              {asking?.kind === "variation" && row?.id ? <li className="text-xs text-muted-foreground">It is removed when you press Save changes.</li> : null}
            </ul>
          </Modal>
        );
      })()}
      <Modal open={blocked !== null} onClose={() => setBlocked(null)} title={`Can't remove ${blocked?.label ?? "this variation"}`}
        description="It is still part of an open booking."
        footer={<button className={goldButtonClass} onClick={() => setBlocked(null)}>OK</button>}>
        <ul className="space-y-2 text-sm">
          {blocked?.out.length ? <li className="rounded-lg bg-rust/10 p-3 text-rust">It is out with a customer on <strong>{blocked.out.join(", ")}</strong>. Take it back first, then remove it.</li> : null}
          {blocked?.booked.length ? <li className="rounded-lg bg-amber/15 p-3 text-amber">It is booked on <strong>{blocked.booked.join(", ")}</strong>. Finish or cancel those bookings first.</li> : null}
        </ul>
      </Modal>
      <ConfirmDialog open={askEmpty} confirmLabel="Save anyway" message={"No pieces were added.\n\nWithout pieces nobody can book this product. Save it anyway?"}
        onCancel={() => setAskEmpty(false)} onConfirm={() => { setAskEmpty(false); void save(true); }} />
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
  // the type's own attributes (Colour, Size) are plain bold text; others are chosen or typed
  if (locked) return <div className="flex min-h-10 items-center text-sm font-semibold text-foreground">{attr.label}</div>;
  return (
    <div className="space-y-1.5">
      <select className={inputClass} aria-label="Attribute name" value={known ? attr.label : custom ? "__custom" : ""}
        onChange={(e) => { if (e.target.value === "__custom") { setCustom(true); onChange(""); } else { setCustom(false); onChange(e.target.value); } }}>
        <option value="" disabled>Choose...</option>
        {choices.map((n) => <option key={n} value={n}>{n}</option>)}
        <option value="__custom">Custom...</option>
      </select>
      {!locked && custom ? <input className={inputClass} aria-label="Custom attribute name" placeholder="e.g. Sleeve type" value={attr.label} onChange={(e) => onChange(e.target.value)} /> : null}
    </div>
  );
}

function ChipInput({ values, label, onChange, suggestions = [] }: { values: string[]; label: string; onChange: (v: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = useState("");
  const add = () => {
    // only the new values are tidied; saved ones keep their spelling (their variations are keyed by it)
    const have = new Set(values.map((v) => v.toLowerCase()));
    const fresh = tidyAll(text.split(","), suggestions).filter((v) => !have.has(v.toLowerCase()));
    if (fresh.length) onChange([...values, ...fresh]);
    setText("");
  };
  const lower = new Set(values.map((v) => v.toLowerCase()));
  const left = suggestions.filter((s) => !lower.has(s.toLowerCase()));
  return (
    <div>
    <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-input bg-white px-2 py-1.5">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1.5 rounded-full border border-gold/60 bg-gold/15 px-3 py-1 text-sm font-medium text-foreground">
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
        <span className="text-sm font-medium text-foreground">Suggestions:</span>
        {left.map((s) => <button key={s} type="button" className="rounded-md border border-border bg-white px-2.5 py-1 text-sm text-foreground hover:bg-black/5" onClick={() => onChange([...values, s])}>{s}</button>)}
      </div>
    ) : null}
    </div>
  );
}
