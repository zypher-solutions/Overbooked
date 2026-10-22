import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOverbooked } from "@/lib/overbooked/store";
import { useAuth } from "@/lib/overbooked/AuthContext";
import type { Product, Rental } from "@/lib/overbooked/types";
import { fmtDate, inr, formatProductPrice } from "@/lib/overbooked/utils";
import { StockBadge } from "./primitives";

export function RentalStatusModal({
  product,
  onClose,
  onPutOut,
  onEdit,
}: {
  product: Product | null;
  onClose: () => void;
  onPutOut: (product: Product, branch?: string, variationId?: string) => void;
  onEdit: (rental: Rental) => void;
}) {
  const { rentals, branches, cart, locations, fetchInitialData } = useOverbooked();
  const { profile } = useAuth();

  useEffect(() => {
    if (product) {
      fetchInitialData({ silent: true });
    }
  }, [product?.id, fetchInitialData]);

  if (!product) return null;

  const displayVariations = (product.variations || []).filter(v => v.enabled);
  const activeRentals = rentals.filter((r) => r.status === "out" && r.items?.some(i => i.productId === product.id));

  return (
    <Dialog open={!!product} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="glass-strong max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{product.name} Status</DialogTitle>
        </DialogHeader>

        <div className="flex gap-4 sm:gap-5 mt-2 pr-8 sm:pr-0">
          <img
            src={product.image || undefined}
            alt={product.name}
            width={120}
            height={120}
            loading="lazy"
            className="h-20 w-20 sm:h-30 sm:w-30 shrink-0 rounded-lg border border-border object-cover"
          />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl sm:text-3xl font-semibold">{product.name}</h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{product.sku}</p>
            <p className="mt-3 font-mono text-lg text-gold">{typeof formatProductPrice === "function" ? formatProductPrice(product) : inr(product.dailyRate || 0)}/day</p>
            <span className="mt-2 inline-block rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold">
              Variable · {displayVariations.length} variants
            </span>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-border overflow-hidden">
          {/* Desktop Table */}
          <table className="w-full text-sm hidden xl:table">
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
                const inCartQty = cart.filter(i => i.productId === product.id && i.variationId === v.id).reduce((sum, i) => sum + (i.qty || 1), 0);
                const availableQty = totalAvailable - inCartQty;
                return (
                  <tr key={v.id} className="row-zebra transition-colors duration-200">
                    <td className="px-4 py-3 font-medium">
                      <div className="font-medium text-foreground">{v.name}</div>
                      <div className="text-xs font-mono text-gold font-medium mt-0.5">{inr(v.dailyRate || product.dailyRate || 0)}/day</div>
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
                                    onClose();
                                    onPutOut(product, b, v.id);
                                  }}
                                  disabled={!hasDetails}
                                  className="w-full rounded px-2 py-1.5 text-[10px] font-bold transition-colors uppercase tracking-[0.08em] bg-gold text-white hover:bg-gold/90 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Rent
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
          <div className="xl:hidden flex flex-col divide-y divide-border bg-white/[0.01]">
            {displayVariations.map((v) => {
              const totalStock = Object.values(v.stock).reduce((sum, q) => sum + q, 0);
              const totalAvailable = Object.values(v.stockDetails || {}).reduce((sum, d) => sum + d.available, 0);
              const inCartQty = cart.filter(i => i.productId === product.id && i.variationId === v.id).reduce((sum, i) => sum + (i.qty || 1), 0);
              const availableQty = totalAvailable - inCartQty;
              
              return (
                <div key={v.id} className="p-4 flex flex-col gap-4 row-zebra transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-medium text-foreground text-base">{v.name}</div>
                      <div className="text-xs font-mono text-gold font-medium mt-1">{inr(v.dailyRate || product.dailyRate || 0)}/day</div>
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
                            <div className="text-[10px] font-bold tracking-[0.13em] text-muted-foreground uppercase mb-1.5 border-b border-border/60 pb-1 text-center truncate">
                              {b}
                            </div>
                            <div className="grid grid-cols-3 gap-1 text-center mb-2">
                              <div className="flex flex-col items-center">
                                <span className="text-xs font-semibold text-foreground leading-tight">{v.stock?.[b] ?? 0}</span>
                                <span className="text-[10px] font-medium text-muted-foreground uppercase">Tot</span>
                              </div>
                              <div className="flex flex-col items-center">
                                <span className={`text-xs font-semibold leading-tight ${hasDetails && branchAvailableQty > 0 ? 'text-emerald' : 'text-muted-foreground/50'}`}>
                                  {hasDetails ? branchAvailableQty : '—'}
                                </span>
                                <span className="text-[10px] font-medium text-muted-foreground uppercase">Avail</span>
                              </div>
                              <div className="flex flex-col items-center">
                                <span className={`text-xs font-semibold leading-tight ${hasDetails && details.onRent > 0 ? 'text-gold' : 'text-muted-foreground/50'}`}>
                                  {hasDetails ? details.onRent : '—'}
                                </span>
                                <span className="text-[10px] font-medium text-muted-foreground uppercase">Rent</span>
                              </div>
                            </div>
                          </div>
                          
                          {/* Action Button */}
                          {canBookBranch ? (
                            <button
                              onClick={() => {
                                onClose();
                                onPutOut(product, b, v.id);
                              }}
                              disabled={!hasDetails}
                              className="w-full rounded px-2 py-2 text-[11px] font-bold transition-colors uppercase tracking-[0.08em] bg-gold text-white hover:bg-gold/90 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Rent
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
                      {r.items?.find(i => i.productId === product.id)?.variationName && <span className="text-foreground mr-1.5">{r.items.find(i => i.productId === product.id)?.variationName}</span>}
                      Due {fmtDate(r.dueDate)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}