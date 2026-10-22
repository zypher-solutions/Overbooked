import { useState, useEffect } from "react";
import { AlertCircle, Calendar, CheckCircle2, XCircle, Clock, ShieldCheck, ArrowRight, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOverbooked } from "@/lib/overbooked/store";
import type { Booking } from "@/lib/overbooked/types";
import { daysBetween, inr, fmtDate, todayISO } from "@/lib/overbooked/utils";
import { addDaysToDate } from "@/lib/overbooked/availability";
import { goldButtonClass, BookingStatusBadge } from "./primitives";
import { DateInput } from "./DateInput";
import { AdminBookingDelete } from "./AdminTools";
import { toast } from "sonner";

export function BookingDetailModal({
  booking,
  onClose,
  onCancelled,
  onPickupSuccess,
}: {
  booking: Booking | null;
  onClose: () => void;
  onCancelled?: () => void;
  onPickupSuccess?: () => void;
}) {
  const { cancelBooking, pickupBooking } = useOverbooked();

  // Cancellation dialog state
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);
  const [cancellationFeeInput, setCancellationFeeInput] = useState<number | "">(0);
  const [refundPaymentMethod, setRefundPaymentMethod] = useState<string>("cash");
  const [cancellationReasonInput, setCancellationReasonInput] = useState<string>("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pickup workflow state
  const [pickupPaymentMethod, setPickupPaymentMethod] = useState<string>("");
  const [isPickingUp, setIsPickingUp] = useState(false);
  const [pickupError, setPickupError] = useState<string | null>(null);
  const [expectedReturnDate, setExpectedReturnDate] = useState<string>("");

  // Initialize expected return date from booking data
  useEffect(() => {
    if (booking && booking.items && booking.items.length > 0) {
      const origReturn = booking.items[0].returnDate || "";
      const currentDay = todayISO();
      setExpectedReturnDate(origReturn && origReturn >= currentDay ? origReturn : currentDay);
    }
  }, [booking]);

  if (!booking) return null;

  const isCancelled = booking.status === "cancelled";
  const items = booking.items || [];
  const firstItem = items[0];

  // Schedule logic: read dates from booking_items
  const hasCommonDates = items.length > 0 && items.every(
    (i) => i.pickupDate === firstItem.pickupDate && i.returnDate === firstItem.returnDate && i.bufferDays === firstItem.bufferDays
  );

  const commonPickup = hasCommonDates ? firstItem.pickupDate : null;
  const commonReturn = hasCommonDates ? firstItem.returnDate : null;
  const commonBuffer = hasCommonDates ? firstItem.bufferDays : null;
  const commonAvailableAgain = commonReturn ? addDaysToDate(commonReturn, (commonBuffer || 0) + 1) : null;
  const commonDays = commonPickup && commonReturn && commonReturn >= commonPickup ? daysBetween(commonPickup, commonReturn) : 1;

  const today = todayISO();
  const fallbackPickup = commonPickup || firstItem?.pickupDate || null;
  const isEarlyPickup = fallbackPickup ? today < fallbackPickup : false;
  const isLatePickup = fallbackPickup ? today > fallbackPickup : false;

  const grandTotal = items.reduce((acc, item) => {
    const originalDays = item.pickupDate && item.returnDate && item.returnDate >= item.pickupDate ? daysBetween(item.pickupDate, item.returnDate) : 1;
    let actualDays = 1;
    if (expectedReturnDate && expectedReturnDate >= today) {
      actualDays = daysBetween(today, expectedReturnDate);
    }
    const billedDays = Math.max(originalDays, actualDays);
    return acc + (item.dailyRate * item.qty * billedDays);
  }, 0);

  const effectiveTotal = grandTotal; // Override booking.total with dynamic total
  const advancePaid = Number(booking.advance || 0);
  const securityDeposit = Number(booking.securityDeposit || 0);

  // Close outstanding rental balance to 0 on cancellation
  const remainingAmount = isCancelled ? 0 : Math.max(0, effectiveTotal - advancePaid);

  // Calculations for cancellation dialog
  const feeNum = typeof cancellationFeeInput === "number" ? cancellationFeeInput : 0;
  const calculatedAdvanceRefund = Math.max(0, advancePaid - feeNum);
  const calculatedDepositRefund = securityDeposit; // Always refunded 100% in full
  const totalRefundOutflow = calculatedAdvanceRefund + calculatedDepositRefund;

  const feeValidationError =
    feeNum < 0
      ? "Cancellation fee cannot be negative."
      : feeNum > advancePaid
      ? `Cancellation fee (${inr(feeNum)}) cannot exceed the advance payment received (${inr(advancePaid)}).`
      : null;

  const openCancelModal = () => {
    setCancellationFeeInput(0);
    setRefundPaymentMethod("cash");
    setCancellationReasonInput("");
    setCancelError(null);
    setShowConfirmCancel(true);
  };

  const handleCancel = async () => {
    setCancelError(null);
    if (feeValidationError) {
      setCancelError(feeValidationError);
      return;
    }

    if (totalRefundOutflow > 0 && !refundPaymentMethod) {
      setCancelError("Please select a refund payment method.");
      return;
    }

    setIsCancelling(true);
    try {
      await cancelBooking(booking.id, feeNum, refundPaymentMethod, cancellationReasonInput.trim());
      toast.success("Booking cancelled successfully. Reserved items and dates have been released.");
      setShowConfirmCancel(false);
      onClose();
      if (onCancelled) onCancelled();
    } catch (e: any) {
      console.error(e);
      setCancelError(e.message || "Failed to cancel booking");
    } finally {
      setIsCancelling(false);
    }
  };

  const handlePickup = async () => {
    setPickupError(null);
    if (!pickupPaymentMethod) {
      setPickupError("Please select a payment method for the remaining balance.");
      return;
    }
    if (!expectedReturnDate) {
      setPickupError("Please specify the expected return date.");
      return;
    }
    if (expectedReturnDate < today) {
      setPickupError("Expected return date cannot be in the past.");
      return;
    }
    setIsPickingUp(true);
    try {
      // Pass expected return date and exact remaining amount
      await pickupBooking(booking.id, expectedReturnDate, remainingAmount, pickupPaymentMethod);
      if (onCancelled) onCancelled(); // trigger a refresh
      onClose(); // close the modal on success
      if (onPickupSuccess) onPickupSuccess();
    } catch (e: any) {
      setPickupError(e.message || "Failed to process pickup.");
    } finally {
      setIsPickingUp(false);
    }
  };

  const isEligibleForCancel = !isCancelled && (booking.status === "confirmed" || booking.status === "pending");
  const isEligibleForPickup = !isCancelled && booking.status === "confirmed";

  return (
    <Dialog open={!!booking} onOpenChange={(v) => !v && !isCancelling && !isPickingUp && onClose()}>
      <DialogContent className="glass-strong max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full sm:max-w-2xl">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border pb-4">
          <div>
            <DialogTitle className="font-display text-2xl font-semibold flex items-center gap-2">
              <span>Booking</span>
              <span className="font-mono text-gold">{booking.token}</span>
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Created on {booking.bookingDate ? fmtDate(booking.bookingDate) : "Today"}
            </p>
          </div>
          <BookingStatusBadge status={booking.status} />
        </DialogHeader>

        {errorMsg && (
          <div className="mb-4 rounded-md border border-rust/50 bg-rust/10 p-3 text-sm text-rust flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="space-y-6 pt-2">
          {/* Cancelled Booking Accounting Banner */}
          {isCancelled && (
            <div className="rounded-xl border border-rust/40 bg-rust/10 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-rust/20 pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-rust flex items-center gap-1.5">
                  <XCircle className="w-4 h-4" /> Booking Cancelled — Accounting Summary
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  Cancelled {booking.cancelledAt ? fmtDate(booking.cancelledAt.slice(0, 10)) : "Earlier"}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div>
                  <span className="text-muted-foreground font-sans block text-[10px] uppercase">Retained Fee</span>
                  <strong className="text-sm font-semibold text-foreground">{inr(booking.cancellationFee || 0)}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground font-sans block text-[10px] uppercase">Advance Refund</span>
                  <strong className="text-sm font-semibold text-emerald">{inr(booking.advanceRefund || 0)}</strong>
                  {booking.refundPaymentMethod && (
                    <span className="text-[10px] font-sans text-muted-foreground block capitalize">via {booking.refundPaymentMethod.replace('_', ' ')}</span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground font-sans block text-[10px] uppercase">Deposit Refund</span>
                  <strong className="text-sm font-semibold text-emerald">{inr(booking.securityDepositRefund || 0)}</strong>
                  <span className="text-[10px] font-sans text-muted-foreground block">100% Refunded</span>
                </div>
                <div>
                  <span className="text-muted-foreground font-sans block text-[10px] uppercase">Rental Receivable</span>
                  <strong className="text-sm font-semibold text-emerald">₹0 (Closed)</strong>
                </div>
              </div>
              {booking.cancellationReason && (
                <div className="text-xs text-muted-foreground pt-1 border-t border-rust/10">
                  <span className="font-semibold text-foreground">Reason: </span>
                  <span className="italic">{booking.cancellationReason}</span>
                </div>
              )}
            </div>
          )}

          {/* Customer & Branch Grid */}
          <div className="grid grid-cols-2 gap-4 bg-white/[0.02] p-4 rounded-xl border border-border">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
              <p className="font-semibold text-foreground text-sm mt-1">{booking.customerName || "Walk-in Customer"}</p>
              <p className="font-mono text-xs text-emerald mt-0.5">{booking.customerPhone}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Branch</p>
              <p className="font-semibold text-foreground text-sm mt-1">{booking.branchName || booking.branchId}</p>
            </div>
          </div>

          {/* Schedule Summary (if common dates) */}
          {hasCommonDates && commonPickup && commonReturn && (
            <div className="bg-gold/10 p-4 rounded-xl border border-gold/30 space-y-2">
              <div className="flex items-center justify-between border-b border-gold/20 pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-gold flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" /> Schedule Overview
                </span>
                <span className="font-mono text-xs font-semibold text-foreground">{commonDays} Rental Day(s)</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Pickup / Give Date</span>
                  <strong className="font-mono text-gold text-sm font-semibold">{commonPickup ? fmtDate(commonPickup) : "-"}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Return Date</span>
                  <strong className="font-mono text-foreground text-sm">{commonReturn ? fmtDate(commonReturn) : "-"}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Maintenance Buffer</span>
                  <strong className="font-mono text-foreground text-sm">{commonBuffer} day(s)</strong>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Available Again</span>
                  <strong className="font-mono text-emerald text-sm font-semibold">{commonAvailableAgain ? fmtDate(commonAvailableAgain) : "-"}</strong>
                </div>
              </div>
            </div>
          )}

          {/* Booked Items Table (Historical Snapshot values preserved) */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Booked Items ({items.length})</h4>
            <div className="border border-border rounded-xl overflow-hidden divide-y divide-border bg-white/[0.01]">
              {items.map((item, idx) => {
                const originalDays = item.pickupDate && item.returnDate && item.returnDate >= item.pickupDate ? daysBetween(item.pickupDate, item.returnDate) : 1;
                let actualDays = 1;
                if (expectedReturnDate && expectedReturnDate >= today) {
                  actualDays = daysBetween(today, expectedReturnDate);
                }
                const billedDays = Math.max(originalDays, actualDays);
                const itemSubtotal = item.dailyRate * item.qty * billedDays;
                const availDate = item.returnDate ? addDaysToDate(item.returnDate, (item.bufferDays || 0) + 1) : "";

                return (
                  <div key={idx} className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm">{item.productName}</p>
                        <p className="text-xs font-mono text-muted-foreground">{item.sku}</p>
                        {item.assignedUnits && item.assignedUnits.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {item.assignedUnits.map((unit) => (
                              <span key={unit.id} className="inline-flex items-center gap-1 rounded bg-gold/10 border border-gold/30 px-1.5 py-0.5 text-[10px] font-mono text-gold font-semibold">
                                Unit: {unit.itemSku}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm font-semibold text-emerald">{inr(itemSubtotal)}</p>
                        <p className="text-[11px] font-mono text-muted-foreground">{inr(item.dailyRate)}/day × {item.qty} × {billedDays}d</p>
                      </div>
                    </div>

                    {!hasCommonDates && (
                      <div className="bg-white/[0.02] p-2 rounded text-[11px] font-mono grid grid-cols-3 gap-2 border border-border text-muted-foreground">
                        <div>Pickup: <span className="text-gold font-semibold">{fmtDate(item.pickupDate)}</span></div>
                        <div>Return: <span>{fmtDate(item.returnDate)}</span></div>
                        <div>Available: <span className="text-emerald">{availDate ? fmtDate(availDate) : "-"}</span></div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Read-Only Payment Summary (Preserving original booking financials) */}
          <div className="bg-white/[0.02] p-5 rounded-xl border border-border shadow-sm space-y-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gold">Payment Summary</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
              <div>
                <span className="text-muted-foreground font-sans block text-[10px] uppercase">Original Total</span>
                <strong className={`text-sm font-semibold ${isCancelled ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {inr(effectiveTotal)}
                </strong>
              </div>
              <div>
                <span className="text-muted-foreground font-sans block text-[10px] uppercase">Advance Received</span>
                <div className="flex flex-col">
                  <strong className="text-sm font-semibold text-emerald">{inr(advancePaid)}</strong>
                  {booking.advancePaymentMethod && <span className="text-[10px] font-sans text-muted-foreground capitalize mt-0.5">via {booking.advancePaymentMethod.replace('_', ' ')}</span>}
                </div>
              </div>
              <div>
                <span className="text-foreground font-sans block text-[10px] font-semibold uppercase">Remaining Amount</span>
                <strong className="text-base font-bold text-gold">{inr(remainingAmount)}</strong>
                {isCancelled && <span className="text-[10px] font-sans text-emerald block">Closed to ₹0</span>}
              </div>
              <div>
                <span className="text-muted-foreground font-sans block text-[10px] uppercase">Security Deposit</span>
                <div className="flex flex-col">
                  <strong className="text-sm font-semibold text-muted-foreground">{inr(securityDeposit)}</strong>
                  {booking.securityDepositPaymentMethod && <span className="text-[10px] font-sans text-muted-foreground capitalize mt-0.5">via {booking.securityDepositPaymentMethod.replace('_', ' ')}</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          {booking.notes && (
            <div className="bg-white/[0.02] p-3 rounded-lg border border-border text-xs">
              <span className="text-muted-foreground font-semibold block mb-1">Notes:</span>
              <p className="text-foreground italic">{booking.notes}</p>
            </div>
          )}

          {/* Process Pickup Workflow */}
          {isEligibleForPickup && (
            <div className="mt-6 border-t border-border pt-6">
              <h3 className="font-display text-xl font-semibold mb-4 text-emerald flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  Process Pickup
                </div>
                {isEarlyPickup && (
                  <span className="text-[10px] bg-gold/20 text-gold px-2 py-0.5 rounded uppercase tracking-wider font-bold">
                    Early Pickup
                  </span>
                )}
                {isLatePickup && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded uppercase tracking-wider font-bold">
                    Late Pickup
                  </span>
                )}
              </h3>
              
              <div className="bg-emerald/5 border border-emerald/20 p-4 rounded-xl space-y-4">
                <p className="text-sm text-muted-foreground">
                  The customer must pay the remaining rental amount of <strong className="text-gold font-mono">{inr(remainingAmount)}</strong> to start the rental.
                </p>

                {pickupError && (
                  <div className="rounded-md border border-rust/50 bg-rust/10 p-3 text-sm text-rust flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{pickupError}</span>
                  </div>
                )}

                <div className={`grid grid-cols-1 sm:grid-cols-2 ${isEarlyPickup || isLatePickup ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-4 mb-4`}>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                      Original Pickup
                    </label>
                    <div className="text-sm font-medium">{commonPickup ? fmtDate(commonPickup) : "-"}</div>
                  </div>
                  {(isEarlyPickup || isLatePickup) && (
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wider text-gold block mb-1">
                        Actual Pickup
                      </label>
                      <div className="text-sm font-bold text-gold">{fmtDate(today)}</div>
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                      Original Return
                    </label>
                    <div className="text-sm font-medium">{commonReturn ? fmtDate(commonReturn) : "-"}</div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-emerald block mb-1">
                      Expected Return Date
                    </label>
                    <DateInput
                      value={expectedReturnDate}
                      onChange={(v) => setExpectedReturnDate(v)}
                      min={today}
                      className="bg-surface border-border focus:border-gold focus:ring-1 focus:ring-gold rounded-lg text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                      Final Payment Amount
                    </label>
                    <input 
                      type="text" 
                      value={inr(remainingAmount)} 
                      readOnly 
                      className="w-full bg-surface border border-border text-gold font-mono font-bold rounded-lg px-3 py-2 text-sm outline-none cursor-default shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                      Payment Method
                    </label>
                    <select
                      className="w-full bg-surface border border-border focus:border-gold focus:ring-1 focus:ring-gold rounded-lg px-3 py-2 text-sm outline-none transition-all"
                      value={pickupPaymentMethod}
                      onChange={(e) => setPickupPaymentMethod(e.target.value)}
                    >
                      <option value="">[ Select Payment Method ]</option>
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank Transfer</option>
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handlePickup}
                  disabled={isPickingUp || !pickupPaymentMethod}
                  className="w-full py-3 bg-emerald hover:bg-emerald/90 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 mt-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald/20"
                >
                  {isPickingUp ? "Processing..." : `Complete Pickup & Start Rental`}
                </button>
              </div>
            </div>
          )}

          {/* Total & Action Bar */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div>
              <span className="text-xs tracking-wider uppercase text-muted-foreground block">
                {isCancelled ? "Original Total Amount" : "Total Booking Amount"}
              </span>
              <span className={`font-mono text-2xl font-semibold ${isCancelled ? 'text-muted-foreground line-through' : 'text-gold'}`}>
                {inr(effectiveTotal)}
              </span>
            </div>

            {isEligibleForCancel && (
              <button
                type="button"
                onClick={openCancelModal}
                className="px-4 py-2 bg-rust/20 hover:bg-rust/30 text-rust border border-rust/40 rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <XCircle className="w-4 h-4" />
                Cancel Booking
              </button>
            )}
          </div>
        </div>

        {/* Cancellation Accounting Dialog */}
        {showConfirmCancel && (
          <div className="fixed inset-0 bg-black/70 z-50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-surface border border-rust/50 p-6 rounded-2xl max-w-lg w-full space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center gap-3 border-b border-border pb-3">
                <div className="w-10 h-10 rounded-full bg-rust/20 text-rust flex items-center justify-center shrink-0">
                  <XCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold text-foreground">Cancel Booking {booking.token}</h3>
                  <p className="text-xs text-muted-foreground">
                    Original financial records are strictly preserved. Set cancellation fee and process refunds.
                  </p>
                </div>
              </div>

              {cancelError && (
                <div className="rounded-lg border border-rust/50 bg-rust/10 p-3 text-xs text-rust flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{cancelError}</span>
                </div>
              )}

              {/* Financial Snapshot */}
              <div className="bg-white/[0.02] border border-border rounded-xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div>
                  <span className="text-[10px] uppercase font-sans text-muted-foreground block">Rental Charge</span>
                  <strong className="text-foreground">{inr(effectiveTotal)}</strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-sans text-muted-foreground block">Advance Paid</span>
                  <strong className="text-emerald">{inr(advancePaid)}</strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-sans text-muted-foreground block">Sec. Deposit</span>
                  <strong className="text-muted-foreground">{inr(securityDeposit)}</strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-sans text-muted-foreground block">Receivable</span>
                  <strong className="text-gold">→ ₹0 (Closed)</strong>
                </div>
              </div>

              {/* Cancellation Form */}
              <div className="space-y-4 text-xs">
                {/* Cancellation Fee */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-foreground">
                      Retained Cancellation Fee (₹)
                    </label>
                    <span className="text-[10px] text-muted-foreground">
                      Max: {inr(advancePaid)}
                    </span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max={advancePaid}
                    value={cancellationFeeInput}
                    onChange={(e) => {
                      const val = e.target.value === "" ? "" : Number(e.target.value);
                      setCancellationFeeInput(val);
                    }}
                    placeholder="0"
                    className="w-full bg-surface border border-border focus:border-gold focus:ring-1 focus:ring-gold rounded-lg px-3 py-2 font-mono text-sm outline-none transition-all"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Default is ₹0 for full customer waiver. The fee is retained from advance received and counted once as earned revenue.
                  </p>
                </div>

                {/* Live Refund Breakdown */}
                <div className="rounded-xl border border-border/80 bg-surface-2/50 p-3 space-y-2 font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-sans">Advance Refund:</span>
                    <strong className="text-emerald">{inr(calculatedAdvanceRefund)}</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-sans flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-gold" /> Security Deposit Refund:
                    </span>
                    <strong className="text-emerald">{inr(calculatedDepositRefund)}</strong>
                  </div>
                  <div className="border-t border-border pt-1.5 flex items-center justify-between text-sm font-bold">
                    <span className="font-sans text-foreground">Total Refund Outflow:</span>
                    <span className="text-emerald">{inr(totalRefundOutflow)}</span>
                  </div>
                  <p className="text-[10px] font-sans text-muted-foreground italic">
                    Security deposit is always refunded 100% in full and never counted as rental revenue.
                  </p>
                </div>

                {/* Refund Payment Method */}
                {totalRefundOutflow > 0 && (
                  <div>
                    <label className="font-semibold text-foreground block mb-1">
                      Refund Payment Method <span className="text-rust">*</span>
                    </label>
                    <select
                      value={refundPaymentMethod}
                      onChange={(e) => setRefundPaymentMethod(e.target.value)}
                      className="w-full bg-surface border border-border focus:border-gold focus:ring-1 focus:ring-gold rounded-lg px-3 py-2 text-xs outline-none transition-all"
                    >
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank Transfer</option>
                    </select>
                  </div>
                )}

                {/* Reason / Notes */}
                <div>
                  <label className="font-semibold text-foreground block mb-1">
                    Cancellation Reason / Notes
                  </label>
                  <textarea
                    rows={2}
                    value={cancellationReasonInput}
                    onChange={(e) => setCancellationReasonInput(e.target.value)}
                    placeholder="e.g., Customer requested cancellation, date conflict, medical emergency..."
                    className="w-full bg-surface border border-border focus:border-gold focus:ring-1 focus:ring-gold rounded-lg px-3 py-2 text-xs outline-none transition-all"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowConfirmCancel(false)}
                  className="flex-1 py-2.5 px-4 border border-border rounded-xl text-xs font-medium hover:bg-white/5 transition-colors"
                  disabled={isCancelling}
                >
                  Keep Booking
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex-1 py-2.5 px-4 bg-rust text-white font-semibold rounded-xl text-xs hover:bg-rust/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-rust/20 flex items-center justify-center gap-1.5"
                  disabled={isCancelling || !!feeValidationError}
                >
                  {isCancelling ? "Processing Cancellation..." : "Confirm Cancellation & Release Dates"}
                </button>
              </div>
            </div>
          </div>
        )}

        <AdminBookingDelete booking={booking} onDeleted={onClose} />
      </DialogContent>
    </Dialog>
  );
}
