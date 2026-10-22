import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOverbooked } from "@/lib/overbooked/store";
import type { PaymentStatus, Rental } from "@/lib/overbooked/types";
import { daysBetween, inr, todayISO } from "@/lib/overbooked/utils";
import { Field, goldButtonClass, inputClass, monoInputClass } from "./primitives";
import { DateInput } from "./DateInput";
import { MessageCircle } from "lucide-react";

export function EditRentalModal({
  rental,
  onClose,
}: {
  rental: Rental | null;
  onClose: () => void;
}) {
  const { updateRental, extendRental } = useOverbooked();
  const [form, setForm] = useState<Rental | null>(rental);
  const [error, setError] = useState("");
  const [extensionPaymentMethod, setExtensionPaymentMethod] = useState("cash");
  const [isExtending, setIsExtending] = useState(false);

  useEffect(() => {
    if (rental) {
      setForm(rental);
      setError("");
    }
  }, [rental]);

  if (!rental || !form) return null;

  const set = <K extends keyof Rental>(key: K, value: Rental[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const days = form.rentDate && form.dueDate && form.dueDate > form.rentDate ? daysBetween(form.rentDate, form.dueDate) : 1;
  const expectedTotal = form.items?.reduce((acc, item) => acc + (item.dailyRate * item.qty * days), 0) || 0;
  // Discount is fixed at booking and stored by the database; shown here, never edited
  const rentalDays = rental.rentDate && rental.dueDate && rental.dueDate > rental.rentDate ? daysBetween(rental.rentDate, rental.dueDate) : 1;
  const discount = Math.max(0, (rental.items?.reduce((acc, item) => acc + (item.dailyRate * item.qty * rentalDays), 0) || 0) - rental.total);
  const computedTotal = Math.max(0, expectedTotal - discount);
  const balance = Math.max(0, computedTotal - form.advance);
  const dynamicPaymentStatus: PaymentStatus =
    form.advance >= computedTotal ? "paid" : form.advance > 0 ? "partial" : "unpaid";

  const isExtension = form.dueDate !== rental.dueDate;

  const save = async () => {
    if (!form.customerName.trim()) return setError("Customer name is required");
    if (form.dueDate <= form.rentDate) return setError("Due date must be after the rent date");
    if (form.advance > form.total) return setError("Advance cannot exceed the total");
    
    setIsExtending(true);
    setError("");
    
    try {
      if (isExtension) {
        const additionalAmount = Math.max(0, computedTotal - rental.total);
        const newAdvance = form.advance;
        const additionalPayment = Math.max(0, newAdvance - rental.advance);
        
        await extendRental(rental.id, form.dueDate, additionalPayment, extensionPaymentMethod, form.notes);
      }
      
      // Update safe fields
      updateRental(rental.id, {
        notes: form.notes,
      });
      
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to update rental.");
    } finally {
      setIsExtending(false);
    }
  };

  return (
    <Dialog open={!!rental} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="glass-strong max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold">
            Edit Rental{" "}
            <span className="font-mono text-base font-medium text-gold">{rental.token}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 rounded-md bg-white/[0.03] p-4 border border-border">
            <h4 className="text-xs tracking-wider text-muted-foreground uppercase mb-2">Items ({form.items?.length || 0})</h4>
            <div className="space-y-2 mt-2">
              {form.items?.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm">
                  <div>
                    <span className="font-medium text-foreground">{item.productName}</span>
                    <span className="text-xs text-muted-foreground ml-2">x{item.qty}</span>
                  </div>
                  <span className="font-mono text-muted-foreground">{inr(item.dailyRate)}/day</span>
                </div>
              ))}
            </div>
          </div>
          <Field label="Branch" className="sm:col-span-2">
            <input className={inputClass + " opacity-70 bg-white/[0.02]"} value={form.branch} readOnly />
          </Field>

          <Field label="Customer Name">
            <input
              className={inputClass}
              value={form.customerName}
              onChange={(e) => set("customerName", e.target.value)}
            />
          </Field>
          <Field label="Customer Phone" hint="Required · +91 or 10 digits">
            <div className="relative">
              <input
                className={monoInputClass + " pr-9"}
                value={form.customerPhone}
                onChange={(e) => set("customerPhone", e.target.value)}
              />
              <MessageCircle className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-emerald" />
            </div>
          </Field>
          <Field label="Rent Date">
            <DateInput
              value={form.rentDate}
              onChange={(v) => set("rentDate", v)}
            />
          </Field>
          <Field label="Due Date">
            <DateInput
              min={form.rentDate}
              value={form.dueDate}
              onChange={(v) => set("dueDate", v)}
            />
          </Field>
          <Field label="Maintenance Buffer (Days)" hint="Days at dry cleaner post-return">
            <input
              type="number"
              min={0}
              className={monoInputClass}
              value={form.bufferDays === 0 ? "" : form.bufferDays}
              onChange={(e) => set("bufferDays", Number(e.target.value))}
            />
          </Field>

          <Field label="Discount (₹)" hint="Fixed at booking. A super admin can correct it from Admin tools.">
            <input
              type="number"
              className={monoInputClass + " opacity-70 bg-white/[0.02] cursor-not-allowed"}
              value={discount === 0 ? "" : discount}
              readOnly
              disabled
            />
          </Field>
          <Field label="Total Amount (₹)">
            <input
              type="number"
              className={monoInputClass + " opacity-70 bg-white/[0.02] cursor-not-allowed"}
              value={computedTotal === 0 ? "" : computedTotal}
              readOnly
              tabIndex={-1}
            />
          </Field>
          <Field label="Advance Paid (₹)">
            <input
              type="number"
              className={monoInputClass}
              value={form.advance === 0 ? "" : form.advance}
              onChange={(e) => set("advance", Number(e.target.value))}
            />
          </Field>
          <Field label="Security Deposit (₹)" hint="Fixed at booking; settled when the rental is returned">
            <input
              type="number"
              className={monoInputClass}
              value={form.securityDeposit === 0 ? "" : form.securityDeposit || ""}
              readOnly
              disabled
            />
          </Field>
          <Field label="Payment Status">
            <select
              className={inputClass}
              value={dynamicPaymentStatus}
              disabled
            >
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </select>
          </Field>
          {isExtension && (form.advance > rental.advance) && (
            <Field label="Extension Payment Method">
              <select
                className={inputClass}
                value={extensionPaymentMethod}
                onChange={(e) => setExtensionPaymentMethod(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
            </Field>
          )}
          <Field label="Notes" className="sm:col-span-2">
            <textarea
              rows={2}
              className={inputClass}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-2 flex items-center justify-between rounded-lg border border-border bg-white/[0.03] px-4 py-3">
          <span className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
            Balance Due
          </span>
          <span className="font-mono text-xl font-semibold text-gold">{inr(balance)}</span>
        </div>

        {error ? <p className="text-xs text-rust">{error}</p> : null}

        <button className={goldButtonClass + " mt-2 w-full"} onClick={save} disabled={isExtending}>
          {isExtending ? "Updating..." : (isExtension ? "Process Secure Extension" : "Update Rental")}
        </button>
      </DialogContent>
    </Dialog>
  );
}
