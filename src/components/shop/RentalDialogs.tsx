"use client";

import { DateInput, DateTimeInput } from "@/components/shop/DateInput";
import { useEffect, useState } from "react";
import { MessageCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import { call, money, type RentalDetail } from "@/lib/shop/api";
import {
  CHARGE_LABELS, METHOD_LABELS, PAYMENT_LABELS, errorText, fmtDateTime, isoToZoned, num, rupees, todayLocal, zonedToIso,
} from "@/lib/shop/format";
import { MESSAGE_LABELS, buildMessage, waLink, type MessageKind } from "@/lib/shop/whatsapp";
import type { ChargeType, Method, PaymentKind } from "@/lib/shop/types";
import { moneyError, reasonError, textLimitError } from "@/lib/validate";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
  const { isOwner, role, setting } = useShop();
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

  // while the piece is out, only the owner can give the deposit back (the database enforces it); staff do it at return
  // before the return only the owner, or managers when Settings > Staff controls allows it (migration 039)
  const refundNow = isOwner || (role === "manager" && setting<string>("early_deposit_refund_role", "owner") === "owner_manager") || rental.status === "completed";
  const kinds: PaymentKind[] = rental.status === "cancelled" || rental.status === "no_show"
    ? ["deposit_refund"] : ["payment", "deposit", ...(refundNow ? ["deposit_refund" as const] : [])];

  // limits the database enforces, shown before the button is pressed
  const limit = kind === "payment" ? { max: m.balance, maxText: `the balance (${rupees(m.balance)})` }
    : kind === "deposit" ? { max: 1_000_000 }
    : kind === "deposit_applied" ? { max: Math.min(m.depositHeld, m.balance), maxText: `what can be kept (${rupees(Math.min(m.depositHeld, m.balance))})` }
    : { max: m.depositHeld, maxText: `the deposit held (${rupees(m.depositHeld)})` };
  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) setTried(false); }, [open]);
  const errs = {
    amount: moneyError(amount, { required: true, positive: true, ...limit }),
    method: kind !== "deposit_applied" && !method ? "Choose how the money moved." : null,
    note: textLimitError(note, "note", 200),
  };
  const bad = Object.values(errs).some(Boolean);
  const save = () => run(async () => {
    setTried(true);
    if (bad) throw new Error(Object.values(errs).find(Boolean)!);
    await call("record_rental_payment", { p_rental_id: rental.id, p_kind: kind, p_amount: num(amount), p_method: kind === "deposit_applied" ? null : method, p_note: note || null });
    toast.success(`${PAYMENT_LABELS[kind]} recorded`);
    onDone();
    onClose();
  });

  return (
    <Modal open={open} onClose={onClose} title="Record money" description={`Balance ${rupees(m.balance)} · deposit held ${rupees(m.depositHeld)}`}
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} disabled={busy || (tried && bad)} onClick={save}>{busy ? "Saving..." : "Record"}</button></>}>
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); const s = suggest(k); setAmount(s > 0 ? String(s) : ""); }}
            className={cn("rounded-full border px-3 py-1 text-xs", kind === k ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}>
            {k === "deposit_applied" ? "Keep deposit for the balance" : PAYMENT_LABELS[k]}
          </button>
        ))}
      </div>
      <Field label="Amount" error={tried || amount.trim() ? errs.amount ?? undefined : undefined}>
        <input className={monoInputClass} inputMode="decimal" maxLength={10} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {kind !== "deposit_applied" ? <MethodPicker value={method} onChange={setMethod} error={tried ? errs.method ?? undefined : undefined} /> : null}
      <Field label="Note" error={errs.note ?? undefined}><input className={inputClass} maxLength={220} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
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

  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) setTried(false); }, [open]);
  const errs = {
    amount: moneyError(amount, { required: true, positive: true, max: 1_000_000 }),
    note: textLimitError(note, "note", 200),
  };
  const bad = Object.values(errs).some(Boolean);
  const save = () => run(async () => {
    setTried(true);
    if (bad) throw new Error(Object.values(errs).find(Boolean)!);
    await call("add_rental_charge", { p_rental_id: rental.id, p_type: type, p_amount: num(amount), p_note: note || null });
    toast.success("Charge added");
    onDone();
    onClose();
  });

  return (
    <Modal open={open} onClose={onClose} title="Add a charge" description="For example a traffic fine or toll that arrived after the return, or damage found later."
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} disabled={busy || (tried && bad)} onClick={save}>{busy ? "Saving..." : "Add charge"}</button></>}>
      <Field label="Type">
        <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as ChargeType)}>
          {Object.entries(CHARGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Amount" error={tried || amount.trim() ? errs.amount ?? undefined : undefined}>
        <input className={monoInputClass} inputMode="decimal" maxLength={10} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Note (challan no., what was damaged...)" error={errs.note ?? undefined}><input className={inputClass} maxLength={220} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
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

  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) setTried(false); }, [open]);
  const errs = {
    end: !end ? "Choose the new date." : zonedToIso(end, tz) <= rental.end_at ? `The new ${word("end").toLowerCase()} must be after the current one.` : null,
    amount: moneyError(amount, { label: "payment", max: 1_000_000 }),
    method: num(amount) > 0 && !method ? "Choose how the payment was made." : null,
  };
  const bad = Object.values(errs).some(Boolean);
  const save = () => run(async () => {
    setTried(true);
    if (bad) throw new Error(Object.values(errs).find(Boolean)!);
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
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} disabled={busy || (tried && bad)} onClick={save}>{busy ? "Saving..." : "Extend"}</button></>}>
      <Field label={`New ${word("end").toLowerCase()}`} error={errs.end ?? undefined}><DateTimeInput value={end} onChange={(v) => setEnd(v)} /></Field>
      <Field label="Payment now (optional)" error={amount.trim() ? errs.amount ?? undefined : undefined}>
        <input className={monoInputClass} inputMode="decimal" maxLength={10} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {num(amount) > 0 ? <MethodPicker value={method} onChange={setMethod} error={tried ? errs.method ?? undefined : undefined} /> : null}
    </Modal>
  );
}

// ==========================================================================
export function CancelDialog({ rental, open, onClose, onDone }: DialogProps) {
  const m = money(rental);
  const started = Date.parse(rental.start_at) <= Date.now();
  const [fee, setFee] = useState("");
  const [method, setMethod] = useState<Method | "">("cash");
  const [reason, setReason] = useState("");
  const [noShow, setNoShow] = useState(false);
  const { busy, run } = useBusy();
  const { setting } = useShop();
  // "advance is kept when a booking is cancelled" (Settings, migration 040) fills the fee with what was paid; staff can change it
  const keepAdvance = setting("cancel_keeps_advance", false);
  useEffect(() => {
    if (open) { setFee(keepAdvance && m.paid > 0 ? String(m.paid) : ""); setMethod("cash"); setReason(""); setNoShow(false); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // what goes back: what was paid less the fee kept, and the whole deposit
  const advanceRefund = Math.max(0, Math.round((m.paid - num(fee)) * 100) / 100);
  const depositRefund = m.depositHeld;
  const outflow = advanceRefund + depositRefund;
  const errs = {
    fee: moneyError(fee, { label: "fee", max: m.paid, maxText: `what was paid (${rupees(m.paid)})` }),
    method: outflow > 0 && !method ? "Choose how the money is given back." : null,
    reason: textLimitError(reason, "reason", 300),
  };
  const bad = Object.values(errs).some(Boolean);
  const save = () => run(async () => {
    if (bad) throw new Error(Object.values(errs).find(Boolean)!);
    await call("cancel_rental", { p_rental_id: rental.id, p_fee: num(fee), p_refund_method: outflow > 0 ? method || null : null, p_reason: reason.trim() || null, p_no_show: noShow });
    toast.success(noShow ? "Marked as no-show" : "Booking cancelled");
    onDone();
    onClose();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto border-rust/40 p-5 sm:max-w-lg sm:rounded-2xl sm:p-6">
        <div className="flex items-center gap-3 border-b border-border pb-4 pr-8">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rust/15 text-rust"><XCircle className="h-5 w-5" /></span>
          <div className="min-w-0">
            <DialogTitle className="font-display text-lg">Cancel Booking {rental.token}</DialogTitle>
            <DialogDescription className="text-xs">Original records are kept. Set the cancellation fee and give the money back.</DialogDescription>
          </div>
        </div>

        {/* what the booking holds now */}
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-4">
          {([["Rental charge", rupees(m.total), ""], ["Advance paid", rupees(m.paid), "text-emerald"], ["Sec. deposit", rupees(m.depositHeld), ""], ["Receivable", "→ ₹0 (Closed)", "text-gold"]] as const).map(([label, value, tone]) => (
            <div key={label}>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className={cn("font-mono text-sm font-semibold", tone)}>{value}</p>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label htmlFor="cancel-fee" className="text-sm font-semibold">Retained Cancellation Fee (₹)</label>
            <span className="text-[11px] text-muted-foreground">Max: {rupees(m.paid)}</span>
          </div>
          <input id="cancel-fee" className={cn(monoInputClass, errs.fee && fee.trim() ? "border-rust/60" : "")} inputMode="decimal" maxLength={10} placeholder="0" value={fee} onChange={(e) => setFee(e.target.value)} />
          {fee.trim() && errs.fee ? <span className="mt-1 block text-xs text-rust">{errs.fee}</span> : <p className="mt-1 text-[11px] text-muted-foreground">Leave it empty for no fee. The fee is kept from the advance and counted once as earned.</p>}
        </div>

        {/* what goes back, worked out as the fee is typed */}
        <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3 font-mono text-sm">
          <div className="flex items-center justify-between"><span className="font-sans text-muted-foreground">Advance Refund:</span><strong className="text-emerald">{rupees(advanceRefund)}</strong></div>
          <div className="flex items-center justify-between"><span className="font-sans text-muted-foreground">Security Deposit Refund:</span><strong className="text-emerald">{rupees(depositRefund)}</strong></div>
          <div className="flex items-center justify-between border-t border-border pt-2 text-base font-bold"><span className="font-sans">Total Refund Outflow:</span><span className="text-emerald">{rupees(outflow)}</span></div>
          <p className="font-sans text-[11px] italic text-muted-foreground">The security deposit always goes back in full and is never counted as rental income.</p>
        </div>

        {outflow > 0 ? (
          <div>
            <p className="mb-1.5 text-sm font-semibold">Refund Payment Method <span className="text-rust">*</span></p>
            <MethodPicker value={method} onChange={setMethod} error={errs.method ?? undefined} />
          </div>
        ) : null}

        <div>
          <label htmlFor="cancel-reason" className="mb-1.5 block text-sm font-semibold">Cancellation Reason / Notes <span className="font-normal text-muted-foreground">(optional)</span></label>
          <textarea id="cancel-reason" className={inputClass} rows={2} maxLength={320} placeholder="e.g. Customer asked to cancel, date clash, illness"
            value={reason} onChange={(e) => setReason(e.target.value)} />
          {errs.reason ? <span className="mt-1 block text-xs text-rust">{errs.reason}</span> : null}
        </div>

        {started ? (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noShow} onChange={(e) => setNoShow(e.target.checked)} /> The customer did not come (no-show)</label>
        ) : null}

        <div className="flex gap-3 border-t border-border pt-4 max-sm:flex-col-reverse">
          <button type="button" className={cn(ghostButtonClass, "min-h-11 flex-1")} onClick={onClose} disabled={busy}>Keep Booking</button>
          <button type="button" className={cn(dangerButtonClass, "min-h-11 flex-1 bg-rust text-white hover:bg-rust/90")} disabled={busy || bad} onClick={save}>
            {busy ? "Saving..." : noShow ? "Mark no-show & Release Dates" : "Confirm Cancellation & Release Dates"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
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
  | { kind: "void_payment"; id: string; label: string; amount: number; method: Method | null }
  | { kind: "delete_charge"; id: string; label: string }
  | { kind: "delete_rental" };

export function CorrectionDialog({ rental, fix, onClose, onDone }: { rental: RentalDetail; fix: Fix | null; onClose: () => void; onDone: (deleted?: boolean) => void }) {
  const [value, setValue] = useState("");
  const [method, setMethod] = useState<Method | "">("");
  const [reason, setReason] = useState("");
  // voiding: enter the correct payment in the same step (migration 039)
  const [replace, setReplace] = useState(false);
  const [tried, setTried] = useState(false);
  const { busy, run } = useBusy();

  useEffect(() => {
    if (!fix) return;
    setTried(false);
    setReason("");
    setValue(fix.kind === "discount" ? String(rental.discount) : fix.kind === "line" || fix.kind === "payment" ? String(fix.amount) : "");
    setMethod(fix.kind === "payment" || fix.kind === "void_payment" ? fix.method ?? "" : "");
    setReplace(false);
  }, [fix, rental.discount]);

  if (!fix) return null;
  const title = {
    discount: "Change the discount", line: `Change the price of ${"label" in fix ? fix.label : ""}`, payment: "Change how it was paid",
    delete_payment: "Delete a payment", void_payment: "Void a payment", delete_charge: "Remove a charge", delete_rental: `Delete ${rental.token} for good`,
  }[fix.kind];
  const destructive = fix.kind.startsWith("delete") || fix.kind === "void_payment";

  // a payment's amount is no longer changed in place: a wrong amount is voided and entered again
  const asksAmount = fix.kind === "discount" || fix.kind === "line" || (fix.kind === "void_payment" && replace);
  const errs = {
    value: asksAmount ? moneyError(value, { required: true, positive: fix.kind !== "discount", max: 10_000_000 }) : null,
    reason: reasonError(reason, "reason (it is kept in the audit log)"),
  };
  const bad = Object.values(errs).some(Boolean);
  const save = () => run(async () => {
    setTried(true);
    if (bad) throw new Error(Object.values(errs).find(Boolean)!);
    if (fix.kind === "discount") await call("admin_set_discount", { p_rental_id: rental.id, p_discount: num(value), p_reason: reason });
    if (fix.kind === "line") await call("admin_set_line_amount", { p_line_id: fix.id, p_amount: num(value), p_reason: reason });
    if (fix.kind === "payment") await call("admin_update_payment", { p_payment_id: fix.id, p_amount: fix.amount, p_method: method || null, p_reason: reason });
    if (fix.kind === "void_payment") await call("void_payment", { p_payment_id: fix.id, p_reason: reason,
      p_replacement: replace ? { amount: num(value), method: method || null } : null });
    if (fix.kind === "delete_payment") await call("admin_delete_payment", { p_payment_id: fix.id, p_reason: reason });
    if (fix.kind === "delete_charge") await call("admin_delete_charge", { p_charge_id: fix.id, p_reason: reason });
    if (fix.kind === "delete_rental") await call("admin_delete_rental", { p_rental_id: rental.id, p_reason: reason });
    toast.success("Saved");
    onDone(fix.kind === "delete_rental");
    onClose();
  });

  return (
    <Modal open onClose={onClose} title={title}
      description={fix.kind === "delete_rental" ? "The booking, its items, charges and payments are removed. Only finished or cancelled bookings can be deleted."
        : fix.kind === "void_payment" ? "It stays on the booking, struck through, with your reason, and no longer counts in any total."
        : "Owners only. The change and its reason are kept in the audit log."}
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button>
        <button className={destructive ? dangerButtonClass : goldButtonClass} disabled={busy || (tried && bad)} onClick={save}>{busy ? "Saving..." : fix.kind === "void_payment" ? "Void" : destructive ? "Delete" : "Save"}</button></>}>
      {"label" in fix && destructive ? <p className="text-sm">{fix.label}</p> : null}
      {fix.kind === "void_payment" ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); if (e.target.checked && !value) setValue(String(fix.amount)); }} />
          Enter the correct payment now
        </label>
      ) : null}
      {asksAmount ? (
        <Field label="Amount" error={tried || value.trim() ? errs.value ?? undefined : undefined}>
          <input className={monoInputClass} inputMode="decimal" maxLength={10} value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      ) : null}
      {(fix.kind === "payment" || (fix.kind === "void_payment" && replace)) && fix.method ? <MethodPicker value={method} onChange={setMethod} /> : null}
      <Field label="Reason" error={tried || reason.trim() ? errs.reason ?? undefined : undefined}><input className={inputClass} maxLength={320} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
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
        <a className={goldButtonClass} href={waLink(rental.customers.phone, text)} target="_blank" rel="noreferrer"
          onClick={() => { void call("mark_reminder_sent", { p_rental_id: rental.id, p_kind: kind }).catch(() => undefined); onClose(); }}>
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

// ==========================================================================
// Alteration (optional feature): a piece goes to the tailor, with an optional charge.
// While "in alteration" it cannot be handed over; mark it done on the booking when it is back.
export function AlterationDialog({ rental, open, onClose, onDone }: DialogProps) {
  const { tz } = useShop();
  const pieces = rental.unit_reservations.filter((u) => (u.state === "held" || u.state === "out")
    && rental.rental_lines.find((l) => l.id === u.line_id)?.kind === "wearable");
  const [unitId, setUnitId] = useState("");
  const [what, setWhat] = useState("");
  const [amount, setAmount] = useState("");
  const [toTailor, setToTailor] = useState(true);
  const { busy, run } = useBusy();
  useEffect(() => { if (open) { setUnitId(pieces[0]?.unit_id ?? ""); setWhat(""); setAmount(""); setToTailor(true); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => run(async () => {
    if (!what.trim()) throw new Error("Write what is being altered.");
    const code = pieces.find((p) => p.unit_id === unitId)?.units?.code ?? "";
    if (num(amount) > 0) {
      await call("add_rental_charge", { p_rental_id: rental.id, p_type: "alteration", p_amount: num(amount), p_note: `${code}: ${what.trim()}` });
    }
    if (toTailor && unitId) {
      await call("set_unit_status", { p_unit_id: unitId, p_status: "alteration", p_reason: what.trim() });
      // and a job on Cleaning & repairs, due by the pickup (migration 041); finishing it makes the piece ready again
      const pickup = isoToZoned(rental.start_at, tz).slice(0, 10);
      const today = todayLocal(tz);
      try {
        await call("create_service_job", { p_unit_id: unitId, p_type: "alteration", p_reason: what.trim(),
          p_due_on: pickup > today ? pickup : today, p_rental_id: rental.id });
      } catch (e) {
        toast.warning(errorText(e));
      }
    }
    toast.success("Alteration recorded");
    onDone();
    onClose();
  });

  return (
    <Modal open={open} onClose={onClose} title="Alteration"
      description="The piece is marked as with the tailor and cannot be handed over until it is marked back."
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button></>}>
      <Field label="Piece">
        <select className={inputClass} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          {pieces.map((p) => <option key={p.unit_id} value={p.unit_id}>{p.units?.code} · {rental.rental_lines.find((l) => l.id === p.line_id)?.description}</option>)}
        </select>
      </Field>
      <Field label="What to alter"><input className={inputClass} placeholder="Take in waist 1 inch, shorten sleeves" value={what} onChange={(e) => setWhat(e.target.value)} /></Field>
      <Field label="Charge to the customer (optional)"><input className={monoInputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={toTailor} onChange={(e) => setToTailor(e.target.checked)} /> The piece is going to the tailor now</label>
    </Modal>
  );
}
