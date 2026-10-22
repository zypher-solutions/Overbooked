import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Rental } from "@/lib/overbooked/types";
import { fmtDate, inr, balanceOf } from "@/lib/overbooked/utils";
import { PaymentBadge, RentalStatusBadge, TokenBadge } from "./primitives";
import { AdminRentalTools } from "./AdminTools";

export function RentalSummaryModal({
  open,
  rental,
  onClose,
}: {
  open: boolean;
  rental: Rental | null;
  onClose: () => void;
}) {
  if (!rental) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="glass-strong max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold flex items-center justify-between pr-8">
            <span>Rental Summary</span>
            <TokenBadge token={rental.token} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-md bg-white/[0.03] p-4 border border-border">
              <h4 className="text-xs tracking-wider text-muted-foreground uppercase mb-2">Customer Details</h4>
              <p className="font-medium text-foreground text-sm">{rental.customerName}</p>
              <p className="font-mono text-xs text-muted-foreground mt-1">{rental.customerPhone || "No Phone"}</p>
            </div>
            
            <div className="rounded-md bg-white/[0.03] p-4 border border-border sm:col-span-2">
              <h4 className="text-xs tracking-wider text-muted-foreground uppercase mb-2">Item Details ({rental.items?.length || 0})</h4>
              <div className="space-y-3 mt-3">
                {rental.items?.map((item, idx) => (
                  <div key={idx} className="flex gap-3 text-sm">
                    <img src={item.image} alt={item.productName} className="w-10 h-10 rounded object-cover border border-border shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.productName} <span className="text-xs text-muted-foreground font-normal">x{item.qty}</span></p>
                      {item.assignedUnitSkus && item.assignedUnitSkus.length > 0 ? (
                        <div className="mt-1 flex flex-col gap-0.5">
                          {item.assignedUnitSkus.map((unitSku, uIdx) => (
                            <p key={uIdx} className="font-mono text-xs text-foreground truncate">{unitSku}</p>
                          ))}
                          {item.variationName && (
                            <p className="text-[11px] text-muted-foreground truncate pt-0.5">{item.variationName}</p>
                          )}
                        </div>
                      ) : (
                        <p className="font-mono text-xs text-muted-foreground truncate mt-0.5">{item.sku} {item.variationName ? `· ${item.variationName}` : ''}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs mt-3 pt-3 border-t border-border/50">Branch: {rental.branch}</p>
            </div>
          </div>

          <div className="rounded-md bg-white/[0.03] p-4 border border-border">
            <h4 className="text-xs tracking-wider text-muted-foreground uppercase mb-3">Rental Period</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground block text-xs">Rent Date</span>
                <span className="font-medium">{fmtDate(rental.rentDate)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs">Due Date</span>
                <span className="font-medium text-emerald">{fmtDate(rental.dueDate)}</span>
              </div>
              {rental.returnedOn && (
                <div className="col-span-2 mt-2 pt-2 border-t border-border/50">
                  <span className="text-muted-foreground block text-xs">Returned On</span>
                  <span className="font-medium">{fmtDate(rental.returnedOn)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-md bg-white/[0.03] p-4 border border-border">
            <h4 className="text-xs tracking-wider text-muted-foreground uppercase mb-3">Financials</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Rental Charge</span>
                <span className="font-mono">{inr((rental.total || 0) - (rental.extra_fees || 0))}</span>
              </div>

              {rental.extra_fees ? (
                <div className="mt-4 p-3 rounded-md bg-orange-500/10 border border-orange-500/20">
                  <div className="flex justify-between items-center text-sm font-medium text-orange-500">
                    <span>Extra Fees (Damage/Late)</span>
                    <span>{inr(rental.extra_fees)}</span>
                  </div>
                  {rental.extra_fees_reason && (
                    <p className="mt-1 text-xs text-orange-500/80 italic">{rental.extra_fees_reason}</p>
                  )}
                </div>
              ) : null}

              <div className="flex justify-between mt-2 pt-2 border-t border-border/50 text-base font-semibold">
                <span>Grand Total</span>
                <span className="font-mono">{inr(rental.total || 0)}</span>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-border/50 mt-2">
                <span className="text-muted-foreground">Advance/Collected</span>
                <span className="font-mono text-emerald">{inr(rental.advance || 0)}</span>
              </div>
              {(rental.securityDeposit || 0) > 0 && (
                <div className="flex justify-between items-center mt-1">
                  <span className="text-muted-foreground">Security Deposit</span>
                  <span className="font-mono">{inr(rental.securityDeposit || 0)}</span>
                </div>
              )}
              {rental.status === "returned" && (rental.securityDeposit || 0) > 0 && (
                <>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-muted-foreground">Taken from deposit</span>
                    <span className="font-mono">{inr(rental.depositDeducted || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-muted-foreground">
                      Deposit refunded
                      {rental.depositRefundMethod ? ` (${String(rental.depositRefundMethod).replace("_", " ")})` : ""}
                    </span>
                    <span className="font-mono text-emerald">{inr(rental.depositRefunded || 0)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-border/50 mt-2">
                <span className="text-muted-foreground">Pending Balance</span>
                <span className={`font-mono font-semibold ${balanceOf(rental) > 0 ? "text-rust" : "text-emerald"}`}>
                  {inr(balanceOf(rental))}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 rounded-md bg-white/[0.03] p-4 border border-border">
              <h4 className="text-xs tracking-wider text-muted-foreground uppercase mb-2">Item Status</h4>
              <RentalStatusBadge status={rental.status} />
              {rental.condition && (
                <p className="text-xs text-muted-foreground mt-2 capitalize">Condition: {rental.condition}</p>
              )}
            </div>
            <div className="flex-1 rounded-md bg-white/[0.03] p-4 border border-border">
              <h4 className="text-xs tracking-wider text-muted-foreground uppercase mb-2">Payment</h4>
              <PaymentBadge status={rental.paymentStatus} />
            </div>
          </div>

          {rental.notes && (
            <div className="rounded-md bg-white/[0.03] p-4 border border-border">
              <h4 className="text-xs tracking-wider text-muted-foreground uppercase mb-2">Notes</h4>
              <p className="text-sm whitespace-pre-wrap">{rental.notes}</p>
            </div>
          )}

          <AdminRentalTools rental={rental} onDeleted={onClose} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
