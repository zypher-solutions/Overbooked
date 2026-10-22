import { useRef, useState } from "react";
import { Download, FileText, UploadCloud, X, AlertTriangle, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { useOverbooked } from "@/lib/overbooked/store";
import { downloadCSV } from "@/lib/overbooked/utils";
import { ghostButtonClass, goldButtonClass } from "../primitives";
import { useAuth } from "@/lib/overbooked/AuthContext";
import type { ValidationResult, PreviewProduct, PreviewVariation } from "@/lib/overbooked/types";

import Papa from "papaparse";

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

const validateCSV = async (
  file: File,
  allBranches: string[],
  allowedBranches: string[],
  categories: any[],
  products: any[]
): Promise<ValidationResult> => {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        try {
          const rows = results.data;
          const errors: string[] = [];
          const productsMap = new Map<string, PreviewProduct>();
          const newCategoriesMap = new Map<string, { name: string; prefix: string }>();
          const existingCategoriesSet = new Set<string>();

          let totalVariations = 0;
          let totalUnits = 0;

          const categoryPrefixMap = new Map<string, string>();
          const maxSkuNumByPrefix = new Map<string, number>();

          for (const c of categories) {
            categoryPrefixMap.set(c.name.toLowerCase(), c.base_sku || "");
          }

          for (const p of products) {
            const sku = typeof p.sku === "string" ? p.sku : "";
            if (sku.includes("-")) {
              const parts = sku.split("-");
              const prefix = parts[0];
              const num = parseInt(parts[1], 10);
              if (!isNaN(num)) {
                const current = maxSkuNumByPrefix.get(prefix) || 0;
                if (num > current) maxSkuNumByPrefix.set(prefix, num);
              }
            }
          }

          const getPrefixForCategory = (catName: string) => {
            const nameLower = catName.toLowerCase();
            if (categoryPrefixMap.has(nameLower)) {
              return categoryPrefixMap.get(nameLower)!;
            }
            let prefix = catName.replace(/[^a-z]/gi, '').substring(0, 3).toUpperCase();
            if (prefix.length < 3) prefix = prefix.padEnd(3, 'X');
            if (!prefix) prefix = "PRD";
            if (!newCategoriesMap.has(nameLower)) {
              newCategoriesMap.set(nameLower, { name: catName, prefix });
            }
            return prefix;
          };

          const newProductSkus = new Map<string, string>();
          const skuCounterByPrefix = new Map<string, number>();

          const getNextSku = (prefix: string) => {
            const nextNum = (maxSkuNumByPrefix.get(prefix) || 0) + 1;
            const counter = skuCounterByPrefix.get(prefix) || 0;
            const finalNum = nextNum + counter;
            skuCounterByPrefix.set(prefix, counter + 1);
            return `${prefix}-${String(finalNum).padStart(3, '0')}`;
          };

          rows.forEach((row, idx) => {
            const line = idx + 2;

            const name = (row["Product Name"] || "").trim();
            const category = (row["Category"] || "").trim();
            const colorRaw = (row["Color"] || "").trim();
            const sizeRaw = (row["Size"] || "").trim();
            const dailyRateStr = (row["Daily Rate"] || "").trim();
            const desc = (row["Description"] || "").trim();
            const purchasePriceStr = (row["Purchase Price"] || "").trim();

            if (!name) errors.push(`Row ${line}: Missing Product Name`);
            if (!category) errors.push(`Row ${line}: Missing Category`);
            if (!colorRaw) errors.push(`Row ${line}: Missing Color`);
            if (!sizeRaw) errors.push(`Row ${line}: Missing Size`);
            if (!dailyRateStr) errors.push(`Row ${line}: Missing Daily Rate`);

            const dailyRate = parseFloat(dailyRateStr);
            if (dailyRateStr && (isNaN(dailyRate) || dailyRate < 0)) {
              errors.push(`Row ${line}: Invalid Daily Rate "${dailyRateStr}"`);
            }

            const purchasePrice = purchasePriceStr ? parseFloat(purchasePriceStr) : 0;
            if (purchasePriceStr && (isNaN(purchasePrice) || purchasePrice < 0)) {
              errors.push(`Row ${line}: Invalid Purchase Price "${purchasePriceStr}"`);
            }

            const stockByBranch: Record<string, number> = {};
            let rowUnits = 0;
            for (const b of allowedBranches) {
              const headerName = `Stock: ${b}`;
              const val = (row[headerName] || "").trim();
              if (val === "") {
                stockByBranch[b] = 0;
              } else {
                const num = Number(val);
                if (!/^0$|^[1-9]\d*$/.test(val)) {
                   errors.push(`Row ${line}: Invalid stock value: "${val}"`);
                   stockByBranch[b] = 0;
                } else {
                   stockByBranch[b] = num;
                   rowUnits += num;
                }
              }
            }

            for (const key of Object.keys(row)) {
              if (key.startsWith("Stock: ")) {
                 const branchName = key.replace("Stock: ", "").trim();
                 if (!allowedBranches.includes(branchName)) {
                   if (allBranches.includes(branchName)) {
                     errors.push(`Row ${line}: Unauthorized foreign branch column "${key}" for Manager.`);
                   } else {
                     errors.push(`Row ${line}: Unknown branch column "${key}"`);
                   }
                 }
              }
            }

            if (errors.length > 0) return;

            const color = formatAttributeValue("Color", colorRaw);
            const size = formatAttributeValue("Size", sizeRaw);

            if (!newProductSkus.has(name)) {
               const prefix = getPrefixForCategory(category);
               newProductSkus.set(name, getNextSku(prefix));
            }
            const baseSku = newProductSkus.get(name)!;
            const variationSku = `${baseSku}-${color.replace(/\s+/g, "-")}-${size.replace(/\s+/g, "-")}`.toUpperCase();

            const pKey = name.toLowerCase();
            if (!productsMap.has(pKey)) {
              productsMap.set(pKey, {
                name,
                category,
                description: desc,
                purchasePrice,
                dailyRate,
                baseSku,
                variations: []
              });
              const catLower = category.toLowerCase();
              if (categoryPrefixMap.has(catLower)) {
                existingCategoriesSet.add(catLower);
              }
            } else {
              const existing = productsMap.get(pKey)!;
              if (existing.category.toLowerCase() !== category.toLowerCase()) {
                errors.push(`Row ${line}: Conflicting category for product "${name}"`);
              }
              if (existing.purchasePrice !== purchasePrice) {
                errors.push(`Row ${line}: Conflicting purchase price for product "${name}"`);
              }
              if (existing.description !== desc) {
                errors.push(`Row ${line}: Conflicting description for product "${name}"`);
              }
              
              const isDup = existing.variations.some(v => v.color === color && v.size === size);
              if (isDup) {
                errors.push(`Row ${line}: Duplicate variation: ${color} / ${size}`);
              }
            }

            if (!errors.some(e => e.includes(`Row ${line}: Duplicate variation`) || e.includes(`Row ${line}: Conflicting`))) {
              productsMap.get(pKey)!.variations.push({
                color,
                size,
                sku: variationSku,
                dailyRate,
                stockByBranch,
                totalUnits: rowUnits
              });
              totalVariations++;
              totalUnits += rowUnits;
            }
          });

          resolve({
            errors,
            products: Array.from(productsMap.values()),
            newCategories: Array.from(newCategoriesMap.values()),
            existingCategoriesCount: existingCategoriesSet.size,
            totalVariations,
            totalUnits
          });
        } catch (e: any) {
          reject(e);
        }
      },
      error: (error) => reject(error),
    });
  });
};

export function CsvImport() {
  const { locations, categories, products, commitImport } = useOverbooked();
  const { profile } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const allBranches = locations.map(l => l.name);
  const allowedBranches = profile?.role === "manager"
    ? locations.filter(l => l.id === profile.branch_id).map(l => l.name)
    : locations.filter(l => l.enabled).map(l => l.name);

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Only .csv files are supported");
      return;
    }
    setFile(f);
    setResult(null);
  };

  const handleValidate = async () => {
    if (!file) return;
    try {
      const res = await validateCSV(file, allBranches, allowedBranches, categories, products);
      setResult(res);
      if (res.errors.length > 0) {
        toast.error("Validation failed with errors");
      } else {
        toast.success("Validation successful");
      }
    } catch (err: any) {
      console.error("Validation error:", err);
      toast.error(`Validation failed: ${err.message || "Unknown error"}`);
    }
  };

  const handleDownloadTemplate = () => {
    const headers = [
      "Product Name", 
      "Category", 
      "Description", 
      "Purchase Price", 
      "Color", 
      "Size", 
      "Daily Rate"
    ];
    allowedBranches.forEach(b => headers.push(`Stock: ${b}`));
    
    const row1 = ["Royal Blue Jodhpuri", "Wedding Suit", "Traditional wedding outfit", 15000, "Royal Blue", "M", 2500];
    const row2 = ["Royal Blue Jodhpuri", "Wedding Suit", "Traditional wedding outfit", 15000, "Royal Blue", "L", 2500];
    const row3 = ["Royal Blue Jodhpuri", "Wedding Suit", "Traditional wedding outfit", 15000, "Royal Blue", "32", 2500];
    const row4 = ["Black Jodhpuri", "Wedding Suit", "Classic black wedding outfit", 12000, "Black", "38", 2200];
    
    // Distribute some mock stock dynamically across however many branches there are
    allowedBranches.forEach((b, i) => {
      // Mock data logic matching prompt
      if (i === 0) {
        row1.push("5");
        row2.push("3");
        row3.push("2");
        row4.push("2");
      } else if (i === 1) {
        row1.push("2");
        row2.push("1");
        row3.push("1");
        row4.push("2");
      } else {
        row1.push("0");
        row2.push("0");
        row3.push("0");
        row4.push("0");
      }
    });
    
    downloadCSV("overbooked-import-template.csv", [headers, row1, row2, row3, row4]);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold">CSV Import</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring in your catalog and per-branch stock in one pass.
        </p>
      </header>

      {!result && (
        <section className="glass mt-6 p-6 rounded-xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">Bulk Import Products via CSV</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Required columns:{" "}
                <span className="font-mono text-foreground">
                  Product Name, Category, Color, Size, Daily Rate
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Optional columns: Description, Purchase Price, Branch Stock
              </p>
            </div>
            <button className={ghostButtonClass + " py-2"} onClick={handleDownloadTemplate}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Download Template
            </button>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files?.[0]);
            }}
            onClick={() => inputRef.current?.click()}
            className={
              "mt-5 cursor-pointer rounded-lg border border-dashed p-10 text-center transition-all duration-200 " +
              (dragging
                ? "border-gold/60 bg-gold/8"
                : "border-border hover:border-gold/40 hover:bg-white/[0.03]")
            }
          >
            <UploadCloud className="mx-auto h-8 w-8 text-gold" />
            <p className="mt-3 text-sm">Drop your CSV here or click to browse</p>
            <p className="mt-1 text-xs text-muted-foreground">Max one file · .csv only</p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>

          {file && (
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-white/[0.03] px-4 py-3">
                <FileText className="h-5 w-5 text-gold" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  className={ghostButtonClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setResult(null);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Remove
                </button>
              </div>
              <button className={goldButtonClass + " w-full py-2.5"} onClick={handleValidate}>
                Validate CSV
              </button>
            </div>
          )}
        </section>
      )}

      {result && result.errors.length > 0 && (
        <section className="glass mt-6 p-6 rounded-xl border-rust/30">
          <div className="flex items-center gap-3 text-rust mb-6">
            <AlertTriangle className="h-6 w-6" />
            <h2 className="font-display text-2xl font-semibold">IMPORT BLOCKED</h2>
          </div>
          
          <p className="text-sm mb-4">
            <span className="font-mono font-bold">{result.errors.length}</span> errors found. You must fix these before importing.
          </p>

          <ul className="space-y-3">
            {result.errors.map((e, i) => (
              <li key={i} className="text-sm rounded-md bg-rust/10 border border-rust/20 p-3">
                {e}
              </li>
            ))}
          </ul>

          <div className="mt-6 flex justify-end">
            <button
              className={ghostButtonClass}
              onClick={() => {
                setResult(null);
              }}
            >
              Try Again
            </button>
          </div>
        </section>
      )}

      {result && result.errors.length === 0 && (
        <section className="glass mt-6 p-6 rounded-xl">
          <div className="flex items-center gap-3 text-emerald-400 mb-6">
            <CheckCircle className="h-6 w-6" />
            <h2 className="font-display text-2xl font-semibold">IMPORT PREVIEW</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="rounded-lg border border-border bg-white/[0.02] p-4 text-center">
              <p className="text-3xl font-light text-foreground">{result.products.length}</p>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-1">Products</p>
            </div>
            <div className="rounded-lg border border-border bg-white/[0.02] p-4 text-center">
              <p className="text-3xl font-light text-foreground">{result.totalVariations}</p>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-1">Variations</p>
            </div>
            <div className="rounded-lg border border-border bg-white/[0.02] p-4 text-center">
              <p className="text-3xl font-light text-foreground">{result.totalUnits}</p>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-1">Physical Units</p>
            </div>
          </div>

          <div className="space-y-8">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 border-b border-border/50 pb-2">Categories</h3>
              <div className="space-y-3">
                {result.existingCategoriesCount > 0 && (
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{result.existingCategoriesCount} Existing Categories matched</p>
                    </div>
                  </div>
                )}
                {result.newCategories.map(c => (
                  <div key={c.name} className="flex items-start gap-3">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold mt-0.5">+</span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">New Category · Suggested Prefix: <span className="font-mono text-emerald-400">{c.prefix}</span></p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 border-b border-border/50 pb-2">Products</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {result.products.map(p => (
                  <div key={p.name} className="rounded-lg border border-border bg-white/[0.02] p-3">
                    <p className="font-mono text-xs text-gold mb-1">{p.baseSku}</p>
                    <p className="text-sm font-medium">{p.name}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 border-b border-border/50 pb-2">Variations</h3>
              <div className="space-y-4">
                {result.products.map(p => (
                  p.variations.map(v => (
                    <div key={v.sku} className="rounded-lg border border-border bg-white/[0.02] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <p className="font-mono text-xs text-gold mb-1">{v.sku}</p>
                        <p className="text-sm font-medium">{v.color} / {v.size}</p>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                        {Object.entries(v.stockByBranch).map(([b, count]) => (
                          <div key={b} className="flex items-center gap-1.5">
                            <span>{b}:</span>
                            <span className="font-mono font-medium text-foreground">{count}</span>
                          </div>
                        ))}
                        <div className="flex items-center gap-1.5 font-medium text-emerald-400 ml-2">
                          <span>Total:</span>
                          <span className="font-mono">{v.totalUnits}</span>
                        </div>
                      </div>
                    </div>
                  ))
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-center">
              <p className="text-sm text-emerald-400 font-medium">{result.totalUnits} physical units will be created.</p>
            </div>
          </div>

          <div className="mt-8 flex justify-end gap-3 border-t border-border/50 pt-6">
            <button
              className={ghostButtonClass}
              disabled={isImporting}
              onClick={() => {
                setResult(null);
              }}
            >
              Cancel
            </button>
            <button
              className={goldButtonClass}
              disabled={isImporting}
              onClick={async () => {
                try {
                  setIsImporting(true);
                  const res = await commitImport(result);
                  toast.success(
                    `Successfully imported! ${res.productsCreated} products, ${res.variationsCreated} variations, and ${res.physicalUnitsCreated} physical units created.`
                  );
                  setResult(null);
                  setFile(null);
                } catch (err: any) {
                  console.error("Import failed:", err);
                  toast.error(`Import failed: ${err.message || "An unexpected error occurred. No records were imported."}`);
                } finally {
                  setIsImporting(false);
                }
              }}
            >
              {isImporting ? "Importing..." : "Confirm Import"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
