"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight, CalendarClock, ChevronLeft, LogIn, LogOut, MessageCircle, MoreHorizontal, Pencil, Plus, Printer, Receipt, Scissors, Wallet, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useShop } from "@/lib/shop/ShopContext";
import { call, loadRental, money, photoUrls, type RentalDetail } from "@/lib/shop/api";
import {
  BASIS_LABELS, CHARGE_LABELS, METHOD_LABELS, PAYMENT_LABELS, errorText, fmtDateTime, lineMath, plural, rupees,
} from "@/lib/shop/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FUEL_LABELS, PickupDialog, ReturnDialog } from "@/components/shop/HandoverDialogs";
import { APPOINTMENT_COLUMNS, AppointmentDialog, AppointmentList } from "@/components/shop/Appointments";
import { MeasurementsPanel } from "@/components/shop/MeasurementsPanel";
import { createClient } from "@/lib/supabase/client";
import type { Appointment } from "@/lib/shop/types";
import {
  AlterationDialog, CancelDialog, ChargeDialog, CorrectionDialog, ExtendDialog, PaymentDialog, SwapDialog, WhatsAppDialog, type Fix,
} from "@/components/shop/RentalDialogs";
import {
  BalanceBadge, Field, Modal, MoneyRows, PageHeader, Panel, RentalStatusBadge, StatusBadge, ghostButtonClass, goldButtonClass, inputClass, isOverdue,
} from "@/components/shop/ui";

type DialogName = "pickup" | "return" | "pay" | "charge" | "extend" | "cancel" | "swap" | "whatsapp" | "notes" | "alteration" | "appointment" | null;

export default function RentalPage() {
  return <Suspense fallback={null}><RentalView /></Suspense>;
}

function RentalView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const { tz, branches, activeBranches, role, isOwner, canManage, word, feature } = useShop();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [editAppt, setEditAppt] = useState<Appointment | null>(null);
  const [r, setR] = useState<RentalDetail | null | undefined>(undefined);
  // ?new=1 after booking (WhatsApp), ?receive=<piece id or 1> from Inventory Search, ?handover=1 from the dashboard
  const [dialog, setDialog] = useState<DialogName>(params.get("new") ? "whatsapp" : params.get("receive") ? "return" : params.get("handover") ? "pickup" : null);
  const [scannedUnit] = useState(() => { const u = params.get("receive"); return u && u !== "1" ? u : undefined; });
  const [fix, setFix] = useState<Fix | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const rental = await loadRental(id);
      setR(rental);
      if (rental) setPhotos(await photoUrls(rental.rental_checks.flatMap((c) => c.photo_paths)));
      if (rental && feature("appointments")) {
        const { data } = await createClient().from("appointments").select(APPOINTMENT_COLUMNS).eq("rental_id", rental.id).order("scheduled_at");
        setAppointments((data as unknown as Appointment[]) ?? []);
      }
    } catch (e) {
      toast.error(errorText(e));
    }
  }, [id, feature]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (params.get("new") || params.get("receive") || params.get("handover")) router.replace(`/rentals/${id}`); }, [params, router, id]);

  if (r === undefined) return <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p>;
  if (r === null) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">This booking does not exist, or it belongs to another branch.</p>
        <Link href="/rentals" className={ghostButtonClass + " mt-3"}>Back to bookings</Link>
      </Panel>
    );
  }

  const m = money(r);
  const open = r.status === "reserved" || r.status === "active";
  const isRoom = r.rental_lines.every((l) => l.kind === "room");
  const startWord = isRoom ? "Check-in" : word("start");
  const endWord = isRoom ? "Check-out" : word("end");
  const branch = branches.find((b) => b.id === r.branch_id);
  const close = () => setDialog(null);
  const unitsByLine = (lineId: string) => r.unit_reservations.filter((u) => u.line_id === lineId && u.state !== "released");
  const seeMoney = role !== "staff";
  const hasWear = r.rental_lines.some((l) => l.kind === "wearable");
  const inAlteration = r.unit_reservations.filter((u) => (u.state === "held" || u.state === "out") && u.units?.status === "maintenance");
  const backFromTailor = async (unitId: string) => {
    try { await call("set_unit_status", { p_unit_id: unitId, p_status: "available" }); toast.success("Marked back"); await load(); }
    catch (e) { toast.error(errorText(e)); }
  };

  return (
    <>
      <Link href="/rentals" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> Bookings
      </Link>
      <PageHeader
        title={r.customers.full_name}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono text-gold">{r.token}</span>
          <RentalStatusBadge rental={r} room={isRoom} />
          <BalanceBadge rental={r} />
          <span>{r.customers.phone}</span>
          {activeBranches.length > 1 && branch ? <span>· {branch.name}</span> : null}
        </span>}
        actions={<>
          {r.status === "reserved" ? <button className={goldButtonClass} onClick={() => setDialog("pickup")}><LogIn className="h-4 w-4" /> {isRoom ? "Check in" : "Hand over"}</button> : null}
          {r.status === "active" ? <button className={goldButtonClass} onClick={() => setDialog("return")}><LogOut className="h-4 w-4" /> {isRoom ? "Check out" : "Mark returned"}</button> : null}
          <button className={ghostButtonClass} onClick={() => setDialog("pay")}><Wallet className="h-4 w-4" /> Money</button>
          <button className={ghostButtonClass} onClick={() => setDialog("whatsapp")}><MessageCircle className="h-4 w-4" /> WhatsApp</button>
          <Link href={`/print/rental/${r.id}`} className={ghostButtonClass}><Printer className="h-4 w-4" /> Print</Link>
          <DropdownMenu>
            <DropdownMenuTrigger className={ghostButtonClass} aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {r.status === "reserved" ? (
                <DropdownMenuItem onClick={() => router.push(`/book?edit=${r.id}`)}><Pencil className="mr-2 h-4 w-4" /> Change booking</DropdownMenuItem>
              ) : null}
              {open ? <DropdownMenuItem onClick={() => setDialog("extend")}><CalendarClock className="mr-2 h-4 w-4" /> Extend</DropdownMenuItem> : null}
              {r.status === "reserved" && r.unit_reservations.some((u) => u.state === "held") ? (
                <DropdownMenuItem onClick={() => setDialog("swap")}><ArrowLeftRight className="mr-2 h-4 w-4" /> Give another unit</DropdownMenuItem>
              ) : null}
              {canManage && r.status !== "cancelled" && r.status !== "no_show" ? (
                <DropdownMenuItem onClick={() => setDialog("charge")}><Plus className="mr-2 h-4 w-4" /> Add a charge</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => setDialog("notes")}><Pencil className="mr-2 h-4 w-4" /> Notes</DropdownMenuItem>
              {open && hasWear && canManage && feature("alterations") ? (
                <DropdownMenuItem onClick={() => setDialog("alteration")}><Scissors className="mr-2 h-4 w-4" /> Alteration</DropdownMenuItem>
              ) : null}
              {feature("appointments") ? (
                <DropdownMenuItem onClick={() => { setEditAppt(null); setDialog("appointment"); }}><CalendarClock className="mr-2 h-4 w-4" /> Add appointment</DropdownMenuItem>
              ) : null}
              {r.status === "reserved" ? (
                <DropdownMenuItem onClick={() => setDialog("cancel")} className="text-rust"><XCircle className="mr-2 h-4 w-4" /> Cancel booking</DropdownMenuItem>
              ) : null}
              {isOwner ? <>
                <DropdownMenuSeparator />
                {r.status !== "cancelled" && r.status !== "no_show" ? (
                  <DropdownMenuItem onClick={() => setFix({ kind: "discount" })}><Receipt className="mr-2 h-4 w-4" /> Change discount</DropdownMenuItem>
                ) : null}
                {!open ? <DropdownMenuItem onClick={() => setFix({ kind: "delete_rental" })} className="text-rust">Delete booking</DropdownMenuItem> : null}
              </> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
      />

      {inAlteration.length ? (
        <div role="status" className="mb-4 rounded-lg border border-gold/50 bg-gold/10 p-3 text-sm">
          {inAlteration.map((u) => (
            <p key={u.unit_id} className="flex flex-wrap items-center justify-between gap-2">
              <span><span className="font-mono">{u.units?.code}</span> is not ready ({u.units?.status_reason ?? "in service"}) and cannot be handed over yet.</span>
              {canManage ? <button className={ghostButtonClass} onClick={() => backFromTailor(u.unit_id)}>Ready again</button> : null}
            </p>
          ))}
        </div>
      ) : null}
      {isOverdue(r) ? (
        <div role="alert" className="mb-4 rounded-lg border border-rust/40 bg-rust/10 p-3 text-sm text-rust">
          {r.status === "active" ? `Overdue: was due back ${fmtDateTime(r.end_at, tz)}.` : `Not picked up yet: was due ${fmtDateTime(r.start_at, tz)}.`}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Panel title="When">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Item label={startWord}>{fmtDateTime(r.start_at, tz)}{r.actual_start_at ? <span className="block text-xs text-muted-foreground">Actually {fmtDateTime(r.actual_start_at, tz)}</span> : null}</Item>
              <Item label={endWord}>{fmtDateTime(r.end_at, tz)}{r.actual_end_at ? <span className="block text-xs text-muted-foreground">Actually {fmtDateTime(r.actual_end_at, tz)}</span> : null}</Item>
              {isRoom || r.adults + r.children > 1 ? <Item label="Guests">{plural(r.adults, "adult")}{r.children ? `, ${plural(r.children, "child").replace("childs", "children")}` : ""}</Item> : null}
              {r.with_driver ? <Item label="Driver">With driver</Item> : null}
              {r.whole_property ? <Item label="Booking">Whole property</Item> : null}
              {r.cancel_reason ? <Item label="Cancelled because">{r.cancel_reason}</Item> : null}
              {r.notes ? <Item label="Notes">{r.notes}</Item> : null}
            </dl>
          </Panel>

          <Panel title={word("items")}>
            <ul className="divide-y divide-border">
              {r.rental_lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{l.qty > 1 ? `${l.qty} × ` : ""}{l.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.is_override ? "Agreed price" : lineMath(l)}
                      {unitsByLine(l.id).length ? " · " + unitsByLine(l.id).map((u) => `${u.units?.code}${u.state === "out" ? " (out)" : u.state === "returned" ? " (back)" : ""}`).join(", ") : ""}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{rupees(l.amount)}</span>
                    {isOwner && r.status !== "cancelled" && r.status !== "no_show" ? (
                      <button aria-label={`Change the price of ${l.description}`} className="rounded p-1 text-muted-foreground hover:bg-black/5"
                        onClick={() => setFix({ kind: "line", id: l.id, label: l.description, amount: Number(l.amount) })}><Pencil className="h-3.5 w-3.5" /></button>
                    ) : null}
                  </span>
                </li>
              ))}
              {r.rental_add_ons.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 py-2.5 text-sm">
                  <span>{a.name} <span className="text-xs text-muted-foreground">{rupees(a.unit_amount)} {BASIS_LABELS[a.basis]} × {Number(a.quantity)}</span></span>
                  <span className="font-mono">{rupees(a.amount)}</span>
                </li>
              ))}
              {r.rental_charges.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 py-2.5 text-sm">
                  <span>{CHARGE_LABELS[c.type]}{c.note ? <span className="text-xs text-muted-foreground"> · {c.note}</span> : null}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{rupees(c.amount)}</span>
                    {isOwner ? (
                      <button aria-label="Remove this charge" className="rounded p-1 text-muted-foreground hover:bg-black/5"
                        onClick={() => setFix({ kind: "delete_charge", id: c.id, label: `${CHARGE_LABELS[c.type]} ${rupees(c.amount)}` })}><XCircle className="h-3.5 w-3.5" /></button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          {r.rental_checks.length ? (
            <Panel title="Handover record">
              <ul className="space-y-3">
                {r.rental_checks.sort((a, b) => a.checked_at.localeCompare(b.checked_at)).map((c) => {
                  const unit = r.unit_reservations.find((u) => u.unit_id === c.unit_id)?.units;
                  return (
                    <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.phase === "pickup" ? startWord : endWord} · {unit?.code}</span>
                        {c.condition ? <StatusBadge tone={c.condition === "good" ? "emerald" : "rust"}>{c.condition}</StatusBadge> : null}
                        <span className="text-xs text-muted-foreground">{fmtDateTime(c.checked_at, tz)}</span>
                      </div>
                      {c.odometer != null || c.fuel_level != null ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {c.odometer != null ? `Odometer ${c.odometer} km` : ""}{c.fuel_level != null ? ` · Fuel ${FUEL_LABELS[c.fuel_level]}` : ""}
                        </p>
                      ) : null}
                      {c.notes ? <p className="mt-1 text-xs">{c.notes}</p> : null}
                      {c.photo_paths.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {c.photo_paths.map((p) => photos[p] ? (
                            <a key={p} href={photos[p]} target="_blank" rel="noreferrer"><img src={photos[p]} alt="Handover photo" className="h-16 w-16 rounded-md object-cover" /></a>
                          ) : null)}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4">
          <Panel title="Money">
            <MoneyRows rows={[
              ["Items", rupees(r.items_total), "muted"],
              ...(Number(r.add_ons_total) ? [["Extras", rupees(r.add_ons_total), "muted"] as [string, string, "muted"]] : []),
              ...(Number(r.charges_total) ? [["Charges", rupees(r.charges_total), "muted"] as [string, string, "muted"]] : []),
              ...(Number(r.discount) ? [["Discount", "−" + rupees(r.discount), "muted"] as [string, string, "muted"]] : []),
              ...(r.status === "cancelled" || r.status === "no_show" ? [["Cancellation fee", rupees(r.cancellation_fee), "muted"] as [string, string, "muted"]] : []),
              ["Total", rupees(m.total), "strong"],
              ["Paid", rupees(m.paid)],
              ["Balance due", rupees(m.balance), m.balance > 0 ? "rust" : "emerald"],
            ]} />
            <div className="mt-3 border-t border-border pt-3">
              <MoneyRows rows={[
                ["Deposit agreed", rupees(r.deposit_agreed), "muted"],
                ["Received", rupees(r.deposit_received), "muted"],
                ...(Number(r.deposit_applied) ? [["Kept towards charges", rupees(r.deposit_applied), "muted"] as [string, string, "muted"]] : []),
                ...(Number(r.deposit_refunded) ? [["Returned", rupees(r.deposit_refunded), "muted"] as [string, string, "muted"]] : []),
                ["Deposit held now", rupees(m.depositHeld), m.depositHeld > 0 && !open ? "rust" : undefined],
              ]} />
            </div>
          </Panel>

          {seeMoney ? (
            <Panel title="Payments">
              {r.payments.length === 0 ? <p className="text-sm text-muted-foreground">No money recorded yet.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {r.payments.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-2 py-2">
                      <div>
                        <p>{PAYMENT_LABELS[p.kind]}{p.method ? ` · ${METHOD_LABELS[p.method]}` : ""}</p>
                        <p className="text-xs text-muted-foreground">{fmtDateTime(p.paid_at, tz)}{p.note ? ` · ${p.note}` : ""}</p>
                      </div>
                      <span className="flex items-center gap-1">
                        <span className={"font-mono " + (p.kind === "refund" || p.kind === "deposit_refund" ? "text-rust" : "")}>
                          {p.kind === "refund" || p.kind === "deposit_refund" ? "−" : ""}{rupees(p.amount)}
                        </span>
                        {isOwner ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger className="rounded p-1 text-muted-foreground hover:bg-black/5" aria-label="Correct this payment"><MoreHorizontal className="h-3.5 w-3.5" /></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setFix({ kind: "payment", id: p.id, label: PAYMENT_LABELS[p.kind], amount: Number(p.amount), method: p.method })}>Correct amount or method</DropdownMenuItem>
                              <DropdownMenuItem className="text-rust" onClick={() => setFix({ kind: "delete_payment", id: p.id, label: `${PAYMENT_LABELS[p.kind]} ${rupees(p.amount)} on ${fmtDateTime(p.paid_at, tz)}` })}>Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}

          {feature("appointments") ? (
            <Panel title="Appointments" actions={<button className="text-xs text-gold hover:underline" onClick={() => { setEditAppt(null); setDialog("appointment"); }}>Add</button>}>
              <AppointmentList items={appointments} onChanged={load} onEdit={(a) => { setEditAppt(a); setDialog("appointment"); }} showBooking={false} />
            </Panel>
          ) : null}
          {hasWear ? <MeasurementsPanel customerId={r.customer_id} compact /> : null}
          <Panel title="Customer">
            <p className="text-sm font-medium">{r.customers.full_name}</p>
            <p className="text-xs text-muted-foreground">{r.customers.phone}{r.customers.email ? ` · ${r.customers.email}` : ""}</p>
            {r.customers.licence_number ? <p className="mt-1 text-xs text-muted-foreground">Licence {r.customers.licence_number}</p> : null}
            <Link href={`/customers/${r.customers.id}`} className="mt-2 inline-block text-xs text-gold hover:underline">Customer history</Link>
          </Panel>
        </div>
      </div>

      <PickupDialog rental={r} open={dialog === "pickup" && r.status === "reserved"} onClose={close} onDone={load} />
      <ReturnDialog rental={r} open={dialog === "return" && r.status === "active"} onClose={close} onDone={load} scannedUnitId={scannedUnit} />
      <PaymentDialog rental={r} open={dialog === "pay"} onClose={close} onDone={load} />
      <ChargeDialog rental={r} open={dialog === "charge"} onClose={close} onDone={load} />
      <ExtendDialog rental={r} open={dialog === "extend"} onClose={close} onDone={load} />
      <CancelDialog rental={r} open={dialog === "cancel"} onClose={close} onDone={load} />
      <SwapDialog rental={r} open={dialog === "swap"} onClose={close} onDone={load} />
      <WhatsAppDialog rental={r} open={dialog === "whatsapp"} onClose={close} />
      <NotesDialog rental={r} open={dialog === "notes"} onClose={close} onDone={load} />
      <AlterationDialog rental={r} open={dialog === "alteration"} onClose={close} onDone={load} />
      <AppointmentDialog open={dialog === "appointment"} appointment={editAppt} rental={r} onClose={close} onSaved={load} />
      <CorrectionDialog rental={r} fix={fix} onClose={() => setFix(null)}
        onDone={(deleted) => { if (deleted) router.push("/rentals"); else void load(); }} />
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function NotesDialog({ rental, open, onClose, onDone }: { rental: RentalDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setNotes(rental.notes ?? ""); }, [open, rental.notes]);
  const save = async () => {
    setBusy(true);
    try {
      await call("update_rental_notes", { p_rental_id: rental.id, p_notes: notes });
      toast.success("Notes saved");
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Notes"
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button></>}>
      <Field label="Notes"><textarea className={inputClass} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}
