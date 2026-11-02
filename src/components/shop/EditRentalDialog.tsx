"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DateTimeInput } from "@/components/shop/DateInput";
import { call, type RentalDetail } from "@/lib/shop/api";
import { CHARGE_LABELS, errorText, isoToZoned, num, rupees, zonedToIso } from "@/lib/shop/format";
import { useShop } from "@/lib/shop/ShopContext";
import type { ChargeType, Method } from "@/lib/shop/types";
import { moneyError, textLimitError } from "@/lib/validate";
import { Field, MethodPicker, Modal, ghostButtonClass, goldButtonClass, inputClass, monoInputClass } from "./ui";

// Edit for a rental that is out: a later return date (extend), money taken now, a charge, and the notes, in one card.
// (What was booked cannot change after pickup; a booking that has not gone out is edited in the booking card.)
export function EditRentalDialog({ rental, open, onClose, onDone }: { rental: RentalDetail; open: boolean; onClose: () => void; onDone: () => void | Promise<void> }) {
  const { tz, word, canManage } = useShop();
  const [end, setEnd] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<Method | "">("");
  const [chargeType, setChargeType] = useState<ChargeType>("damage");
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeNote, setChargeNote] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEnd(isoToZoned(rental.end_at, tz));
    setPayAmount(""); setPayMethod(""); setChargeType("damage"); setChargeAmount(""); setChargeNote("");
    setNotes(rental.notes ?? "");
    setTried(false);
  }, [open, rental, tz]);

  const endChanged = !!end && zonedToIso(end, tz) !== rental.end_at;
  const errs = {
    end: !end ? "Choose the return date." : endChanged && zonedToIso(end, tz) <= rental.end_at ? `The new ${word("end").toLowerCase()} must be after the current one.` : null,
    pay: moneyError(payAmount, { label: "payment", positive: true, max: 1_000_000 }),
    payMethod: num(payAmount) > 0 && !payMethod ? "Choose how the payment was made." : null,
    charge: chargeAmount.trim() ? moneyError(chargeAmount, { label: "charge", positive: true, max: 1_000_000 }) : null,
    chargeNote: textLimitError(chargeNote, "charge note", 200),
    notes: textLimitError(notes, "notes", 600),
  };
  const bad = Object.values(errs).some(Boolean);

  const save = async () => {
    setTried(true);
    if (bad) return toast.error(Object.values(errs).find(Boolean)!);
    setBusy(true);
    try {
      // one step after another; a message says which one stopped if something fails
      if (endChanged) await call("extend_rental", { p_rental_id: rental.id, p_new_end: zonedToIso(end, tz), p_payment: null });
      if (num(payAmount) > 0) await call("record_rental_payment", { p_rental_id: rental.id, p_kind: "payment", p_amount: num(payAmount), p_method: payMethod, p_note: null });
      if (num(chargeAmount) > 0) await call("add_rental_charge", { p_rental_id: rental.id, p_type: chargeType, p_amount: num(chargeAmount), p_note: chargeNote.trim() || null });
      if (notes.trim() !== (rental.notes ?? "").trim()) await call("update_rental_notes", { p_rental_id: rental.id, p_notes: notes });
      toast.success("Saved");
      await onDone();
      onClose();
    } catch (e) {
      toast.error(errorText(e));
      await onDone(); // show whatever was saved before the stop
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${rental.token}`} description="Change the return date, take money, add a charge or update the notes."
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} disabled={busy || (tried && bad)} onClick={save}>{busy ? "Saving..." : "Save"}</button></>}>
      <Field label={`${word("end")} (change it to extend)`} error={errs.end ?? undefined}><DateTimeInput value={end} onChange={(v) => setEnd(v)} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Take payment now (₹)" hint="Optional" error={payAmount.trim() ? errs.pay ?? undefined : undefined}>
          <input className={monoInputClass} inputMode="decimal" maxLength={10} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
        </Field>
        {num(payAmount) > 0 ? <div className="self-end"><MethodPicker value={payMethod} onChange={setPayMethod} error={tried ? errs.payMethod ?? undefined : undefined} /></div> : null}
      </div>
      {canManage ? (
        <div className="grid gap-3 sm:grid-cols-[150px_1fr_110px]">
          <Field label="Add a charge">
            <select className={inputClass} value={chargeType} onChange={(e) => setChargeType(e.target.value as ChargeType)}>
              {Object.entries(CHARGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Note" error={errs.chargeNote ?? undefined}><input className={inputClass} maxLength={220} value={chargeNote} onChange={(e) => setChargeNote(e.target.value)} /></Field>
          <Field label="Amount (₹)" error={errs.charge ?? undefined}><input className={monoInputClass} inputMode="decimal" maxLength={10} value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} /></Field>
        </div>
      ) : null}
      <Field label="Notes" error={errs.notes ?? undefined}><textarea className={inputClass} rows={3} maxLength={640} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <p className="text-xs text-muted-foreground">Balance now {rupees(Number(rental.total) - Number(rental.paid))}. Items cannot be changed after pickup.</p>
    </Modal>
  );
}
