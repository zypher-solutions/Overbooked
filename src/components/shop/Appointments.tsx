"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { errorText, fmtDateTime, isoToZoned, zonedToIso } from "@/lib/shop/format";
import type { Appointment, AppointmentType, Customer } from "@/lib/shop/types";
import { Field, Modal, StatusBadge, ghostButtonClass, goldButtonClass, inputClass } from "./ui";

export const APPOINTMENT_LABELS: Record<AppointmentType, string> = {
  fitting: "Fitting", trial: "Trial", delivery: "Delivery", collection: "Collection", inspection: "Inspection", other: "Other",
};

export const APPOINTMENT_COLUMNS = "*, customers!appointments_shop_customer_fkey(id, full_name, phone), rentals!appointments_shop_rental_fkey(token)";

// add or change an appointment; for a booking the customer and branch come from it
export function AppointmentDialog({ open, onClose, onSaved, appointment, rental }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  appointment?: Appointment | null;
  rental?: { id: string; branch_id: string; customer_id: string; customers?: { full_name: string } } | null;
}) {
  const { shop, tz, activeBranches, myBranchId } = useShop();
  const [type, setType] = useState<AppointmentType>("fitting");
  const [when, setWhen] = useState("");
  const [branch, setBranch] = useState("");
  const [notes, setNotes] = useState("");
  const [customer, setCustomer] = useState<Pick<Customer, "id" | "full_name" | "phone"> | null>(null);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Pick<Customer, "id" | "full_name" | "phone">[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType(appointment?.type ?? "fitting");
    setWhen(appointment ? isoToZoned(appointment.scheduled_at, tz) : isoToZoned(new Date(Date.now() + 24 * 3600 * 1000).toISOString(), tz).slice(0, 11) + "11:00");
    setBranch(appointment?.branch_id ?? rental?.branch_id ?? myBranchId ?? activeBranches[0]?.id ?? "");
    setNotes(appointment?.notes ?? "");
    setCustomer(appointment?.customers ?? null);
    setSearch("");
  }, [open, appointment, rental, tz, myBranchId, activeBranches]);

  useEffect(() => {
    const term = search.trim().replace(/[%_,()*]/g, "");
    if (term.length < 3) { setMatches([]); return; }
    const t = setTimeout(async () => {
      const { data } = await createClient().from("customers").select("id, full_name, phone")
        .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`).limit(6);
      setMatches(data ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const save = async () => {
    const customerId = rental?.customer_id ?? customer?.id;
    if (!customerId) return toast.error("Choose the customer.");
    if (!when) return toast.error("Choose the date and time.");
    setBusy(true);
    const row = { type, scheduled_at: zonedToIso(when, tz), branch_id: rental?.branch_id ?? branch, notes: notes.trim() || null };
    const supabase = createClient();
    const { error } = appointment
      ? await supabase.from("appointments").update(row).eq("id", appointment.id)
      : await supabase.from("appointments").insert({ ...row, shop_id: shop.id, customer_id: customerId, rental_id: rental?.id ?? null });
    setBusy(false);
    if (error) return toast.error(errorText(error));
    toast.success("Appointment saved");
    onSaved();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={appointment ? "Change appointment" : "New appointment"}
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button></>}>
      {rental ? <p className="text-sm">For <span className="font-medium">{rental.customers?.full_name}</span></p> : appointment ? null : (
        customer ? (
          <p className="flex items-center justify-between text-sm"><span><span className="font-medium">{customer.full_name}</span> · {customer.phone}</span>
            <button className="text-xs text-gold hover:underline" onClick={() => setCustomer(null)}>Change</button></p>
        ) : (
          <div>
            <Field label="Customer (name or phone)"><input className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
            {matches.length ? (
              <ul className="mt-1 rounded-lg border border-border">
                {matches.map((c) => (
                  <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-gold/5" onClick={() => setCustomer(c)}>
                    {c.full_name} <span className="text-muted-foreground">· {c.phone}</span></button></li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      )}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(APPOINTMENT_LABELS) as AppointmentType[]).map((k) => (
          <button key={k} type="button" aria-pressed={type === k} onClick={() => setType(k)}
            className={"rounded-full border px-3 py-1 text-xs " + (type === k ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}>
            {APPOINTMENT_LABELS[k]}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="When"><input type="datetime-local" className={inputClass} value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        {!rental && activeBranches.length > 1 ? (
          <Field label="Branch">
            <select className={inputClass} value={branch} disabled={!!myBranchId} onChange={(e) => setBranch(e.target.value)}>
              {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        ) : null}
      </div>
      <Field label="Notes"><textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}

export function AppointmentList({ items, onChanged, onEdit, showBooking = true }: {
  items: Appointment[];
  onChanged: () => void;
  onEdit: (a: Appointment) => void;
  showBooking?: boolean;
}) {
  const { tz } = useShop();
  const setStatus = async (a: Appointment, status: Appointment["status"]) => {
    const { error } = await createClient().from("appointments").update({ status }).eq("id", a.id);
    if (error) return toast.error(errorText(error));
    onChanged();
  };
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No appointments.</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
          <button type="button" className="min-w-0 text-left" onClick={() => onEdit(a)}>
            <span className="font-medium">{fmtDateTime(a.scheduled_at, tz)}</span>
            <span className="ml-2">{APPOINTMENT_LABELS[a.type]}</span>
            <span className="block text-xs text-muted-foreground">
              {a.customers?.full_name}{a.customers?.phone ? ` · ${a.customers.phone}` : ""}{a.notes ? ` · ${a.notes}` : ""}
            </span>
          </button>
          <span className="flex items-center gap-2">
            {showBooking && a.rental_id && a.rentals ? <Link href={`/rentals/${a.rental_id}`} className="font-mono text-xs text-gold hover:underline">{a.rentals.token}</Link> : null}
            {a.status === "scheduled" ? <>
              <button aria-label="Done" title="Done" className="rounded p-1 text-emerald hover:bg-emerald/10" onClick={() => setStatus(a, "done")}><Check className="h-4 w-4" /></button>
              <button aria-label="Missed" title="Missed" className="rounded px-1.5 py-0.5 text-[11px] text-rust hover:bg-rust/10" onClick={() => setStatus(a, "missed")}>Missed</button>
              <button aria-label="Cancel appointment" title="Cancel" className="rounded p-1 text-muted-foreground hover:bg-black/5" onClick={() => setStatus(a, "cancelled")}><X className="h-4 w-4" /></button>
            </> : <StatusBadge tone={a.status === "done" ? "emerald" : a.status === "missed" ? "rust" : "muted"}>{a.status}</StatusBadge>}
          </span>
        </li>
      ))}
    </ul>
  );
}
