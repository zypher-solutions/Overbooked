import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useOverbooked } from "@/lib/overbooked/store";
import type { Rental } from "@/lib/overbooked/types";
import { balanceOf, inr } from "@/lib/overbooked/utils";
import { goldButtonClass, ghostButtonClass, inputClass } from "./primitives";
import { cn } from "@/lib/utils";

// Records a customer payment against a rental balance (works on active and returned rentals).
// The database function enforces 0 < amount <= balance and writes the payment row.
export function RecordPaymentModal({
  open,
  rental,
  onClose,
}: {
  open: boolean;
  rental: Rental | null;
  onClose: () => void;
}) {
  const { recordPayment } = useOverbooked();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("cash");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const balance = rental ? balanceOf(rental) : 0;

  useEffect(() => {
    if (!open) return;
    setAmount(balance);
    setMethod("cash");
  }, [open, balance]);

  if (!rental) return null;

  const invalid = !(amount > 0) || amount > balance;

  const submit = async () => {
    if (invalid || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await recordPayment(rental.id, amount, method);
      toast.success(`Payment of ${inr(amount)} recorded`);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to record payment");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isSubmitting && onClose()}>
      <DialogContent sheet={false} className="max-w-sm w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            {rental.token} · {rental.customerName}. Balance due {inr(balance)}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Amount (₹)
            </label>
            <input
              type="number"
              min={0}
              max={balance}
              aria-label="Payment amount in Rupees"
              className={cn(inputClass, "font-mono")}
              value={amount === 0 ? "" : amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
            {amount > balance && (
              <p className="mt-1 text-[11px] text-rust">Cannot exceed the balance due ({inr(balance)}).</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Paid by
            </label>
            <select
              aria-label="Payment method"
              className={inputClass}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
          </div>

          {!invalid && (
            <p className="rounded-md bg-white/[0.03] p-2 text-[11px] text-muted-foreground">
              Recording <strong className="text-foreground">{inr(amount)}</strong> by{" "}
              <strong className="text-foreground">{method.replace("_", " ")}</strong>. Balance after this payment:{" "}
              <strong className="text-foreground">{inr(balance - amount)}</strong>.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={ghostButtonClass} onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="button"
              className={cn(goldButtonClass, "disabled:opacity-50 disabled:cursor-not-allowed")}
              onClick={submit}
              disabled={isSubmitting || invalid}
            >
              {isSubmitting ? "Saving..." : "Record payment"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
