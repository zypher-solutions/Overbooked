import { useState, useMemo } from "react";
import { QrCode, Search } from "lucide-react";
import { toast } from "sonner";
import { useOverbooked } from "@/lib/overbooked/store";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { ReturnRentalModal } from "../ReturnRentalModal";
import type { Product } from "@/lib/overbooked/types";
import { inr, fmtDate, formatProductPrice } from "@/lib/overbooked/utils";
import { StockBadge, goldButtonClass } from "../primitives";
import { Skeleton, TableSkeleton } from "../Skeleton";
import dynamic from "next/dynamic";

const CameraScanner = dynamic(
  () => import("../CameraScanner").then((mod) => mod.CameraScanner),
  { ssr: false }
);

export function ScanLookup() {
  const { products, rentals, isLoading, branches, addToCart, cart, locations } = useOverbooked();
  const { profile } = useAuth();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Product | null>(null);
  const [searched, setSearched] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [returnRentalId, setReturnRentalId] = useState<string | null>(null);

  // Dynamically resolve product from store so live stock updates reflect immediately
  const currentResult = useMemo(() => {
    if (!result) return null;
    return products.find(p => p.id === result.id) || result;
  }, [products, result]);

  const exactSearchQ = query.trim().toLowerCase();
  const matchedVariationIds = currentResult?.variations?.some(v => v.sku.toLowerCase() === exactSearchQ)
    ? currentResult.variations.filter(v => v.sku.toLowerCase() === exactSearchQ).map(v => v.id)
    : null;

  const activeRentals = currentResult 
    ? rentals.filter((r) => {
        if (r.status !== "out") return false;
        if (matchedVariationIds) {
          return r.items?.some(i => i.variationId && matchedVariationIds.includes(i.variationId));
        }
        return r.items?.some(i => i.productId === currentResult.id);
      })
    : [];

  const searchProduct = (q: string) => {
    q = q.trim().toLowerCase();
    return products.find((p) => p.sku.toLowerCase() === q || (p.variations && p.variations.some(v => v.sku.toLowerCase() === q))) ??
      products.find((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || (p.variations && p.variations.some(v => v.sku.toLowerCase().includes(q)))) ??
      null;
  };

  // Live name/SKU suggestions so staff who don't remember a SKU can pick from a list.
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!showSuggestions || q.length < 2) return [];
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.variations?.some((v) => v.sku.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [products, query, showSuggestions]);

  const pickSuggestion = (p: Product) => {
    setQuery(p.name);
    setResult(p);
    setSearched(true);
    setShowSuggestions(false);
  };

  const search = () => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    setShowSuggestions(false);
    const found = searchProduct(q);
    setResult(found);
    setSearched(true);
    if (!found) toast.error("No product found", { description: `Nothing matches “${q}”` });
  };

  const handleScan = (decodedText: string) => {
    setQuery(decodedText);
    setShowSuggestions(false);
    setShowScanner(false);
    toast.success("Scanned successfully", { description: decodedText });
    const found = searchProduct(decodedText);
    setResult(found);
    setSearched(true);
    if (!found) toast.error("No product found", { description: `Nothing matches “${decodedText}”` });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <header className="text-center">
        <h1 className="font-display text-2xl sm:text-4xl font-semibold">Inventory Search</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Scan a QR code, or type a product name or SKU, to check live stock across every branch.
        </p>
      </header>

      {isLoading ? (
        <>
          <div className="glass mt-8 p-3 shadow-glow-soft">
            <Skeleton className="h-10 w-full rounded" />
          </div>
          <div className="glass mt-6 p-5">
            <div className="flex gap-5">
              <Skeleton className="h-30 w-30 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-6 w-1/4" />
              </div>
            </div>
            <div className="mt-8">
              <TableSkeleton rows={2} columns={2} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="glass mt-8 flex items-center gap-2 p-2 shadow-glow-soft">
            <Search className="ml-2 h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              className="flex-1 bg-transparent px-1 py-2 font-mono text-sm outline-none placeholder:text-muted-foreground/60"
              placeholder="Product name or SKU (e.g. SU-001)"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }}
              onKeyDown={(e) => e.key === "Enter" && search()}
            />
            <button
              onClick={() => setShowScanner(true)}
              aria-label="Scan QR code with camera"
              className="rounded-md border border-gold/35 bg-gold/10 p-2.5 text-gold transition-all duration-200 hover:bg-gold/20 hover:shadow-glow-gold"
            >
              <QrCode className="h-4 w-4" />
            </button>
          </div>

          {suggestions.length > 0 && (
            <ul className="glass mt-2 max-h-72 overflow-y-auto p-1">
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => pickSuggestion(p)}
                    className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm hover:bg-white/[0.06]"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {showScanner && (
            <CameraScanner
              onScan={handleScan}
              onClose={() => setShowScanner(false)}
              onError={(err) => {
                console.error(err);
                // toast.error("Camera error", { description: "Could not start camera." });
              }}
            />
          )}

          {currentResult ? (() => {
            const totalStock = (currentResult.variations || []).reduce((sum, v) => {
                if (!v.enabled) return sum;
                return sum + Object.values(v.stock).reduce((a, b) => a + b, 0);
              }, 0);

            return (
            <article className="glass mt-6 p-5">
              <div className="flex flex-wrap gap-5">
                <img
                  src={currentResult.image}
                  alt={currentResult.name}
                  width={120}
                  height={120}
                  loading="lazy"
                  className="h-30 w-30 shrink-0 rounded-lg border border-border object-cover"
                />
                <div className="min-w-[14rem] flex-1">
                  <h2 className="font-display text-3xl font-semibold">{currentResult.name}</h2>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{currentResult.sku}</p>
                  <p className="mt-3 font-mono text-lg text-gold">{typeof formatProductPrice === "function" ? formatProductPrice(currentResult) : inr(currentResult.dailyRate || 0)}/day</p>
                  <span className="mt-2 inline-block rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold">
                    Variable · {(currentResult.variations || []).filter(v => v.enabled).length} variants
                  </span>
                </div>
              </div>

              <div className="mt-6 rounded-lg border border-border overflow-hidden">
                {(() => {
                  let displayVariations = (currentResult.variations || []).filter(v => v.enabled);
                  const exactQ = query.trim().toLowerCase();
                  if (displayVariations.some(v => v.sku.toLowerCase() === exactQ)) {
                    displayVariations = displayVariations.filter(v => v.sku.toLowerCase() === exactQ);
                  }
                  
                  return (
                  <>
                  {/* Desktop Table */}
                  <table className="w-full min-w-[600px] text-sm hidden 2xl:table">
                    <thead>
                      <tr className="bg-white/[0.04] text-left text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
                        <th className="px-4 py-2.5 font-medium">Variation</th>
                        <th className="px-4 py-2.5 font-medium">Stock by Branch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayVariations.map((v) => {
                        const totalStock = Object.values(v.stock).reduce((sum, q) => sum + q, 0);
                        const totalAvailable = Object.values(v.stockDetails || {}).reduce((sum, d) => sum + d.available, 0);
                        const inCartQty = cart.filter((i: import("@/lib/overbooked/types").RentalItem) => i.productId === currentResult.id && i.variationId === v.id).reduce((sum, i) => sum + (i.qty || 1), 0);
                        const availableQty = totalAvailable - inCartQty;
                        return (
                          <tr key={v.id} className="row-zebra transition-colors duration-200">
                            <td className="px-4 py-3 font-medium">
                              <div className="font-medium text-foreground">{v.name}</div>
                              <div className="text-xs font-mono text-gold font-medium mt-0.5">{inr(v.dailyRate || currentResult.dailyRate || 0)}/day</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                {branches.map((b) => {
                                  const details = v.stockDetails?.[b];
                                  const hasDetails = details !== undefined;
                                  const isGlobalAdmin = profile?.role === "super_admin" || profile?.role === "owner";
                                  const branchObj = locations?.find((l) => l.name === b);
                                  const canBookBranch = isGlobalAdmin || profile?.branch_id === branchObj?.id;
                                  const branchAvailableQty = hasDetails ? details.available : 0;

                                  return (
                                    <div key={b} className="rounded-lg border border-border bg-white/[0.03] px-3 py-2 min-w-[148px] flex flex-col justify-between">
                                      <div>
                                        {/* Branch name header */}
                                        <div className="text-[9px] font-bold tracking-[0.13em] text-muted-foreground uppercase mb-2.5 border-b border-border/60 pb-1.5">
                                          {b}
                                        </div>
                                        {/* Stat columns: Total | Available | On Rent */}
                                        <div className="grid grid-cols-3 gap-1 text-center mb-3">
                                          {/* TOTAL */}
                                          <div className="flex flex-col items-center gap-0.5">
                                            <span className="text-sm font-semibold text-foreground leading-none">{v.stock?.[b] ?? 0}</span>
                                            <span className="text-[8.5px] font-medium text-muted-foreground uppercase tracking-wide">Total</span>
                                          </div>
                                          {/* AVAILABLE */}
                                          <div className="flex flex-col items-center gap-0.5">
                                            <span className={`text-sm font-semibold leading-none ${hasDetails && branchAvailableQty > 0 ? 'text-emerald' : 'text-muted-foreground/50'}`}>
                                              {hasDetails ? branchAvailableQty : '—'}
                                            </span>
                                            <span className="text-[8.5px] font-medium text-muted-foreground uppercase tracking-wide">Avail</span>
                                          </div>
                                          {/* ON RENT */}
                                          <div className="flex flex-col items-center gap-0.5">
                                            <span className={`text-sm font-semibold leading-none ${hasDetails && details.onRent > 0 ? 'text-gold' : 'text-muted-foreground/50'}`}>
                                              {hasDetails ? details.onRent : '—'}
                                            </span>
                                            <span className="text-[8.5px] font-medium text-muted-foreground uppercase tracking-wide">Rented</span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Action Button */}
                                      {canBookBranch ? (
                                        <button
                                          onClick={() => {
                                            addToCart({
                                              productId: currentResult.id,
                                              productName: currentResult.name,
                                              variationId: v.id,
                                              variationName: v.name,
                                              sku: v.sku,
                                              image: currentResult.image,
                                              qty: 1,
                                              dailyRate: v.dailyRate || currentResult.dailyRate || 0,
                                            });
                                          }}
                                          disabled={!hasDetails}
                                          className="w-full rounded px-2 py-1.5 text-[10px] font-bold transition-colors uppercase tracking-[0.08em] bg-gold text-white hover:bg-gold/90 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          Add to Cart
                                        </button>
                                      ) : (
                                        <div className="w-full rounded border border-white/[0.05] bg-transparent px-2 py-1.5 text-[10px] font-medium text-muted-foreground/60 text-center uppercase tracking-wider cursor-not-allowed">
                                          View Only
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {displayVariations.length === 0 && (
                        <tr><td colSpan={3} className="px-4 py-4 text-center text-sm text-muted-foreground">No matching variations</td></tr>
                      )}
                    </tbody>
                  </table>

                  {/* Mobile Card Layout */}
                  <div className="2xl:hidden flex flex-col divide-y divide-border bg-white/[0.01]">
                    {displayVariations.map((v) => {
                      const totalStock = Object.values(v.stock).reduce((sum, q) => sum + q, 0);
                      const totalAvailable = Object.values(v.stockDetails || {}).reduce((sum, d) => sum + d.available, 0);
                      const inCartQty = cart.filter((i: import("@/lib/overbooked/types").RentalItem) => i.productId === currentResult.id && i.variationId === v.id).reduce((sum, i) => sum + (i.qty || 1), 0);
                      const availableQty = totalAvailable - inCartQty;
                      
                      return (
                        <div key={v.id} className="p-4 flex flex-col gap-4 row-zebra transition-colors">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="font-medium text-foreground text-base">{v.name}</div>
                              <div className="text-xs font-mono text-gold font-medium mt-1">{inr(v.dailyRate || currentResult.dailyRate || 0)}/day</div>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2">
                            {branches.map((b) => {
                              const details = v.stockDetails?.[b];
                              const hasDetails = details !== undefined;
                              const isGlobalAdmin = profile?.role === "super_admin" || profile?.role === "owner";
                              const branchObj = locations?.find((l) => l.name === b);
                              const canBookBranch = isGlobalAdmin || profile?.branch_id === branchObj?.id;
                              const branchAvailableQty = hasDetails ? details.available : 0;
                              
                              return (
                                <div key={b} className="rounded-lg border border-border bg-white/[0.03] p-2 flex flex-col justify-between">
                                  <div>
                                    <div className="text-[9px] font-bold tracking-[0.13em] text-muted-foreground uppercase mb-1.5 border-b border-border/60 pb-1 text-center truncate">
                                      {b}
                                    </div>
                                    <div className="grid grid-cols-3 gap-1 text-center mb-2">
                                      <div className="flex flex-col items-center">
                                        <span className="text-xs font-semibold text-foreground leading-tight">{v.stock?.[b] ?? 0}</span>
                                        <span className="text-[8px] font-medium text-muted-foreground uppercase">Tot</span>
                                      </div>
                                      <div className="flex flex-col items-center">
                                        <span className={`text-xs font-semibold leading-tight ${hasDetails && branchAvailableQty > 0 ? 'text-emerald' : 'text-muted-foreground/50'}`}>
                                          {hasDetails ? branchAvailableQty : '—'}
                                        </span>
                                        <span className="text-[8px] font-medium text-muted-foreground uppercase">Avail</span>
                                      </div>
                                      <div className="flex flex-col items-center">
                                        <span className={`text-xs font-semibold leading-tight ${hasDetails && details.onRent > 0 ? 'text-gold' : 'text-muted-foreground/50'}`}>
                                          {hasDetails ? details.onRent : '—'}
                                        </span>
                                        <span className="text-[8px] font-medium text-muted-foreground uppercase">Rent</span>
                                      </div>
                                    </div>
                                  </div>
                                  
                                  {/* Action Button */}
                                  {canBookBranch ? (
                                    <button
                                      onClick={() => {
                                        addToCart({
                                          productId: currentResult.id,
                                          productName: currentResult.name,
                                          variationId: v.id,
                                          variationName: v.name,
                                          sku: v.sku,
                                          image: currentResult.image,
                                          qty: 1,
                                          dailyRate: v.dailyRate || currentResult.dailyRate || 0,
                                        });
                                      }}
                                      disabled={!hasDetails}
                                      className="w-full rounded px-2 py-1 text-[9px] font-bold transition-colors uppercase tracking-[0.08em] bg-gold text-white hover:bg-gold/90 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      Add to Cart
                                    </button>
                                  ) : (
                                    <div className="w-full rounded border border-white/[0.05] bg-transparent px-2 py-1 text-[9px] font-medium text-muted-foreground/60 text-center uppercase tracking-wider cursor-not-allowed">
                                      View Only
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {displayVariations.length === 0 && (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">No matching variations</div>
                    )}
                  </div>
                  </>
                  );
                })()}
              </div>

              {activeRentals.length > 0 && (
                <div className="mt-6 border-t border-border pt-4">
                  <h3 className="mb-3 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">Active Rentals</h3>
                  <div className="space-y-2">
                    {activeRentals.map((r) => (
                      <div key={r.id} className="flex items-center justify-between rounded-md border border-border bg-white/[0.02] p-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{r.customerName} <span className="font-normal text-[11px] text-muted-foreground ml-1">({r.branch})</span></p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {r.items?.find(i => i.productId === currentResult.id)?.variationName && <span className="text-foreground mr-1.5">{r.items.find(i => i.productId === currentResult.id)?.variationName}</span>}
                            Due {fmtDate(r.dueDate)}
                          </p>
                        </div>
                        <button
                          className="rounded bg-emerald/10 border border-emerald/30 px-3 py-1.5 text-xs font-medium text-emerald transition-colors hover:bg-emerald/20"
                          onClick={() => setReturnRentalId(r.id)}
                        >
                          Return
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </article>
            );
          })() : searched ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          No product matched that search.
        </p>
          ) : null}
        </>
      )}

      <ReturnRentalModal
        open={!!returnRentalId}
        rental={rentals.find((r) => r.id === returnRentalId) || null}
        onClose={() => setReturnRentalId(null)}
      />
    </div>
  );
}

