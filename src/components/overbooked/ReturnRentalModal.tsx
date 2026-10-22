import { useEffect, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { useOverbooked } from "@/lib/overbooked/store";
import type { Rental } from "@/lib/overbooked/types";
import { inr, todayISO, fmtDate, balanceOf } from "@/lib/overbooked/utils";
import {
  goldButtonClass,
  ghostButtonClass,
  PaymentBadge,
} from "./primitives";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function ReturnRentalModal({
  open,
  rental,
  onClose,
}: {
  open: boolean;
  rental: Rental | null;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { returnRental } = useOverbooked();

  const [returnDate, setReturnDate] = useState(todayISO());
  const [extraFees, setExtraFees] = useState(0);
  const [extraFeesReason, setExtraFeesReason] = useState("");
  const [generalNotes, setGeneralNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [unitConditions, setUnitConditions] = useState<Record<string, string>>({});
  const [unitNotes, setUnitNotes] = useState<Record<string, string>>({});

  // null = use the default (take as much of the fees as the deposit covers / pay the whole amount owed)
  const [takeInput, setTakeInput] = useState<number | null>(null);
  const [payInput, setPayInput] = useState<number | null>(null);
  const [refundMethod, setRefundMethod] = useState("cash");
  const [payMethod, setPayMethod] = useState("cash");

  const allUnits = useMemo(() => {
    if (!rental || !rental.items) return [];

    return rental.items.flatMap((item) => {
      if (Array.isArray(item.assignedUnits) && item.assignedUnits.length > 0) {
        return item.assignedUnits.map((u) => ({
          id: u.id,
          itemSku: u.itemSku,
          status: u.status,
          productName: item.productName,
          rental_item_id: item.id,
        }));
      }
      return [];
    });
  }, [rental]);

  useEffect(() => {
    if (!open || !rental) return;
    setReturnDate(todayISO());
    setExtraFees(0);
    setExtraFeesReason("");
    setGeneralNotes("");
    setUnitConditions({});
    setUnitNotes({});
    setTakeInput(null);
    setPayInput(null);
    setRefundMethod("cash");
    setPayMethod("cash");
  }, [open, rental]);

  if (!rental) return null;

  // Settlement (mirrors mark_returned_atomic): the deposit is always settled, part taken against the
  // fees (take) and the rest refunded; the customer pays what is still owed now or leaves it as a balance.
  const secDeposit = rental.securityDeposit || 0;
  const fees = Math.max(0, Number(extraFees) || 0);
  const maxTake = Math.min(secDeposit, fees);
  const take = takeInput === null ? maxTake : Math.max(0, Number(takeInput) || 0);
  const refund = Math.max(0, secDeposit - take);
  const owed = Math.max(0, (rental.total || 0) + fees - (rental.advance || 0) - take);
  const payNow = payInput === null ? owed : Math.max(0, Number(payInput) || 0);
  const leftDue = Math.max(0, owed - payNow);

  const settlementError =
    take > maxTake
      ? `Amount taken from the deposit cannot exceed ${inr(maxTake)} (the smaller of the deposit and the fees).`
      : payNow > owed
        ? `Payment cannot exceed the amount owed (${inr(owed)}).`
        : null;

  // Validation
  const hasValidUnits = allUnits.length > 0 && allUnits.every((u) => u.id && u.itemSku);
  const allConditionsSet = allUnits.every((u) =>
    ["good", "damaged", "lost"].includes(unitConditions[u.id])
  );
  const isFormValid = hasValidUnits && allConditionsSet;

  const submit = async () => {
    if (!isFormValid) {
      toast.error("Please select a valid condition (Good, Damaged, Lost) for every physical unit.");
      return;
    }

    if (settlementError) {
      toast.error(settlementError);
      return;
    }

    setIsSubmitting(true);
    try {
      // Build RPC items payload using inventory_item_id and rental_item_id
      const rpcItems = allUnits.map((u) => ({
        inventory_item_id: u.id,
        condition: unitConditions[u.id],
        return_notes: unitNotes[u.id] || undefined,
        rental_item_id: u.rental_item_id,
      }));

      // Construct final notes
      let finalNotes = rental.notes || "";
      if (generalNotes.trim()) {
        finalNotes = finalNotes
          ? `${finalNotes}\nGeneral Return Note: ${generalNotes.trim()}`
          : `General Return Note: ${generalNotes.trim()}`;
      }
      const finalExtraFeesReason =
        extraFees > 0
          ? extraFeesReason.trim() || "Damage/Late fees assessed on return"
          : undefined;

      await returnRental(rental.id, rpcItems, returnDate, {
        extra_fees: fees,
        extra_fees_reason: finalExtraFeesReason,
        notes: finalNotes,
        deposit_deducted: take,
        deposit_refund_method: refund > 0 ? refundMethod : undefined,
        payment_amount: payNow,
        payment_method: payNow > 0 ? payMethod : undefined,
      });

      toast.success("Rental returned successfully.");
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed to mark as returned");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="glass-strong sm:max-h-[88vh] sm:w-full sm:max-w-2xl lg:max-w-3xl flex flex-col p-0 gap-0 overflow-hidden shadow-2xl max-sm:p-0! max-sm:pt-[env(safe-area-inset-top)]! max-sm:pb-[env(safe-area-inset-bottom)]! max-sm:overflow-hidden!">
        {/* Header */}
        <div className="px-5 py-3 border-b border-border/60 shrink-0">
          <DialogHeader className="text-left pr-8">
            <DialogTitle className="font-display text-lg font-semibold tracking-wide text-foreground">
              RETURN RENTAL
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Review returned items and finalize the rental.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Scrollable Content Body */}
        <div className="px-5 py-3.5 overflow-y-auto flex-1 space-y-3.5 text-xs">
          {/* Customer & Rental Summary */}
          <div className="rounded-md border border-border/50 bg-white/[0.02] p-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between sm:justify-start sm:gap-4">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-24 shrink-0">
                    Customer
                  </span>
                  <span className="font-semibold text-foreground truncate">{rental.customerName}</span>
                </div>
                <div className="flex items-center justify-between sm:justify-start sm:gap-4">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-24 shrink-0">
                    Phone
                  </span>
                  <span className="font-mono text-foreground">{rental.customerPhone}</span>
                </div>
                <div className="flex items-center justify-between sm:justify-start sm:gap-4">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-24 shrink-0">
                    Rental Date
                  </span>
                  <span className="font-mono text-foreground">{fmtDate(rental.rentDate)}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between sm:justify-start sm:gap-4">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-24 shrink-0">
                    Token
                  </span>
                  <span className="font-mono font-semibold text-gold">{rental.token}</span>
                </div>
                <div className="flex items-center justify-between sm:justify-start sm:gap-4">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-24 shrink-0">
                    Branch
                  </span>
                  <span className="font-medium text-foreground">{rental.branch}</span>
                </div>
                <div className="flex items-center justify-between sm:justify-start sm:gap-4">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-24 shrink-0">
                    Due Date
                  </span>
                  <span className="font-mono font-medium text-emerald">{fmtDate(rental.dueDate)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Financial Summary */}
          <div>
            <div className="pb-1 mb-1.5 border-b border-border/30">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Rental Financial Summary
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div className="rounded-md border border-border/40 bg-white/[0.015] p-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Rental Total
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">
                  {inr(rental.total || 0)}
                </p>
              </div>
              <div className="rounded-md border border-border/40 bg-white/[0.015] p-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Amount Paid
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-emerald">
                  {inr(rental.advance || 0)}
                </p>
              </div>
              <div className="rounded-md border border-border/40 bg-white/[0.015] p-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Remaining
                </p>
                <p
                  className={cn(
                    "mt-0.5 font-mono text-sm font-semibold",
                    balanceOf(rental) > 0 ? "text-rust" : "text-emerald"
                  )}
                >
                  {inr(balanceOf(rental))}
                </p>
              </div>
              <div className="rounded-md border border-border/40 bg-white/[0.015] p-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Security Deposit
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-gold">
                  {inr(secDeposit)}
                </p>
              </div>
              <div className="col-span-2 sm:col-span-1 rounded-md border border-border/40 bg-white/[0.015] p-2.5 flex flex-col justify-between">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Payment Status
                </p>
                <div className="mt-0.5">
                  <PaymentBadge status={rental.paymentStatus as any} />
                </div>
              </div>
            </div>
          </div>

          {/* Physical Units Section */}
          <div>
            <div className="flex items-center justify-between pb-1 mb-1.5 border-b border-border/30">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Physical Units to Return
              </span>
              <span className="text-[11px] font-medium text-muted-foreground">
                {allUnits.length} {allUnits.length === 1 ? "unit" : "units"}
              </span>
            </div>

            {!hasValidUnits ? (
              <div className="text-xs text-amber-400 p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-center">
                <p className="font-medium">Unable to load physical units for this rental.</p>
                <p className="mt-0.5 opacity-80">Please refresh and try again.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {allUnits.map((unit, index) => (
                  <div
                    key={`${unit.id}-${index}`}
                    className="rounded-md border border-border/50 bg-white/[0.02] p-2.5 sm:p-3 space-y-2 transition-colors hover:border-border"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground truncate leading-tight">
                          {unit.productName}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground mt-0.5 tracking-tight">
                          {unit.itemSku}
                        </p>
                      </div>
                      <span className="shrink-0 rounded border border-border/50 bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] font-medium capitalize text-muted-foreground">
                        {unit.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1.5 border-t border-border/30">
                      <div>
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Condition <span className="text-rust">*</span>
                        </label>
                        <select
                          aria-label={`Condition for ${unit.productName} (${unit.itemSku})`}
                          className={cn(
                            "w-full rounded-sm border border-input bg-white/[0.03] px-2.5 py-1.5 text-xs outline-none transition-all focus:border-gold/50 focus:ring-1 focus:ring-ring",
                            unitConditions[unit.id] ? "text-foreground font-medium" : "text-muted-foreground"
                          )}
                          value={unitConditions[unit.id] || ""}
                          onChange={(e) =>
                            setUnitConditions({ ...unitConditions, [unit.id]: e.target.value })
                          }
                        >
                          <option value="" disabled>
                            Select condition...
                          </option>
                          <option value="good" className="text-foreground">
                            Good
                          </option>
                          <option value="damaged" className="text-foreground">
                            Damaged
                          </option>
                          <option value="lost" className="text-foreground">
                            Lost
                          </option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Return Notes (Optional)
                        </label>
                        <input
                          type="text"
                          aria-label={`Return notes for ${unit.productName} (${unit.itemSku})`}
                          className="w-full rounded-sm border border-input bg-white/[0.03] px-2.5 py-1.5 text-xs text-foreground outline-none transition-all placeholder:text-muted-foreground/50 focus:border-gold/50 focus:ring-1 focus:ring-ring"
                          placeholder="Condition remarks, issues..."
                          value={unitNotes[unit.id] || ""}
                          onChange={(e) =>
                            setUnitNotes({ ...unitNotes, [unit.id]: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Additional Charges & Notes */}
          <div className="space-y-3">
            <div>
              <div className="pb-1 mb-1.5 border-b border-border/30">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Additional Charges
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Extra Fees (₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    aria-label="Extra Fees in Rupees"
                    className="w-full font-mono rounded-sm border border-input bg-white/[0.03] px-2.5 py-1.5 text-xs text-foreground outline-none transition-all placeholder:text-muted-foreground/50 focus:border-gold/50 focus:ring-1 focus:ring-ring"
                    value={extraFees === 0 ? "" : extraFees}
                    onChange={(e) => setExtraFees(Number(e.target.value))}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Reason (Optional)
                  </label>
                  <input
                    type="text"
                    aria-label="Reason for extra fees"
                    className="w-full rounded-sm border border-input bg-white/[0.03] px-2.5 py-1.5 text-xs text-foreground outline-none transition-all placeholder:text-muted-foreground/50 focus:border-gold/50 focus:ring-1 focus:ring-ring"
                    placeholder="e.g. Late return, cleaning"
                    value={extraFeesReason}
                    onChange={(e) => setExtraFeesReason(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="pb-1 mb-1.5 border-b border-border/30">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Deposit &amp; Payment Settlement
                </span>
              </div>
              <div className="rounded-md border border-border/50 bg-white/[0.02] p-2.5 sm:p-3 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground text-[11px] uppercase tracking-wider">Deposit held</span>
                  <span className="font-mono text-xs font-semibold text-gold">{inr(secDeposit)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground text-[11px] uppercase tracking-wider">Fees applied</span>
                  <span className="font-mono text-xs font-semibold text-foreground">{inr(fees)}</span>
                </div>

                {secDeposit > 0 && (
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Take from deposit (₹) — max {inr(maxTake)}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={maxTake}
                      aria-label="Take from deposit in Rupees"
                      className="w-full font-mono rounded-sm border border-input bg-white/[0.03] px-2.5 py-1.5 text-xs text-foreground outline-none transition-all focus:border-gold/50 focus:ring-1 focus:ring-ring"
                      value={takeInput === null ? (maxTake === 0 ? "" : maxTake) : takeInput}
                      onChange={(e) => setTakeInput(e.target.value === "" ? 0 : Number(e.target.value))}
                      placeholder="0"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="rounded-sm border border-emerald/25 bg-emerald/10 px-2.5 py-1.5 text-xs text-emerald font-medium">
                    Refund to customer: <span className="font-mono">{inr(refund)}</span>
                  </div>
                  <div
                    className={cn(
                      "rounded-sm border px-2.5 py-1.5 text-xs font-medium",
                      owed > 0 ? "border-rust/25 bg-rust/10 text-rust" : "border-border/40 bg-white/[0.02] text-muted-foreground"
                    )}
                  >
                    Customer owes: <span className="font-mono">{inr(owed)}</span>
                  </div>
                </div>

                {refund > 0 && (
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Refund paid by
                    </label>
                    <select
                      aria-label="Deposit refund method"
                      className="w-full rounded-sm border border-input bg-white/[0.03] px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-gold/50 focus:ring-1 focus:ring-ring"
                      value={refundMethod}
                      onChange={(e) => setRefundMethod(e.target.value)}
                    >
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank transfer</option>
                    </select>
                  </div>
                )}

                {owed > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Collect now (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={owed}
                        aria-label="Collect now in Rupees"
                        className="w-full font-mono rounded-sm border border-input bg-white/[0.03] px-2.5 py-1.5 text-xs text-foreground outline-none transition-all focus:border-gold/50 focus:ring-1 focus:ring-ring"
                        value={payInput === null ? owed : payInput}
                        onChange={(e) => setPayInput(e.target.value === "" ? 0 : Number(e.target.value))}
                      />
                    </div>
                    {payNow > 0 && (
                      <div>
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Paid by
                        </label>
                        <select
                          aria-label="Payment method"
                          className="w-full rounded-sm border border-input bg-white/[0.03] px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-gold/50 focus:ring-1 focus:ring-ring"
                          value={payMethod}
                          onChange={(e) => setPayMethod(e.target.value)}
                        >
                          <option value="cash">Cash</option>
                          <option value="upi">UPI</option>
                          <option value="card">Card</option>
                          <option value="bank_transfer">Bank transfer</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {leftDue > 0 && (
                  <p className="text-[11px] text-rust">
                    {inr(leftDue)} will stay as a balance due on this rental (collect it later with Record payment).
                  </p>
                )}
                {settlementError && <p className="text-[11px] text-rust font-medium">{settlementError}</p>}
              </div>
            </div>

            <div>
              <div className="pb-1 mb-1.5 border-b border-border/30">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Notes
                </span>
              </div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                General Notes (Optional)
              </label>
              <textarea
                rows={2}
                aria-label="General Return Notes"
                className="w-full rounded-sm border border-input bg-white/[0.03] px-2.5 py-1.5 text-xs text-foreground outline-none transition-all placeholder:text-muted-foreground/50 focus:border-gold/50 focus:ring-1 focus:ring-ring resize-none"
                placeholder="Additional notes or observations..."
                value={generalNotes}
                onChange={(e) => setGeneralNotes(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div className="px-5 py-3 border-t border-border/60 bg-background/90 backdrop-blur-sm shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <div>
            {!allConditionsSet && hasValidUnits && (
              <p className="text-[11px] text-muted-foreground/80 italic">
                * Select condition for all {allUnits.length} {allUnits.length === 1 ? "unit" : "units"} to confirm
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 justify-end w-full sm:w-auto">
            <button
              type="button"
              className={cn(ghostButtonClass, "w-full sm:w-auto px-4 py-2 text-xs font-medium")}
              onClick={onClose}
              disabled={isSubmitting}
            >
              CANCEL
            </button>
            <button
              type="button"
              className={cn(
                goldButtonClass,
                "w-full sm:w-auto px-6 py-2 text-xs font-semibold tracking-wide uppercase transition-all shadow-sm",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
              onClick={submit}
              disabled={isSubmitting || !isFormValid || !!settlementError}
            >
              {isSubmitting ? "RETURNING..." : "CONFIRM RETURN"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
