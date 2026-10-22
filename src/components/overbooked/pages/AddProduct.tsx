import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Plus, X, Trash2, ArrowLeft } from "lucide-react";
import { useOverbooked } from "@/lib/overbooked/store";
import type { Product, ProductAttribute, ProductVariation } from "@/lib/overbooked/types";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { ConfirmDialog } from "../ConfirmDialog";
import { Field, goldButtonClass, inputClass, monoInputClass } from "../primitives";
import imageCompression from "browser-image-compression";
import { validateProductSku } from "@/lib/overbooked/utils";

type Tab = "basic" | "attributes" | "variations";

const STANDARD_ATTRIBUTES = [
  "Color",
  "Size"
];

const STANDARD_SUGGESTIONS: Record<string, string[]> = {
  "Color": ["Black", "White", "Royal Blue", "Maroon", "Wine", "Off White", "Beige", "Navy Blue", "Gold", "Silver"],
  "Size": ["XS", "S", "M", "L", "XL", "XXL", "3XL", "28", "30", "32", "34", "36", "38", "40", "42"],
};

const titleCase = (str: string) => {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const formatAttributeValue = (name: string, val: string) => {
  if (!val) return val;
  const trimmed = val.trim();
  if (name === "Color") {
    return titleCase(trimmed);
  }
  if (name === "Size") {
    if (/^([a-z]+|\d+[a-z]+)$/i.test(trimmed)) {
      return trimmed.toUpperCase();
    }
    return trimmed;
  }
  return titleCase(trimmed);
};

export function AddProduct({
  productToEditId,
  initialCategory,
  onClose,
}: {
  productToEditId?: string | null;
  initialCategory?: string;
  onClose: () => void;
}) {
  const { products, categories, branches, createProduct, updateProduct, locations } = useOverbooked();
  const { profile, isLoading: isAuthLoading } = useAuth();
  const branchesToRender = profile?.role === "manager"
    ? branches.filter(b => locations.find(l => l.name === b)?.id === profile.branch_id)
    : branches;

  const productToEdit = productToEditId ? products.find(p => p.id === productToEditId) : null;

  const [tab, setTab] = useState<Tab>("basic");
  const [error, setError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [dailyRate, setDailyRate] = useState(0);
  const [purchasePrice, setPurchasePrice] = useState(0);
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [attributes, setAttributes] = useState<ProductAttribute[]>([]);
  const [variations, setVariations] = useState<ProductVariation[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  const [draftStatus, setDraftStatus] = useState<"Saving…" | "Draft saved" | "Could not save draft" | "">("");
  const [draftExists, setDraftExists] = useState(false);
  const draftKey = profile?.id ? `overbooked_draft_product_${profile.id}` : null;
  const [hasRestoredFor, setHasRestoredFor] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const prevCategoryRef = useRef<string | null>(null);
  const isSubmittingRef = useRef(false);
  const hasSuccessfullySubmittedRef = useRef(false);
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const draftSessionIdRef = useRef<number>(1);
  const [sessionTick, setSessionTick] = useState(0);

  useEffect(() => {
    if (productToEdit) {
      setName(productToEdit.name ?? "");
      setSku(productToEdit.sku ?? "");
      setCategory(productToEdit.category || "");
      setDailyRate(productToEdit.dailyRate);
      setPurchasePrice(productToEdit.purchasePrice || 0);
      setDescription(productToEdit.description || "");
      setImage(productToEdit.image);
      setAttributes(productToEdit.attributes || []);
      setVariations(productToEdit.variations || []);
      setTab("basic");
      setError("");
      setIsInitialized(true);
      setHasRestoredFor("edit");
    } else {
      if (isAuthLoading || !profile?.id) return;
      if (hasRestoredFor === profile.id) return;

      let draftLoaded = false;
      if (draftKey) {
        try {
          const stored = localStorage.getItem(draftKey);
          if (stored) {
            if (stored.length > 500000) throw new Error("Draft payload too large");
            const parsed = JSON.parse(stored);
            if (parsed && typeof parsed === 'object' && parsed.version === 1) {
              if (!["basic", "attributes", "variations"].includes(parsed.tab)) throw new Error("Invalid tab");
              if (typeof parsed.name !== 'string') throw new Error("Invalid name");
              if (typeof parsed.category !== 'string') throw new Error("Invalid category");
              if (typeof parsed.sku !== 'string') throw new Error("Invalid sku");
              if (typeof parsed.dailyRate !== 'number' || !Number.isFinite(parsed.dailyRate) || parsed.dailyRate < 0) throw new Error("Invalid dailyRate");
              if (typeof parsed.purchasePrice !== 'number' || !Number.isFinite(parsed.purchasePrice) || parsed.purchasePrice < 0) throw new Error("Invalid purchasePrice");
              if (typeof parsed.description !== 'string') throw new Error("Invalid description");
              if (typeof parsed.image !== 'string') throw new Error("Invalid image");

              const safeTab = parsed.tab;
              const safeName = parsed.name.substring(0, 200);
              const safeCategory = parsed.category;
              const safeSku = parsed.sku.substring(0, 50);
              const safeDailyRate = parsed.dailyRate;
              const safePurchasePrice = parsed.purchasePrice;
              const safeDescription = parsed.description.substring(0, 5000);
              const safeImage = parsed.image;
              
              if (!Array.isArray(parsed.attributes)) throw new Error("Attributes must be an array");
              const safeAttributes = parsed.attributes.map((a: any) => {
                if (!a || typeof a.name !== 'string' || !Array.isArray(a.values)) throw new Error("Invalid attribute");
                return {
                  name: a.name.substring(0, 50),
                  values: a.values.map((v: any) => {
                    if (typeof v !== 'string') throw new Error("Invalid attribute value");
                    return v.substring(0, 50);
                  })
                };
              });
                
              if (!Array.isArray(parsed.variations)) throw new Error("Variations must be an array");
              const safeVariations = parsed.variations.map((v: any) => {
                if (!v || typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.sku !== 'string') throw new Error("Invalid variation core fields");
                if (typeof v.dailyRate !== 'number' || !Number.isFinite(v.dailyRate) || v.dailyRate < 0) throw new Error("Invalid variation dailyRate");
                if (typeof v.enabled !== 'boolean') throw new Error("Invalid variation enabled flag");
                
                if (typeof v.stock !== 'object' || v.stock === null || Array.isArray(v.stock)) throw new Error("Invalid stock");
                const safeStock: Record<string, number> = {};
                for (const [k, val] of Object.entries(v.stock)) {
                  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) throw new Error("Invalid stock value");
                  safeStock[k] = val;
                }
                
                if (typeof v.attributes !== 'object' || v.attributes === null || Array.isArray(v.attributes)) throw new Error("Invalid attributes");
                const safeAttr: Record<string, string> = {};
                for (const [k, val] of Object.entries(v.attributes)) {
                  if (typeof val !== 'string') throw new Error("Invalid attribute value");
                  safeAttr[k] = val;
                }

                return {
                  id: v.id,
                  name: v.name.substring(0, 200),
                  sku: v.sku.substring(0, 50),
                  dailyRate: v.dailyRate,
                  stock: safeStock,
                  attributes: safeAttr,
                  enabled: v.enabled,
                };
              });

              setTab(safeTab as Tab);
              setName(safeName);
              setCategory(safeCategory);
              prevCategoryRef.current = safeCategory;
              setSku(safeSku);
              setDailyRate(safeDailyRate);
              setPurchasePrice(safePurchasePrice);
              setDescription(safeDescription);
              setImage(safeImage);
              setAttributes(safeAttributes);
              setVariations(safeVariations);
              setDraftExists(true);
              toast.success("Draft restored from your previous session.");
              draftLoaded = true;
            } else {
              throw new Error("Invalid draft structure or version");
            }
          }
        } catch (e) {
          console.error("Failed to load draft safely:", e);
          localStorage.removeItem(draftKey);
        }
      }

      if (!draftLoaded) {
        setName("");
        setSku("");
        setCategory(initialCategory || "");
        prevCategoryRef.current = initialCategory || "";
        setDailyRate(0);
        setPurchasePrice(0);
        setDescription("");
        setImage("");
        setAttributes([]);
        setVariations([]);
        setTab("basic");
      }
      setError("");
      setHasRestoredFor(profile.id);
      setIsInitialized(true);
    }
  }, [productToEdit, initialCategory, draftKey, isAuthLoading, profile?.id, hasRestoredFor]);

  const startNewSession = useCallback(() => {
    draftSessionIdRef.current += 1;
    hasSuccessfullySubmittedRef.current = false;
    isSubmittingRef.current = false;
    setSessionTick(t => t + 1);
  }, []);

  const resetFormSession = useCallback(() => {
    setName("");
    setSku("");
    setCategory(initialCategory || "");
    if (prevCategoryRef) prevCategoryRef.current = initialCategory || "";
    setDailyRate(0);
    setPurchasePrice(0);
    setDescription("");
    setImage("");
    setAttributes([]);
    setVariations([]);
    setTab("basic");
    setError("");
    setIsUploading(false);
  }, [initialCategory]);

  useEffect(() => {
    if (productToEdit || !isInitialized || !draftKey) return;

    const activeSessionId = draftSessionIdRef.current;

    autosaveTimerRef.current = setTimeout(() => {
      if (activeSessionId !== draftSessionIdRef.current) return;
      
      const isFormUntouched = !name && !description && !image && attributes.length === 0 && variations.length === 0 && dailyRate === 0 && purchasePrice === 0 && (!category || category === initialCategory);
      
      if (hasSuccessfullySubmittedRef.current) {
        if (!isFormUntouched) {
          startNewSession();
          return;
        } else {
          return;
        }
      }

      if (isSubmittingRef.current) return;
      
      if (isFormUntouched) {
        if (draftExists) {
          localStorage.removeItem(draftKey);
          setDraftExists(false);
          setDraftStatus("");
        }
        return;
      }
      
      setDraftStatus("Saving…");
      try {
        const draft = {
          version: 1,
          timestamp: Date.now(),
          tab,
          name,
          sku,
          category,
          dailyRate,
          purchasePrice,
          description,
          image,
          attributes,
          variations,
        };
        const serialized = JSON.stringify(draft);
        if (serialized.length > 500000) throw new Error("Draft payload too large");
        localStorage.setItem(draftKey, serialized);
        setDraftStatus("Draft saved");
        setDraftExists(true);
      } catch (e) {
        setDraftStatus("Could not save draft");
        console.error(e);
      }
    }, 1000);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [name, sku, category, dailyRate, purchasePrice, description, image, attributes, variations, tab, productToEdit, draftKey, isInitialized, draftExists, initialCategory, startNewSession, sessionTick]);

  useEffect(() => {
    if (productToEdit) return;
    if (!category.trim()) return;
    if (!isInitialized) return;

    if (prevCategoryRef.current === category && sku !== "") return;
    prevCategoryRef.current = category;

    const selectedCat = categories.find(c => c.name === category);
    let prefix = selectedCat?.base_sku || "";

    if (!prefix) {
      const categoryLower = category.trim().toLowerCase();
      prefix = categoryLower.replace(/[^a-z]/gi, '').substring(0, 3).toUpperCase();
      if (prefix.length < 3) prefix = prefix.padEnd(3, 'X');
      if (!prefix) prefix = "PRD";
    }

    const categoryProducts = products.filter(p => (p.category || "").toLowerCase() === category.trim().toLowerCase());

    let maxNum = 0;
    categoryProducts.forEach((p) => {
      const productSku = typeof p.sku === "string" ? p.sku : "";

      if (!productSku) return;

      if (productSku.startsWith(`${prefix}-`)) {
        const numPart = productSku.substring(prefix.length + 1);
        const num = parseInt(numPart, 10);

        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });

    const nextNum = String(maxNum + 1).padStart(3, '0');
    setSku(`${prefix}-${nextNum}`);
  }, [category, products, productToEdit, categories, isInitialized, sku]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const activeSessionId = draftSessionIdRef.current;
      setIsUploading(true);
      try {
        const options = {
          maxSizeMB: 0.1, // Max 100KB
          maxWidthOrHeight: 1024,
          useWebWorker: true,
        };
        const compressedFile = await imageCompression(file, options);
        if (activeSessionId !== draftSessionIdRef.current) return;

        const fileExt = file.name.split('.').pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;

        const { error } = await supabase.storage
          .from('product_images')
          .upload(fileName, compressedFile);

        if (activeSessionId !== draftSessionIdRef.current) return;
        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage
          .from('product_images')
          .getPublicUrl(fileName);

        if (activeSessionId !== draftSessionIdRef.current) return;
        setImage(publicUrl);
      } catch (err: any) {
        if (activeSessionId !== draftSessionIdRef.current) return;
        toast.error("Failed to upload image");
        console.error(err);
      } finally {
        if (activeSessionId === draftSessionIdRef.current) {
          setIsUploading(false);
        }
      }
    }
  };

  const addAttribute = () => {
    setAttributes([...attributes, { name: "", values: [] }]);
  };

  const updateAttribute = (index: number, key: keyof ProductAttribute, value: any) => {
    const next = [...attributes];
    next[index] = { ...next[index], [key]: value };
    setAttributes(next);
  };

  const removeAttribute = (index: number) => {
    setAttributes(attributes.filter((_, i) => i !== index));
  };

  const handleAttributeValues = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const rawVal = e.currentTarget.value.trim().replace(/,$/, "");
      const val = formatAttributeValue(attributes[index].name, rawVal);
      if (val && !attributes[index].values.includes(val)) {
        updateAttribute(index, "values", [...attributes[index].values, val]);
        e.currentTarget.value = "";
      }
    }
  };

  const handleAttributeBlur = (index: number, e: React.FocusEvent<HTMLInputElement>) => {
    const rawVal = e.currentTarget.value.trim().replace(/,$/, "");
    const val = formatAttributeValue(attributes[index].name, rawVal);
    if (val && !attributes[index].values.includes(val)) {
      updateAttribute(index, "values", [...attributes[index].values, val]);
      e.currentTarget.value = "";
    }
  };

  const removeAttributeValue = (attrIndex: number, val: string) => {
    const next = [...attributes];
    next[attrIndex].values = next[attrIndex].values.filter((v) => v !== val);
    setAttributes(next);
  };

  const generateVariations = () => {
    if (attributes.length === 0 || attributes.some((a) => !a.name.trim() || a.values.length === 0)) {
      toast.error("Please define valid attributes with values first.");
      return;
    }

    if (attributes.some((a) => a.name.toLowerCase().includes('unit') || a.name.toLowerCase().includes('serial'))) {
      toast.error("Attribute names cannot contain 'Unit' or 'Serial'.");
      return;
    }

    const attrs = attributes.map((a) => ({ name: a.name.trim(), values: a.values }));
    const combine = (index: number): Record<string, string>[] => {
      if (index === attrs.length) return [{}];
      const result: Record<string, string>[] = [];
      const sub = combine(index + 1);
      for (const val of attrs[index].values) {
        for (const s of sub) {
          result.push({ [attrs[index].name]: val, ...s });
        }
      }
      return result;
    };

    const combinations = combine(0);
    const newVars: ProductVariation[] = combinations.map((c, i) => {
      const orderedKeys = attrs.map(a => a.name);
      const nameParts = orderedKeys.map(k => `${k}: ${c[k]}`);
      const suffix = orderedKeys.map(k => c[k].replace(/\s+/g, "-")).join("-");
      return {
        id: `v${Date.now()}-${i}`,
        name: nameParts.join(", "),
        sku: `${sku ? sku + "-" : ""}${suffix}`.toUpperCase(),
        dailyRate: dailyRate,
        stock: Object.fromEntries(branchesToRender.map(b => [b, 0])),
        attributes: c,
        enabled: true,
      };
    });

    setVariations(newVars);
    toast.success(`Generated ${newVars.length} variations`);
    setTab("variations");
  };

  const updateVariation = (index: number, patch: Partial<ProductVariation>) => {
    const next = [...variations];
    next[index] = { ...next[index], ...patch };
    setVariations(next);
  };

  const save = async () => {
    if (!name.trim()) return setError("Product name is required");
    if (!sku.trim()) return setError("Base SKU is required");

    if (!validateProductSku(sku.trim())) {
      return setError("Invalid SKU Format. It must be 2-6 letters followed by a hyphen and 3-4 numbers (e.g. WS-001), optionally with attributes.");
    }

    if (!category.trim()) return setError("Category is required");
    if (variations.length === 0) {
      return setError("Please generate variations for this product");
    }

    if (!Number.isFinite(dailyRate) || dailyRate < 0) {
      return setError("Base Daily Rate must be a valid non-negative number.");
    }
    
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      return setError("Purchase Price must be a valid non-negative number.");
    }

    if (variations.some(v => !Number.isFinite(v.dailyRate) || v.dailyRate < 0)) {
      return setError("Variation Daily Rate must be a valid non-negative number.");
    }

    const updatedVariations = variations.map(v => ({
      ...v,
      dailyRate: (v.dailyRate && v.dailyRate > 0) ? v.dailyRate : dailyRate,
    }));

    const payload: Omit<Product, "id"> = {
      name: name.trim(),
      sku: sku.trim(),
      category: category.trim(),
      dailyRate,
      purchasePrice,
      description,
      image,
      attributes,
      variations: updatedVariations,
    };

    try {
      isSubmittingRef.current = true;
      setIsSaving(true);
      setError("");
      if (productToEdit) {
        await updateProduct(productToEdit.id, payload);
        toast.success("Product updated successfully");
      } else {
        await createProduct(payload);
        toast.success("Product created successfully");
        draftSessionIdRef.current += 1;
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        if (draftKey) {
          localStorage.removeItem(draftKey);
        }
        setDraftExists(false);
        setDraftStatus("");
        hasSuccessfullySubmittedRef.current = true;
        resetFormSession();
      }
      onClose();
    } catch (err: any) {
      const msg = err?.message || "An unexpected error occurred. Please try again.";
      setError(msg);
      toast.error("Failed to save product", { description: msg });
    } finally {
      setIsSaving(false);
      if (!hasSuccessfullySubmittedRef.current) {
        isSubmittingRef.current = false;
      }
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <ConfirmDialog
        open={confirmDiscard}
        message="Discard this draft? All unsaved data will be permanently lost."
        confirmLabel="Discard"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
          if (draftKey) localStorage.removeItem(draftKey);
          startNewSession();
          resetFormSession();
          setDraftExists(false);
          setDraftStatus("");
        }}
      />
      <header className="mb-8 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:items-center">
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white/[0.02] text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="font-display text-2xl sm:text-4xl font-semibold">
              {productToEdit ? "Edit Product" : "Add New Product"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground flex items-center gap-2">
              {productToEdit ? "Update product details and stock." : "Create a new rental item in the catalog."}
              {!productToEdit && draftStatus && (
                <span className="inline-flex items-center text-xs opacity-70 bg-white/5 px-2 py-0.5 rounded-full border border-border transition-opacity">
                  {draftStatus}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-4 sm:w-auto">
          {error && <p className="w-full text-sm text-rust sm:w-auto sm:mr-2">{error}</p>}
          {!productToEdit && draftExists && draftKey && (
            <button
              className="rounded-md border border-rust/50 text-rust px-4 py-2 text-sm font-medium hover:bg-rust/10 transition-colors"
              onClick={() => setConfirmDiscard(true)}
            >
              Discard Draft
            </button>
          )}
          <button
            className="rounded-md border border-border px-6 py-2 text-sm font-medium hover:bg-white/[0.05]"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className={goldButtonClass}
            onClick={save}
            disabled={isSaving || isUploading}
          >
            {isSaving ? "Saving…" : productToEdit ? "Save Changes" : "Create Product"}
          </button>
        </div>
      </header>

      <div className="glass flex flex-col overflow-hidden rounded-xl">
        <div className="flex overflow-x-auto border-b border-border bg-white/[0.02] scrollbar-hide">
          {(["basic", "attributes", "variations"] as Tab[]).map((t) => {
            const isBasicInfoComplete = (name ?? "").trim() !== "" && (sku ?? "").trim() !== "" && (category ?? "").trim() !== "";
            const disabled = t !== "basic" && !isBasicInfoComplete;
            return (
              <button
                key={t}
                disabled={disabled}
                onClick={() => setTab(t)}
                className={`shrink-0 whitespace-nowrap px-4 sm:px-6 py-4 text-sm font-medium transition-colors ${tab === t
                    ? "border-b-2 border-gold text-gold"
                    : disabled
                      ? "text-muted-foreground/30 cursor-not-allowed"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                {t === "basic" && "1. Basic Info"}
                {t === "attributes" && "2. Attributes"}
                {t === "variations" && "3. Variations & Stock"}
              </button>
            );
          })}
        </div>

        <div className="p-8">
          {tab === "basic" && (
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
              <div className="space-y-6">
                <Field label="Product Name">
                  <input
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Premium Tuxedo"
                  />
                </Field>
                <Field label="Category">
                  <select
                    className={inputClass}
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                    }}
                  >
                    <option value="" disabled>Select a Category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Base SKU">
                    <input
                      className={monoInputClass + " bg-surface opacity-70 cursor-not-allowed"}
                      value={sku}
                      onChange={(e) => setSku(e.target.value.toUpperCase())}
                      placeholder=""
                      readOnly
                    />
                  </Field>
                  <Field label="Base Daily Rate (₹)">
                    <input
                      type="number"
                      className={monoInputClass}
                      value={dailyRate === 0 ? "" : dailyRate}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setDailyRate(val);
                        setVariations(prev => prev.map(v => ({ ...v, dailyRate: val })));
                      }}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Purchase Price (₹)" hint="Cost to acquire">
                    <input
                      type="number"
                      className={monoInputClass}
                      value={purchasePrice === 0 ? "" : purchasePrice}
                      onChange={(e) => setPurchasePrice(Number(e.target.value))}
                    />
                  </Field>
                </div>



                <Field label="Description">
                  <textarea
                    rows={4}
                    className={inputClass}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field>
              </div>

              <div className="space-y-6">
                <Field label="Product Image">
                  <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-white/[0.02] p-10 text-center hover:bg-white/[0.04]">
                    {image ? (
                      <div className="relative">
                        <img src={image} alt="Preview" className="h-48 w-auto rounded object-cover shadow-lg" />
                        <button
                          onClick={() => setImage("")}
                          className="absolute -right-3 -top-3 rounded-full bg-rust p-1.5 text-white shadow hover:bg-rust/90"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <label className={`cursor-pointer ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                          <span className="rounded-md bg-white/[0.05] px-4 py-2 text-sm text-foreground hover:bg-white/[0.1]">
                            {isUploading ? "Uploading..." : "Select Image"}
                          </span>
                          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                        </label>
                        <p className="mt-3 text-xs text-muted-foreground">Upload a JPG or PNG file</p>
                      </>
                    )}
                  </div>
                </Field>

              </div>
            </div>
          )}

          {tab === "attributes" && (
            <div className="space-y-6">
              <div className="space-y-4">
                {attributes.map((attr, i) => {
                  return (
                    <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-white/[0.01] p-5 sm:flex-row sm:items-start">
                      <Field label="Attribute Name" className="sm:w-1/3">
                        <div className="flex flex-col gap-2">
                          <select
                            className={inputClass}
                            value={attr.name}
                            onChange={(e) => updateAttribute(i, "name", e.target.value)}
                          >
                            <option value="" disabled>Select Attribute</option>
                            {STANDARD_ATTRIBUTES.map(a => {
                              const isUsed = attributes.some((existingAttr, existingIndex) => existingIndex !== i && existingAttr.name === a);
                              if (isUsed) return null;
                              return <option key={a} value={a}>{a}</option>;
                            })}
                            {!STANDARD_ATTRIBUTES.includes(attr.name) && attr.name && (
                              <option key={attr.name} value={attr.name}>{attr.name} (Legacy)</option>
                            )}
                          </select>
                        </div>
                      </Field>
                      <div className="flex-1 space-y-2">
                        <Field label="Values (Press Enter to add)">
                          <input
                            className={inputClass}
                            placeholder="Type a value and press Enter..."
                            onKeyDown={(e) => handleAttributeValues(i, e)}
                            onBlur={(e) => handleAttributeBlur(i, e)}
                          />
                        </Field>
                        {STANDARD_SUGGESTIONS[attr.name] && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            <span className="text-xs text-muted-foreground mr-1 mt-1 flex items-center">Suggestions:</span>
                            {STANDARD_SUGGESTIONS[attr.name].map(sug => (
                              <button
                                key={sug}
                                type="button"
                                onClick={() => {
                                  if (!attr.values.includes(sug)) {
                                    updateAttribute(i, "values", [...attr.values, sug]);
                                  }
                                }}
                                className="rounded border border-border bg-white/[0.02] px-2 py-0.5 text-xs text-muted-foreground hover:bg-gold/10 hover:text-gold hover:border-gold/30 transition-colors"
                              >
                                {sug}
                              </button>
                            ))}
                          </div>
                        )}
                        {attr.values.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-3 border-t border-border mt-3">
                            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center w-full mb-1">Selected Values:</span>
                            {attr.values.map((v) => (
                              <span
                                key={v}
                                className="flex items-center gap-1.5 rounded-md bg-gold/15 border border-gold/30 px-3 py-1.5 text-sm font-medium text-gold"
                              >
                                {v}
                                <button
                                  onClick={() => removeAttributeValue(i, v)}
                                  className="text-gold/60 hover:text-rust transition-colors"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeAttribute(i)}
                        className="mt-6 p-2 text-muted-foreground hover:text-rust transition-colors"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-col gap-4 pt-2">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <button
                    onClick={addAttribute}
                    className="flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-white/[0.05]"
                  >
                    <Plus className="h-4 w-4" /> Add Attribute
                  </button>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button onClick={generateVariations} className={goldButtonClass}>
                  Generate Variations
                </button>
              </div>
            </div>
          )}

          {tab === "variations" && (
            <div className="space-y-6">
              {variations.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-16 text-center">
                  <p className="text-muted-foreground">
                    No variations generated yet. Go to Attributes to generate them.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {variations.map((v, i) => {
                    const totalUnits = Object.values(v.stock).reduce((a, b) => a + (Number(b) || 0), 0);
                    return (
                      <div
                        key={v.id}
                        className={`flex flex-col gap-4 rounded-xl border border-border p-5 transition-colors ${!v.enabled ? "opacity-50 grayscale bg-transparent" : "bg-white/[0.02]"
                          }`}
                      >
                        <div className="flex items-center justify-between border-b border-border/50 pb-4">
                          <div>
                            <div className="flex items-center gap-3">
                              <h4 className="font-display text-lg font-medium text-foreground">{v.name}</h4>
                              <span className="rounded bg-white/[0.05] px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                {totalUnits} Total Unit{totalUnits !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <p className="font-mono text-xs text-muted-foreground mt-1">{v.sku} · ₹{v.dailyRate}/day</p>
                          </div>
                          <div className="flex items-center gap-6">
                            <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                              <input
                                type="checkbox"
                                checked={v.enabled}
                                onChange={(e) => updateVariation(i, { enabled: e.target.checked })}
                                className="h-4 w-4 accent-gold"
                              />
                              Enabled
                            </label>
                            <button
                              onClick={() => setVariations(variations.filter((_, idx) => idx !== i))}
                              className="text-muted-foreground hover:text-rust transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                          <Field label="SKU">
                            <input
                              className={monoInputClass}
                              value={v.sku}
                              onChange={(e) => updateVariation(i, { sku: e.target.value })}
                              disabled={!v.enabled}
                            />
                          </Field>

                          {branchesToRender.map((b) => (
                            <Field key={b} label={`${b} Stock`}>
                              <input
                                type="number"
                                min="0"
                                className={monoInputClass}
                                value={v.stock[b] === 0 ? "" : (v.stock[b] || "")}
                                onChange={(e) =>
                                  updateVariation(i, { stock: { ...v.stock, [b]: Number(e.target.value) } })
                                }
                                disabled={!v.enabled}
                              />
                            </Field>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

