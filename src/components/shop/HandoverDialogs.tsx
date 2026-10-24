"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call, money, uploadPhotos, type RentalDetail } from "@/lib/shop/api";
import { CHARGE_LABELS, errorText, fmtDate, isoToZoned, num, rupees, zonedToIso } from "@/lib/shop/format";
import type { ChargeType, Method } from "@/lib/shop/types";
import { Field, MethodPicker, Modal, MoneyRows, ghostButtonClass, goldButtonClass, inputClass, monoInputClass } from "./ui";

export const FUEL_LABELS = ["Empty", "1/8", "1/4", "3/8", "Half", "5/8", "3/4", "7/8", "Full"];

interface CheckDraft { condition: "good" | "damaged" | "lost"; odometer: string; fuel: string; notes: string; files: File[] }
const emptyCheck: CheckDraft = { condition: "good", odometer: "", fuel: "", notes: "", files: [] };

// the units a rental holds, with the kind of thing each one is
function useUnits(r: RentalDetail, state: "held" | "out") {
  return useMemo(() => r.unit_reservations.filter((u) => u.state === state).map((u) => ({
    reservation: u,
    line: r.rental_lines.find((l) => l.id === u.line_id),
    pickup: r.rental_checks.find((c) => c.unit_id === u.unit_id && c.phase === "pickup"),
  })), [r, state]);
}

function CheckForm({ title, kind, value, onChange, allowLost, reference }: {
  title: string;
  kind: string | undefined;
  value: CheckDraft;
  onChange: (c: CheckDraft) => void;
  allowLost: boolean;
  reference?: { odometer: number | null; fuel_level: number | null } | null;
}) {
  const vehicle = kind === "vehicle";
  const set = (patch: Partial<CheckDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-sm font-medium text-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Condition of ${title}`}>
        {(["good", "damaged", ...(allowLost ? ["lost"] : [])] as CheckDraft["condition"][]).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={value.condition === c} onClick={() => set({ condition: c })}
            className={cn("rounded-full border px-3 py-1 text-xs capitalize", value.condition === c
              ? c === "good" ? "border-emerald/50 bg-emerald/10 text-emerald" : "border-rust/50 bg-rust/10 text-rust"
              : "border-border text-muted-foreground")}>
            {c === "good" ? "Good" : c === "damaged" ? "Damaged" : "Lost / not returned"}
          </button>
        ))}
      </div>
      {vehicle ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Odometer (km)" hint={reference?.odometer != null ? `At pickup: ${reference.odometer}` : undefined}>
            <input className={monoInputClass} inputMode="numeric" value={value.odometer} onChange={(e) => set({ odometer: e.target.value.replace(/\D/g, "") })} />
          </Field>
          <Field label="Fuel" hint={reference?.fuel_level != null ? `At pickup: ${FUEL_LABELS[reference.fuel_level]}` : undefined}>
            <select className={inputClass} value={value.fuel} onChange={(e) => set({ fuel: e.target.value })}>
              <option value="">—</option>
              {FUEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
            </select>
          </Field>
        </div>
      ) : null}
      {vehicle && reference?.fuel_level != null && value.fuel !== "" && Number(value.fuel) < reference.fuel_level ? (
        <p className="mt-2 text-xs text-rust">Fuel is lower than at pickup. Add a fuel charge below if agreed.</p>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Notes (marks, missing pieces...)"><input className={inputClass} value={value.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <label className={cn(ghostButtonClass, "cursor-pointer")}>
          <Camera className="h-4 w-4" /> {value.files.length ? `${value.files.length} photo${value.files.length > 1 ? "s" : ""}` : "Photos"}
          <input type="file" accept="image/*" capture="environment" multiple className="sr-only"
            onChange={(e) => set({ files: [...value.files, ...Array.from(e.target.files ?? [])].slice(0, 8) })} />
        </label>
      </div>
    </div>
  );
}

async function checksPayload(shopId: string, rentalId: string, phase: "pickup" | "return",
  units: { reservation: { unit_id: string } }[], checks: Record<string, CheckDraft>) {
  const out = [];
  for (const u of units) {
    const c = checks[u.reservation.unit_id] ?? emptyCheck;
    const photo_paths = c.files.length ? await uploadPhotos(shopId, rentalId, u.reservation.unit_id, phase, c.files) : [];
    out.push({
      unit_id: u.reservation.unit_id, condition: c.condition, notes: c.notes.trim() || null, photo_paths,
      odometer: c.odometer === "" ? null : Number(c.odometer), fuel_level: c.fuel === "" ? null : Number(c.fuel),
    });
  }
  return out;
}

// ==========================================================================
// Pickup / check-in
// ==========================================================================
export function PickupDialog({ rental, open, onClose, onDone }: { rental: RentalDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const { shop, setting, word } = useShop();
  const units = useUnits(rental, "held");
  const m = money(rental);
  const hasVehicle = units.some((u) => u.line?.kind === "vehicle");
  const needLicence = hasVehicle && setting("require_licence", true);
  const c = rental.customers;
  const licenceOk = !!c.licence_number && (!c.licence_expiry || c.licence_expiry >= new Date().toISOString().slice(0, 10));

  const [checks, setChecks] = useState<Record<string, CheckDraft>>({});
  const [verified, setVerified] = useState(false);
  const [licence, setLicence] = useState({ number: "", expiry: "" });
  const [pay, setPay] = useState({ amount: "", method: "" as Method | "" });
  const [dep, setDep] = useState({ amount: "", method: "" as Method | "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChecks(Object.fromEntries(units.map((u) => [u.reservation.unit_id, {
      ...emptyCheck, odometer: u.reservation.units?.odometer != null ? String(u.reservation.units.odometer) : "",
    }])));
    setVerified(false);
    setLicence({ number: c.licence_number ?? "", expiry: c.licence_expiry ?? "" });
    setPay({ amount: m.balance > 0 ? String(m.balance) : "", method: "" });
    const depositDue = Math.max(0, Number(rental.deposit_agreed) - Number(rental.deposit_received));
    setDep({ amount: depositDue > 0 ? String(depositDue) : "", method: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (num(pay.amount) > 0 && !pay.method) return toast.error("Choose how the payment was made.");
    if (num(dep.amount) > 0 && !dep.method) return toast.error("Choose how the deposit was paid.");
    if (needLicence && !verified) return toast.error("Confirm you checked the driving licence and ID.");
    setBusy(true);
    try {
      if (hasVehicle && !licenceOk && licence.number.trim()) {
        const { error } = await createClient().from("customers")
          .update({ licence_number: licence.number.trim(), licence_expiry: licence.expiry || null }).eq("id", c.id);
        if (error) throw error;
      }
      const payload = await checksPayload(shop.id, rental.id, "pickup", units, checks);
      await call("start_rental", {
        p_rental_id: rental.id,
        p: {
          id_verified: verified, checks: payload,
          payment: num(pay.amount) > 0 ? { amount: num(pay.amount), method: pay.method } : null,
          deposit: num(dep.amount) > 0 ? { amount: num(dep.amount), method: dep.method } : null,
        },
      });
      toast.success(`${rental.token} ${units.every((u) => u.line?.kind === "room") ? "checked in" : "handed over"}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const isRoom = units.every((u) => u.line?.kind === "room");
  return (
    <Modal open={open} onClose={onClose} wide title={`${isRoom ? "Check in" : word("start")}: ${rental.token}`}
      description={`Record the condition of each ${isRoom ? "room" : "item"} as it goes out, and take any money due.`}
      footer={<>
        <button className={ghostButtonClass} onClick={onClose}>Cancel</button>
        <button className={goldButtonClass} disabled={busy} onClick={submit}>{busy ? "Saving..." : isRoom ? "Check in" : "Hand over"}</button>
      </>}>
      {hasVehicle ? (
        <div className={cn("rounded-lg border p-3 text-sm", licenceOk ? "border-border" : "border-rust/40 bg-rust/5")}>
          {licenceOk ? (
            <p>Driving licence on record: <span className="font-mono">{c.licence_number}</span>{c.licence_expiry ? `, valid to ${fmtDate(c.licence_expiry)}` : ""}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <p className="text-rust sm:col-span-2">No valid driving licence on record. Add it to hand over the vehicle.</p>
              <Field label="Licence number"><input className={inputClass} value={licence.number} onChange={(e) => setLicence({ ...licence, number: e.target.value })} /></Field>
              <Field label="Valid until"><input type="date" className={inputClass} value={licence.expiry} onChange={(e) => setLicence({ ...licence, expiry: e.target.value })} /></Field>
            </div>
          )}
          <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> I checked the original driving licence and ID</label>
        </div>
      ) : null}
      {units.map((u) => (
        <CheckForm key={u.reservation.unit_id} title={`${u.reservation.units?.code ?? ""} · ${u.line?.description ?? ""}`} kind={u.line?.kind}
          allowLost={false} value={checks[u.reservation.unit_id] ?? emptyCheck}
          onChange={(v) => setChecks({ ...checks, [u.reservation.unit_id]: v })} />
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Field label="Payment now" hint={`Balance ${rupees(m.balance)}`}><input className={monoInputClass} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
          {num(pay.amount) > 0 ? <MethodPicker value={pay.method} onChange={(method) => setPay({ ...pay, method })} /> : null}
        </div>
        <div className="space-y-2">
          <Field label="Deposit now" hint={`Agreed ${rupees(rental.deposit_agreed)}, received ${rupees(rental.deposit_received)}`}>
            <input className={monoInputClass} inputMode="decimal" value={dep.amount} onChange={(e) => setDep({ ...dep, amount: e.target.value })} />
          </Field>
          {num(dep.amount) > 0 ? <MethodPicker value={dep.method} onChange={(method) => setDep({ ...dep, method })} /> : null}
        </div>
      </div>
    </Modal>
  );
}

// ==========================================================================
// Return / check-out
// ==========================================================================
interface ChargeRow { type: ChargeType; amount: string; note: string; suggested: boolean }

export function ReturnDialog({ rental, open, onClose, onDone }: { rental: RentalDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const { shop, tz, word } = useShop();
  const units = useUnits(rental, "out");
  const m = money(rental);
  const [returnedAt, setReturnedAt] = useState("");
  const [checks, setChecks] = useState<Record<string, CheckDraft>>({});
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [kept, setKept] = useState("");
  const [pay, setPay] = useState({ amount: "", method: "" as Method | "" });
  const [refund, setRefund] = useState({ amount: "", method: "" as Method | "" });
  const [touched, setTouched] = useState(false); // money fields edited by hand
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReturnedAt(isoToZoned(new Date().toISOString(), tz));
    setChecks(Object.fromEntries(units.map((u) => [u.reservation.unit_id, { ...emptyCheck }])));
    setCharges([]);
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const returnedIso = returnedAt ? zonedToIso(returnedAt, tz) : "";
  const odometers = units.map((u) => ({ unit_id: u.reservation.unit_id, odometer: checks[u.reservation.unit_id]?.odometer }))
    .filter((o) => o.odometer).map((o) => ({ unit_id: o.unit_id, odometer: Number(o.odometer) }));
  const odoKey = JSON.stringify(odometers);

  // the system's suggestions (late return, extra km) replace the earlier suggestions, never hand-added charges
  useEffect(() => {
    if (!open || !returnedIso) return;
    const t = setTimeout(async () => {
      try {
        const res = await call<{ charges: { type: ChargeType; amount: number; note: string }[] }>("return_suggestions",
          { p_rental_id: rental.id, p_returned_at: returnedIso, p_odometers: JSON.parse(odoKey) });
        setCharges((rows) => [
          ...res.charges.map((c) => ({ type: c.type, amount: String(c.amount), note: c.note, suggested: true })),
          ...rows.filter((r) => !r.suggested),
        ]);
      } catch (e) {
        toast.error(errorText(e));
      }
    }, 400);
    return () => clearTimeout(t);
  }, [open, returnedIso, odoKey, rental.id]);

  const chargesTotal = charges.reduce((s, c) => s + num(c.amount), 0);
  const newTotal = m.total + chargesTotal;
  const due = Math.max(0, Math.round((newTotal - m.paid) * 100) / 100);

  // money defaults follow the charges until edited by hand
  useEffect(() => {
    if (!open || touched) return;
    const keep = Math.min(m.depositHeld, due);
    setKept(keep > 0 ? String(keep) : "");
    setPay((p) => ({ ...p, amount: due - keep > 0 ? String(Math.round((due - keep) * 100) / 100) : "" }));
    const back = Math.round((m.depositHeld - keep) * 100) / 100;
    setRefund((r) => ({ ...r, amount: back > 0 ? String(back) : "" }));
  }, [open, due, m.depositHeld, touched]);

  const submit = async () => {
    if (!returnedIso) return toast.error("Enter the return time.");
    if (Date.parse(returnedIso) > Date.now() + 5 * 60000) return toast.error("The return time cannot be in the future.");
    for (const u of units) {
      const c = checks[u.reservation.unit_id];
      if (u.line?.kind === "vehicle" && (!c?.odometer || c.fuel === "")) return toast.error(`Record the odometer and fuel of ${u.reservation.units?.code}.`);
    }
    if (num(pay.amount) > 0 && !pay.method) return toast.error("Choose how the payment was made.");
    if (num(refund.amount) > 0 && !refund.method) return toast.error("Choose how the deposit is returned.");
    if (num(kept) + num(refund.amount) > m.depositHeld + 0.001) return toast.error(`Only ${rupees(m.depositHeld)} of deposit is held.`);
    setBusy(true);
    try {
      const payload = await checksPayload(shop.id, rental.id, "return", units, checks);
      // the box has minute precision: "this minute" means now, so a quick return is never "before the pickup"
      let exact = returnedAt === isoToZoned(new Date().toISOString(), tz) ? new Date().toISOString() : returnedIso;
      const pickedUp = Date.parse(rental.actual_start_at ?? "");
      // +1 ms: the database keeps microseconds, the browser milliseconds
      if (Date.parse(exact) <= pickedUp && pickedUp - Date.parse(exact) < 60000) exact = new Date(pickedUp + 1).toISOString();
      const res = await call<{ warnings: string[] }>("complete_rental", {
        p_rental_id: rental.id,
        p: {
          returned_at: exact, checks: payload,
          charges: charges.filter((c) => num(c.amount) > 0).map((c) => ({ type: c.type, amount: num(c.amount), note: c.note })),
          deposit_applied: num(kept),
          payment: num(pay.amount) > 0 ? { amount: num(pay.amount), method: pay.method } : null,
          deposit_refund: num(refund.amount) > 0 ? { amount: num(refund.amount), method: refund.method } : null,
        },
      });
      res.warnings?.forEach((w) => toast.warning(w));
      toast.success(`${rental.token} ${units.every((u) => u.line?.kind === "room") ? "checked out" : "returned"}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const isRoom = units.every((u) => u.line?.kind === "room");
  return (
    <Modal open={open} onClose={onClose} wide title={`${isRoom ? "Check out" : word("end")}: ${rental.token}`}
      description={`Due back ${new Date(rental.end_at).toLocaleString("en-IN", { timeZone: tz, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. Charges below are suggested; change them as agreed.`}
      footer={<>
        <button className={ghostButtonClass} onClick={onClose}>Cancel</button>
        <button className={goldButtonClass} disabled={busy} onClick={submit}>{busy ? "Saving..." : isRoom ? "Check out" : "Mark returned"}</button>
      </>}>
      <Field label="Returned at"><input type="datetime-local" className={inputClass} value={returnedAt} onChange={(e) => setReturnedAt(e.target.value)} /></Field>
      {units.map((u) => (
        <CheckForm key={u.reservation.unit_id} title={`${u.reservation.units?.code ?? ""} · ${u.line?.description ?? ""}`} kind={u.line?.kind}
          allowLost value={checks[u.reservation.unit_id] ?? emptyCheck} reference={u.pickup}
          onChange={(v) => setChecks({ ...checks, [u.reservation.unit_id]: v })} />
      ))}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Charges</p>
          <button type="button" className="inline-flex items-center gap-1 text-xs text-gold hover:underline"
            onClick={() => setCharges([...charges, { type: "damage", amount: "", note: "", suggested: false }])}>
            <Plus className="h-3.5 w-3.5" /> Add charge
          </button>
        </div>
        {charges.length === 0 ? <p className="text-sm text-muted-foreground">No charges.</p> : (
          <ul className="space-y-2">
            {charges.map((c, i) => (
              <li key={i} className="grid grid-cols-[1fr_96px_auto] gap-2 sm:grid-cols-[150px_1fr_96px_auto]">
                <select className={cn(inputClass, "py-1.5")} aria-label="Charge type" value={c.type}
                  onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, type: e.target.value as ChargeType, suggested: false } : x))}>
                  {Object.entries(CHARGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input className={cn(inputClass, "col-span-3 py-1.5 sm:col-span-1")} placeholder="Note" aria-label="Charge note" value={c.note}
                  onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, note: e.target.value, suggested: false } : x))} />
                <input className={cn(monoInputClass, "py-1.5")} inputMode="decimal" aria-label="Charge amount" value={c.amount}
                  onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, amount: e.target.value, suggested: false } : x))} />
                <button type="button" aria-label="Remove charge" className="rounded-md p-1.5 hover:bg-black/5" onClick={() => setCharges(charges.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <MoneyRows rows={[
        ["Total so far", rupees(m.total), "muted"],
        ["Charges", rupees(chargesTotal), "muted"],
        ["New total", rupees(newTotal)],
        ["Paid", rupees(m.paid), "muted"],
        ["Balance due", rupees(due), due > 0 ? "rust" : "emerald"],
        ["Deposit held", rupees(m.depositHeld), "muted"],
      ]} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Keep from deposit" hint="Towards the balance">
          <input className={monoInputClass} inputMode="decimal" value={kept} onChange={(e) => { setTouched(true); setKept(e.target.value); }} />
        </Field>
        <div className="space-y-2">
          <Field label="Payment now"><input className={monoInputClass} inputMode="decimal" value={pay.amount} onChange={(e) => { setTouched(true); setPay({ ...pay, amount: e.target.value }); }} /></Field>
          {num(pay.amount) > 0 ? <MethodPicker value={pay.method} onChange={(method) => setPay({ ...pay, method })} /> : null}
        </div>
        <div className="space-y-2">
          <Field label="Deposit returned"><input className={monoInputClass} inputMode="decimal" value={refund.amount} onChange={(e) => { setTouched(true); setRefund({ ...refund, amount: e.target.value }); }} /></Field>
          {num(refund.amount) > 0 ? <MethodPicker value={refund.method} onChange={(method) => setRefund({ ...refund, method })} /> : null}
        </div>
      </div>
    </Modal>
  );
}
