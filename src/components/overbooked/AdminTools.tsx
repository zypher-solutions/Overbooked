import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { useOverbooked } from "@/lib/overbooked/store";
import type { Booking, Rental } from "@/lib/overbooked/types";
import { inr } from "@/lib/overbooked/utils";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./ConfirmDialog";
import { ghostButtonClass, goldButtonClass, inputClass, monoInputClass } from "./primitives";

// Super-admin corrections. Every call goes through a database function that checks the role, requires a
// reason and writes audit_log. Nobody else can change or delete these records.

type PaymentRow = { id: string; amount: number; method: string | null; paid_at: string; note: string | null };

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
];

const dangerButtonClass =
  "rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed";

const labelClass = "mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground";

export function AdminRentalTools({ rental, onDeleted }: { rental: Rental; onDeleted?: () => void }) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);

  if (profile?.role !== "super_admin" || rental.isBooking) return null;

  return (
    <div className="border-t border-border/50 pt-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold transition-colors hover:bg-gold/20"
      >
        <ShieldAlert className="h-3.5 w-3.5" />
        Admin tools: edit or delete this record
      </button>
      <AdminRentalModal
        open={open}
        rentalId={rental.id}
        onClose={() => setOpen(false)}
        onDeleted={onDeleted}
      />
    </div>
  );
}

function AdminRentalModal({
  open,
  rentalId,
  onClose,
  onDeleted,
}: {
  open: boolean;
  rentalId: string;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { rentals, fetchInitialData } = useOverbooked();
  const rental = rentals.find((r) => r.id === rentalId) || null;

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [pending, setPending] = useState<{ message: string; action: () => void } | null>(null);
  const [reason, setReason] = useState("");
  const [total, setTotal] = useState(0);
  const [deposit, setDeposit] = useState(0);
  const [notes, setNotes] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState(0);
  const [editMethod, setEditMethod] = useState("cash");
  const [busy, setBusy] = useState(false);

  const loadPayments = useCallback(async () => {
    setLoadingPayments(true);
    const { data, error } = await supabase
      .from("payments")
      .select("id, amount, method, paid_at, note")
      .eq("rental_id", rentalId)
      .order("paid_at", { ascending: true });
    if (error) {
      toast.error("Could not load payments: " + error.message);
    }
    setPayments((data as PaymentRow[]) || []);
    setLoadingPayments(false);
  }, [supabase, rentalId]);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setEditId(null);
    loadPayments();
  }, [open, loadPayments]);

  // Fill the form once per opening (not on every live update, which would overwrite typing)
  useEffect(() => {
    if (!open || !rental) return;
    setTotal(rental.total || 0);
    setDeposit(rental.securityDeposit || 0);
    setNotes(rental.notes || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rentalId]);

  if (!rental) return null;

  const reasonOk = reason.trim().length >= 3;

  const run = async (fn: () => Promise<void>, okMessage: string): Promise<boolean> => {
    if (!reasonOk) {
      toast.error("Enter a reason (at least 3 characters). It is saved in the audit log.");
      return false;
    }
    setBusy(true);
    try {
      await fn();
      toast.success(okMessage);
      await fetchInitialData({ silent: true });
      await loadPayments();
      return true;
    } catch (e: any) {
      toast.error(e.message || "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { error } = await supabase.rpc(name, args);
    if (error) throw new Error(error.message);
  };

  const saveRental = () =>
    run(
      () =>
        rpc("admin_update_rental", {
          p_rental_id: rental.id,
          p_total: total,
          p_security_deposit: deposit,
          p_notes: notes,
          p_reason: reason.trim(),
        }),
      "Rental updated",
    );

  const savePayment = async (id: string) => {
    const ok = await run(
      () =>
        rpc("admin_update_payment", {
          p_payment_id: id,
          p_amount: editAmount,
          p_method: editMethod,
          p_reason: reason.trim(),
        }),
      "Payment updated",
    );
    if (ok) setEditId(null);
  };

  // Ask for the reason before the confirm dialog, not after the user has confirmed.
  const reasonFirst = (open: () => void) => {
    if (!reasonOk) toast.error("Enter a reason (at least 3 characters). It is saved in the audit log.");
    else open();
  };

  const removePayment = (p: PaymentRow) =>
    reasonFirst(() => setPending({
      message: `Delete this ${inr(p.amount)} payment? The rental balance will be recalculated.`,
      action: () =>
        void run(
          () => rpc("admin_delete_payment", { p_payment_id: p.id, p_reason: reason.trim() }),
          "Payment deleted",
        ),
    }));

  const removeRental = () =>
    reasonFirst(() => setPending({
      message: `Delete rental ${rental.token} with its ${payments.length} payment(s) and all items?\n\nThis cannot be undone from the app. A copy is kept in the audit log.`,
      action: doRemoveRental,
    }));

  const doRemoveRental = async () => {
    const ok = await run(
      () => rpc("admin_delete_rental", { p_rental_id: rental.id, p_reason: reason.trim() }),
      "Rental deleted",
    );
    if (ok) {
      onClose();
      onDeleted?.();
    }
  };

  const isOut = rental.status === "out";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="glass-strong max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-semibold">
            Admin tools · {rental.token}
          </DialogTitle>
          <DialogDescription>
            Super admin only. Every change needs a reason and is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <label className={labelClass}>Reason (required)</label>
            <input
              type="text"
              aria-label="Reason for the change"
              className={inputClass}
              placeholder="e.g. Amount typed wrong at pickup, test entry"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {/* Edit rental */}
          <section className="space-y-2.5 rounded-md border border-border/60 bg-white/[0.02] p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Rental amounts
            </h4>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className={labelClass}>Total (₹)</label>
                <input
                  type="number"
                  min={0}
                  aria-label="Rental total in Rupees"
                  className={monoInputClass}
                  value={total}
                  onChange={(e) => setTotal(Number(e.target.value))}
                />
              </div>
              <div>
                <label className={labelClass}>Security deposit (₹)</label>
                <input
                  type="number"
                  min={0}
                  aria-label="Security deposit in Rupees"
                  className={monoInputClass}
                  value={deposit}
                  onChange={(e) => setDeposit(Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <textarea
                rows={2}
                aria-label="Rental notes"
                className={inputClass}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Paid so far {inr(rental.advance || 0)}. The paid/partial/unpaid status is recalculated. Item
              prices are not changed, so keep the total consistent with them.
            </p>
            <button type="button" className={goldButtonClass} disabled={busy} onClick={saveRental}>
              {busy ? "Saving..." : "Save rental changes"}
            </button>
          </section>

          {/* Payments */}
          <section className="space-y-2 rounded-md border border-border/60 bg-white/[0.02] p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Payments ({payments.length})
            </h4>
            {loadingPayments ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : payments.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No payment rows. (An advance collected at booking is part of the rental's paid amount but
                has no payment row.)
              </p>
            ) : (
              <ul className="space-y-2">
                {payments.map((p) => (
                  <li key={p.id} className="rounded-md border border-border/50 p-2 text-xs">
                    {editId === p.id ? (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <input
                          type="number"
                          min={0}
                          aria-label="Payment amount in Rupees"
                          className={monoInputClass}
                          value={editAmount}
                          onChange={(e) => setEditAmount(Number(e.target.value))}
                        />
                        <select
                          aria-label="Payment method"
                          className={inputClass}
                          value={editMethod}
                          onChange={(e) => setEditMethod(e.target.value)}
                        >
                          {METHODS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={cn(goldButtonClass, "flex-1")}
                            disabled={busy}
                            onClick={() => savePayment(p.id)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className={cn(ghostButtonClass, "flex-1")}
                            disabled={busy}
                            onClick={() => setEditId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-mono font-semibold">{inr(p.amount)}</span>
                          <span className="ml-2 capitalize text-muted-foreground">
                            {(p.method || "—").replace("_", " ")}
                          </span>
                          <span className="ml-2 text-muted-foreground">
                            {new Date(p.paid_at).toLocaleString("en-IN")}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={ghostButtonClass}
                            disabled={busy}
                            onClick={() => {
                              setEditId(p.id);
                              setEditAmount(p.amount);
                              setEditMethod(p.method || "cash");
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={dangerButtonClass}
                            disabled={busy}
                            onClick={() => removePayment(p)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Delete */}
          <section className="space-y-2 rounded-md border border-red-500/30 bg-red-500/5 p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-red-400">
              Delete this rental
            </h4>
            {isOut ? (
              <p className="text-xs text-muted-foreground">
                This rental is still out. Mark it as returned first, then it can be deleted.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Removes the rental, its items and its payments from every total. A copy is saved in the
                audit log.
              </p>
            )}
            <button
              type="button"
              className={dangerButtonClass}
              disabled={busy || isOut}
              onClick={removeRental}
            >
              Delete rental
            </button>
          </section>
        </div>
        <ConfirmDialog
          open={!!pending}
          message={pending?.message ?? ""}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const a = pending?.action;
            setPending(null);
            a?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function AdminBookingDelete({
  booking,
  onDeleted,
}: {
  booking: Booking;
  onDeleted: () => void;
}) {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { fetchBookings, fetchInitialData } = useOverbooked();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (profile?.role !== "super_admin") return null;

  const remove = async () => {
    if (reason.trim().length < 3) {
      toast.error("Enter a reason (at least 3 characters). It is saved in the audit log.");
      return;
    }
    setConfirmOpen(true);
  };

  const doRemove = async () => {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const { error } = await supabase.rpc("admin_delete_booking", {
        p_booking_id: booking.id,
        p_reason: reason.trim(),
      });
      if (error) throw new Error(error.message);
      toast.success("Booking deleted");
      await fetchBookings();
      await fetchInitialData({ silent: true });
      onDeleted();
    } catch (e: any) {
      toast.error(e.message || "Could not delete the booking");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 space-y-2 rounded-md border border-red-500/30 bg-red-500/5 p-3">
      <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-400">
        <ShieldAlert className="h-3.5 w-3.5" /> Admin: delete this booking
      </h4>
      <input
        type="text"
        aria-label="Reason for deleting the booking"
        className={inputClass}
        placeholder="Reason (required, saved in the audit log)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button type="button" className={dangerButtonClass} disabled={busy} onClick={remove}>
        {busy ? "Deleting..." : "Delete booking"}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        message={`Delete booking ${booking.token}?\n\nAdvance ${inr(booking.advance || 0)} and deposit ${inr(
          booking.securityDeposit || 0,
        )} recorded on it will disappear from the totals. A copy is kept in the audit log.`}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={doRemove}
      />
    </section>
  );
}
