"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import { call, money, type RentalDetail } from "@/lib/shop/api";
import {
  CHARGE_LABELS, METHOD_LABELS, PAYMENT_LABELS, errorText, fmtDateTime, isoToZoned, num, rupees, zonedToIso,
} from "@/lib/shop/format";
import { MESSAGE_LABELS, buildMessage, waLink, type MessageKind } from "@/lib/shop/whatsapp";
import type { ChargeType, Method, PaymentKind } from "@/lib/shop/types";
import { Field, MethodPicker, Modal, MoneyRows, dangerButtonClass, ghostButtonClass, goldButtonClass, inputClass, monoInputClass } from "./ui";

interface DialogProps { rental: RentalDetail; open: boolean; onClose: () => void; onDone: () => void }

function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  return { busy, run };
}

// ==========================================================================
export function PaymentDialog({ rental, open, onClose, onDone }: DialogProps) {
  const m = money(rental);
  const [kind, setKind] = useState<PaymentKind>("payment");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method | "">("");
  const [note, setNote] = useState("");
  const { busy, run } = useBusy();

  const suggest = (k: PaymentKind) =>
    k === "payment" ? m.balance : k === "deposit" ? Math.max(0, Number(rental.deposit_agreed) - Number(rental.deposit_received))
      : k === "deposit_applied" ? Math.min(m.depositHeld, m.balance) : m.depositHeld;
  useEffect(() => {
    if (!open) return;
    const k: PaymentKind = m.balance > 0 ? "payment" : m.depositHeld > 0 && rental.status === "completed" ? "deposit_refund" : "payment";
    setKind(k);
    setAmount(suggest(k) > 0 ? String(suggest(k)) : "");
    setMethod("");
    setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const kinds: PaymentKind[] = rental.status === "cancelled" || rental.status === "no_show"
    ? ["deposit_refund"] : ["payment", "deposit", "deposit_refund", "deposit_applied"];

  const save = () => run(async () => {
    if (!(num(amount) > 0)) throw new Error("Enter an amount above zero.");
    if (kind !== "deposit_applied" && !method) throw new Error("Choose how the money moved.");
    await call("record_rental_payment", { p_rental_id: rental.id, p_kind: kind, p_amount: num(amount), p_method: kind === "deposit_applied" ? null : method, p_note: note || null });
    toast.success(`${PAYMENT_LABELS[kind]} recorded`);
    onDone();
    onClose();
  });

  return (
    <Modal open={open} onClose={onClose} title="Record money" description={`Balance ${rupees(m.balance)} · deposit held ${rupees(m.depositHeld)}`}
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Record"}</button></>}>
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); const s = suggest(k); setAmount(s > 0 ? String(s) : ""); }}
            className={cn("rounded-full border px-3 py-1 text-xs", kind === k ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}>
            {k === "deposit_applied" ? "Keep deposit for the balance" : PAYMENT_LABELS[k]}
          </button>
        ))}
      </div>
      <Field label="Amount"><input className={monoInputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      {kind !== "deposit_applied" ? <MethodPicker value={method} onChange={setMethod} /> : null}
      <Field label="Note"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

// ==========================================================================
export function ChargeDialog({ rental, open, onClose, onDone }: DialogProps) {
  const [type, setType] = useState<ChargeType>("challan");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { busy, run } = useBusy();
  useEffect(() => { if (open) { setType(rental.status === "completed" ? "challan" : "damage"); setAmount(""); setNote(""); } }, [open, rental.status]);

  const save = () => run(async () => {
    await call("add_rental_charge", { p_rental_id: rental.id, p_type: type, p_amount: num(amount), p_note: note || null });
    toast.success("Charge added");
    onDone();
    onClose();
  });

  return (
    <Modal open={open} onClose={onClose} title="Add a charge" description="For example a traffic fine or toll that arrived after the return, or damage found later."
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Add charge"}</button></>}>
      <Field label="Type">
        <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as ChargeType)}>
          {Object.entries(CHARGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Amount"><input className={monoInputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Note (challan no., what was damaged...)"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

// ==========================================================================
export function ExtendDialog({ rental, open, onClose, onDone }: DialogProps) {
  const { tz, word } = useShop();
  const [end, setEnd] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method | "">("");
  const { busy, run } = useBusy();
  useEffect(() => {
    if (open) { setEnd(isoToZoned(new Date(Date.parse(rental.end_at) + 24 * 3600 * 1000).toISOString(), tz)); setAmount(""); setMethod(""); }
  }, [open, rental.end_at, tz]);

  const save = () => run(async () => {
    if (num(amount) > 0 && !method) throw new Error("Choose how the payment was made.");
    const res = await call<{ total: number }>("extend_rental", {
      p_rental_id: rental.id, p_new_end: zonedToIso(end, tz),
      p_payment: num(amount) > 0 ? { amount: num(amount), method } : null,
    });
    toast.success(`Extended. New total ${rupees(res.total)}`);
    onDone();
    onClose();
  });

  return (
    <Modal open={open} onClose={onClose} title="Extend"
      description={`Now ${word("end").toLowerCase()} ${fmtDateTime(rental.end_at, tz)}. Items priced by rate are re-priced; agreed prices stay as they are.`}
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Extend"}</button></>}>
      <Field label={`New ${word("end").toLowerCase()}`}><input type="datetime-local" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      <Field label="Payment now (optional)"><input className={monoInputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      {num(amount) > 0 ? <MethodPicker value={method} onChange={setMethod} /> : null}
    </Modal>
  );
}

// ==========================================================================
export function CancelDialog({ rental, open, onClose, onDone }: DialogProps) {
  const m = money(rental);
  const started = Date.parse(rental.start_at) <= Date.now();
  const [fee, setFee] = useState("");
  const [method, setMethod] = useState<Method | "">("");
  const [reason, setReason] = useState("");
  const [noShow, setNoShow] = useState(false);
  const { busy, run } = useBusy();
  useEffect(() => { if (open) { setFee(""); setMethod(""); setReason(""); setNoShow(false); } }, [open]);

  const refund = Math.max(0, m.paid - num(fee));
  const save = () => run(async () => {
    if (num(fee) > m.paid) throw new Error(`The fee cannot be more than what was paid (${rupees(m.paid)}).`);
    if ((refund > 0 || m.depositHeld > 0) && !method) throw new Error("Choose how the money is given back.");
    await call("cancel_rental", { p_rental_id: rental.id, p_fee: num(fee), p_refund_method: method || null, p_reason: reason || null, p_no_show: noShow });
    toast.success(noShow ? "Marked as no-show" : "Booking cancelled");
    onDone();
    onClose();
  });

  return (
    <Modal open={open} onClose={onClose} title={`Cancel ${rental.token}`}
      description="The booked units are freed at once. Any fee is kept from what was paid; the rest and the deposit are given back."
      footer={<><button className={ghostButtonClass} onClick={onClose}>Keep booking</button><button className={dangerButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : noShow ? "Mark no-show" : "Cancel booking"}</button></>}>
      <Field label="Cancellation fee kept" hint={`Paid so far ${rupees(m.paid)}`}><input className={monoInputClass} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></Field>
      <MoneyRows rows={[["Refund", rupees(refund)], ["Deposit returned", rupees(m.depositHeld)]]} />
      {refund > 0 || m.depositHeld > 0 ? <MethodPicker value={method} onChange={setMethod} /> : null}
      <Field label="Reason"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {started ? (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noShow} onChange={(e) => setNoShow(e.target.checked)} /> The customer did not come (no-show)</label>
      ) : null}
    </Modal>
  );
}

// ==========================================================================
export function SwapDialog({ rental, open, onClose, onDone }: DialogProps) {
  const held = rental.unit_reservations.filter((u) => u.state === "held");
  const [from, setFrom] = useState("");
  const [options, setOptions] = useState<{ unit_id: string; code: string }[] | null>(null);
  const [to, setTo] = useState("");
  const { busy, run } = useBusy();

  useEffect(() => { if (open) { setFrom(held[0]?.unit_id ?? ""); setTo(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const res = held.find((u) => u.unit_id === from);
    if (!open || !res) return;
    setOptions(null);
    void call<{ unit_id: string; code: string }[]>("find_available_units", {
      p_branch_id: rental.branch_id, p_variation_id: res.units?.variation_id, p_start: rental.start_at, p_end: rental.end_at,
    }).then(setOptions).catch((e) => toast.error(errorText(e)));
  }, [open, from]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => run(async () => {
    if (!to) throw new Error("Choose the unit to give instead.");
    await call("swap_unit", { p_rental_id: rental.id, p_old_unit_id: from, p_new_unit_id: to });
    toast.success("Swapped");
    onDone();
    onClose();
  });

  return (
    <Modal open={open} onClose={onClose} title="Give another unit" description="For example when the booked one is damaged or in service. Same item, same branch."
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Swap"}</button></>}>
      <Field label="Instead of">
        <select className={inputClass} value={from} onChange={(e) => { setFrom(e.target.value); setTo(""); }}>
          {held.map((u) => <option key={u.unit_id} value={u.unit_id}>{u.units?.code}</option>)}
        </select>
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {options === null ? <span className="text-sm text-muted-foreground">Loading...</span> : options.length === 0
          ? <span className="text-sm text-rust">No other unit of this item is free for these dates.</span>
          : options.map((u) => (
            <button key={u.unit_id} type="button" aria-pressed={to === u.unit_id} onClick={() => setTo(u.unit_id)}
              className={cn("rounded-md border px-2.5 py-1 font-mono text-xs", to === u.unit_id ? "border-gold bg-gold/10" : "border-border")}>{u.code}</button>
          ))}
      </div>
    </Modal>
  );
}

// ==========================================================================
// Owner corrections: every one needs a reason and is written to the audit log
type Fix =
  | { kind: "discount" }
  | { kind: "line"; id: string; label: string; amount: number }
  | { kind: "payment"; id: string; label: string; amount: number; method: Method | null }
  | { kind: "delete_payment"; id: string; label: string }
  | { kind: "delete_charge"; id: string; label: string }
  | { kind: "delete_rental" };

export function CorrectionDialog({ rental, fix, onClose, onDone }: { rental: RentalDetail; fix: Fix | null; onClose: () => void; onDone: (deleted?: boolean) => void }) {
  const [value, setValue] = useState("");
  const [method, setMethod] = useState<Method | "">("");
  const [reason, setReason] = useState("");
  const { busy, run } = useBusy();

  useEffect(() => {
    if (!fix) return;
    setReason("");
    setValue(fix.kind === "discount" ? String(rental.discount) : fix.kind === "line" || fix.kind === "payment" ? String(fix.amount) : "");
    setMethod(fix.kind === "payment" ? fix.method ?? "" : "");
  }, [fix, rental.discount]);

  if (!fix) return null;
  const title = {
    discount: "Change the discount", line: `Change the price of ${"label" in fix ? fix.label : ""}`, payment: "Correct a payment",
    delete_payment: "Delete a payment", delete_charge: "Remove a charge", delete_rental: `Delete ${rental.token} for good`,
  }[fix.kind];
  const destructive = fix.kind.startsWith("delete");

  const save = () => run(async () => {
    if (reason.trim().length < 3) throw new Error("Write the reason (it is kept in the audit log).");
    if (fix.kind === "discount") await call("admin_set_discount", { p_rental_id: rental.id, p_discount: num(value), p_reason: reason });
    if (fix.kind === "line") await call("admin_set_line_amount", { p_line_id: fix.id, p_amount: num(value), p_reason: reason });
    if (fix.kind === "payment") await call("admin_update_payment", { p_payment_id: fix.id, p_amount: num(value), p_method: method || null, p_reason: reason });
    if (fix.kind === "delete_payment") await call("admin_delete_payment", { p_payment_id: fix.id, p_reason: reason });
    if (fix.kind === "delete_charge") await call("admin_delete_charge", { p_charge_id: fix.id, p_reason: reason });
    if (fix.kind === "delete_rental") await call("admin_delete_rental", { p_rental_id: rental.id, p_reason: reason });
    toast.success("Saved");
    onDone(fix.kind === "delete_rental");
    onClose();
  });

  return (
    <Modal open onClose={onClose} title={title}
      description={fix.kind === "delete_rental" ? "The booking, its items, charges and payments are removed. Only finished or cancelled bookings can be deleted." : "Owners only. The change and its reason are kept in the audit log."}
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button>
        <button className={destructive ? dangerButtonClass : goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : destructive ? "Delete" : "Save"}</button></>}>
      {"label" in fix && destructive ? <p className="text-sm">{fix.label}</p> : null}
      {fix.kind === "discount" || fix.kind === "line" || fix.kind === "payment" ? (
        <Field label="Amount"><input className={monoInputClass} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
      ) : null}
      {fix.kind === "payment" && fix.method ? <MethodPicker value={method} onChange={setMethod} /> : null}
      <Field label="Reason"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}
export type { Fix };

// ==========================================================================
export function WhatsAppDialog({ rental, open, onClose, initial }: { rental: RentalDetail; open: boolean; onClose: () => void; initial?: MessageKind }) {
  const { shop, tz, branches, word } = useShop();
  const branch = branches.find((b) => b.id === rental.branch_id);
  const defaultKind: MessageKind = initial ?? (rental.status === "reserved" ? "confirmation" : rental.status === "active" ? "return_reminder" : "receipt");
  const [kind, setKind] = useState<MessageKind>(defaultKind);
  const [text, setText] = useState("");

  useEffect(() => { if (open) setKind(defaultKind); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setText(buildMessage(kind, rental, { shopName: shop.name, branchName: branch?.name, branchPhone: branch?.phone ?? shop.phone, tz, startWord: word("start"), endWord: word("end") }));
  }, [kind, rental, shop, branch, tz, word]);

  return (
    <Modal open={open} onClose={onClose} title={`WhatsApp ${rental.customers.full_name}`} description={rental.customers.phone}
      footer={<><button className={ghostButtonClass} onClick={onClose}>Close</button>
        <a className={goldButtonClass} href={waLink(rental.customers.phone, text)} target="_blank" rel="noreferrer" onClick={onClose}>
          <MessageCircle className="h-4 w-4" /> Open WhatsApp
        </a></>}>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(MESSAGE_LABELS) as MessageKind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
            className={cn("rounded-full border px-3 py-1 text-xs", kind === k ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}>
            {MESSAGE_LABELS[k]}
          </button>
        ))}
      </div>
      <textarea className={inputClass} rows={10} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
    </Modal>
  );
}

export { METHOD_LABELS };
