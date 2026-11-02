"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays, ChevronLeft, LogIn, LogOut, MapPin, MessageCircle, MoreHorizontal, Pencil, Phone, Printer, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import { call, loadRental, money, photoUrls, type RentalDetail } from "@/lib/shop/api";
import {
  BASIS_LABELS, CHARGE_LABELS, METHOD_LABELS, PAYMENT_LABELS, addDays, errorText, fmtDateTime, fmtTime, isoToZoned, lineMath, plural, rupees, todayLocal,
} from "@/lib/shop/format";
import { isoToDisplay } from "@/components/shop/DateInput";
import { EditRentalDialog } from "@/components/shop/EditRentalDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FUEL_LABELS, PickupDialog, ReturnDialog } from "@/components/shop/HandoverDialogs";
import { APPOINTMENT_COLUMNS, AppointmentDialog, AppointmentList } from "@/components/shop/Appointments";
import { MeasurementsPanel } from "@/components/shop/MeasurementsPanel";
import { createClient } from "@/lib/supabase/client";
import type { Appointment } from "@/lib/shop/types";
import {
  AlterationDialog, CancelDialog, ChargeDialog, CorrectionDialog, ExtendDialog, PaymentDialog, SwapDialog, WhatsAppDialog, type Fix,
} from "@/components/shop/RentalDialogs";
import {
  BalanceBadge, Field, Modal, PageSkeleton, Panel, RentalStatusBadge, StatusBadge, dangerButtonClass, ghostButtonClass, goldButtonClass, inputClass, isOverdue,
} from "@/components/shop/ui";

type DialogName = "pickup" | "return" | "pay" | "charge" | "extend" | "cancel" | "swap" | "whatsapp" | "notes" | "alteration" | "appointment" | "edit" | null;

export default function RentalPage() {
  return <Suspense fallback={<PageSkeleton />}><RentalView /></Suspense>;
}

function RentalView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const { tz, branches, role, isOwner, canManage, word, feature } = useShop();
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
      // the photos and the appointments load together, after the booking is already on screen
      if (rental) {
        const [urls, appts] = await Promise.all([
          photoUrls(rental.rental_checks.flatMap((c) => c.photo_paths)),
          feature("appointments")
            ? createClient().from("appointments").select(APPOINTMENT_COLUMNS).eq("rental_id", rental.id).order("scheduled_at")
            : Promise.resolve({ data: [] as unknown[] }),
        ]);
        setPhotos(urls);
        setAppointments((appts.data as unknown as Appointment[]) ?? []);
      }
    } catch (e) {
      toast.error(errorText(e));
    }
  }, [id, feature]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (params.get("new") || params.get("receive") || params.get("handover")) router.replace(`/rentals/${id}`); }, [params, router, id]);

  if (r === undefined) return <PageSkeleton />;
  if (r === null) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">This booking does not exist, or it belongs to another branch.</p>
        <Link href="/bookings" className={ghostButtonClass + " mt-3"}>Back to bookings</Link>
      </Panel>
    );
  }

  const m = money(r);
  const open = r.status === "reserved" || r.status === "active";
  const closed = r.status === "cancelled" || r.status === "no_show";
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

  // dates are shown DD/MM/YY with the time beside them
  const dmy = (iso: string) => isoToDisplay(isoToZoned(iso, tz).slice(0, 10));
  const startDate = isoToZoned(r.start_at, tz).slice(0, 10);
  const endDate = isoToZoned(r.end_at, tz).slice(0, 10);
  const today = todayLocal(tz);
  const days = Math.max(1, Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000));
  const cleaning = r.cleaning_days ?? 0;
  const freeAgain = addDays(endDate, cleaning + 1);
  const lateDays = r.status === "active" && endDate < today ? Math.round((Date.parse(today) - Date.parse(endDate)) / 86_400_000) : 0;
  const pickupTag = r.status === "reserved" ? (startDate > today ? "Early pickup" : startDate < today ? "Late pickup" : "") : "";
  const depositToTake = Math.max(0, Number(r.deposit_agreed) - Number(r.deposit_received));
  // the next thing to do, by status: money is taken at hand over and return, so only a finished booking that still owes asks for it here
  const primary = r.status === "reserved"
    ? { label: isRoom ? "Check in" : "Hand over", icon: LogIn, dialog: "pickup" as const }
    : r.status === "active" ? { label: isRoom ? "Check out" : "Mark returned", icon: LogOut, dialog: "return" as const }
    : r.status === "completed" && seeMoney && (m.balance > 0 || m.depositHeld > 0)
      ? { label: m.balance > 0 ? "Take payment" : "Return deposit", icon: null, dialog: "pay" as const } : null;
  // where the advance and the deposit were paid
  const advanceVia = r.payments.find((p) => p.kind === "payment")?.method;
  const depositVia = r.payments.find((p) => p.kind === "deposit")?.method;

  return (
    <div className={cn("mx-auto w-full max-w-4xl", primary ? "max-lg:pb-28" : "")}>
      <Link href="/bookings" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> Bookings
      </Link>

      {/* the booking and what can be done to it */}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-mono text-2xl font-semibold text-gold">{r.token}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <RentalStatusBadge rental={r} room={isRoom} />
            <BalanceBadge rental={r} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open ? (
            <button className={cn(ghostButtonClass, "min-h-10 px-3")} onClick={() => (r.status === "reserved" ? router.push(`/book?edit=${r.id}`) : setDialog("edit"))}>
              <Pencil className="h-4 w-4" /> Edit
            </button>
          ) : null}
          <button className={cn(ghostButtonClass, "min-h-10 px-3")} onClick={() => setDialog("whatsapp")} aria-label="WhatsApp the customer"><MessageCircle className="h-4 w-4" /><span className="max-sm:sr-only"> WhatsApp</span></button>
          <Link href={`/print/rental/${r.id}`} className={cn(ghostButtonClass, "min-h-10 px-3")} aria-label="Print"><Printer className="h-4 w-4" /><span className="max-sm:sr-only"> Print</span></Link>
          {r.status === "reserved" ? (
            <button className={cn(dangerButtonClass, "min-h-10 px-3")} onClick={() => setDialog("cancel")}><XCircle className="h-4 w-4" /> Cancel booking</button>
          ) : null}
        </div>
      </header>

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
          {r.status === "active" ? `Overdue: was due back ${dmy(r.end_at)} ${fmtTime(r.end_at, tz)}.` : `Not picked up yet: was due ${dmy(r.start_at)} ${fmtTime(r.start_at, tz)}.`}
        </div>
      ) : null}

      {/* the next step, by status. On a phone it is a bar fixed to the bottom, so the one thing to do is always under the thumb. */}
      <section aria-label="Next step" className={cn(
        "mb-4 rounded-xl border bg-surface shadow-sm",
        primary ? "border-gold/40 p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:mb-0 max-lg:rounded-none max-lg:border-x-0 max-lg:border-b-0 max-lg:py-3 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-lg:shadow-[0_-4px_16px_rgba(0,0,0,0.08)]" : "border-border p-4")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{open ? "Next step" : closed ? "Closed" : "Finished"}</p>
            <p className="text-sm font-medium text-foreground">
              {r.status === "reserved" ? (pickupTag ? `${isRoom ? "Check-in" : "Pickup"} is due ${dmy(r.start_at)}` : `${isRoom ? "Check-in" : "Pickup"} today`)
                : r.status === "active" ? (lateDays ? `${plural(lateDays, "day")} late: due back ${dmy(r.end_at)}` : `Due back ${dmy(r.end_at)} ${fmtTime(r.end_at, tz)}`)
                : closed ? (r.cancel_reason ? `Reason: ${r.cancel_reason}` : "No further steps")
                : `Returned ${r.actual_end_at ? dmy(r.actual_end_at) : ""}`}
              {pickupTag ? <span className="ml-2 rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">{pickupTag}</span> : null}
            </p>
            {seeMoney && open && (m.balance > 0 || depositToTake > 0) ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {m.balance > 0 ? <>To collect at {r.status === "reserved" ? "hand over" : "return"} <strong className="font-mono text-foreground">{rupees(m.balance)}</strong></> : null}
                {m.balance > 0 && depositToTake > 0 ? " · " : ""}
                {depositToTake > 0 ? <>Deposit <strong className="font-mono text-foreground">{rupees(depositToTake)}</strong></> : null}
              </p>
            ) : null}
            {r.status === "completed" && seeMoney && (m.balance > 0 || m.depositHeld > 0) ? (
              <p className="mt-0.5 text-xs text-rust">{m.balance > 0 ? `${rupees(m.balance)} is still owed. ` : ""}{m.depositHeld > 0 ? `Deposit of ${rupees(m.depositHeld)} is still held.` : ""}</p>
            ) : null}
          </div>
          {primary ? (
            <button className={cn(goldButtonClass, "min-h-11 px-5 text-sm max-lg:flex-1 sm:max-lg:flex-none")} onClick={() => setDialog(primary.dialog)}>
              {primary.icon ? <primary.icon className="h-4 w-4" /> : null} {primary.label}
            </button>
          ) : null}
        </div>
      </section>

      {/* who and where, then when */}
      <div className="mb-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
        <section aria-label="Customer" className="grid grid-cols-2 gap-4 glass p-4 shadow-sm md:grid-cols-1">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
            <p className="mt-1 break-words text-base font-semibold">{r.customers.full_name}</p>
            <a href={`tel:${r.customers.phone}`} className="inline-flex min-h-8 items-center gap-1.5 font-mono text-sm text-emerald hover:underline"><Phone className="h-3.5 w-3.5" /> {r.customers.phone}</a>
            <Link href={`/customers/${r.customers.id}`} className="mt-0.5 block text-xs text-gold hover:underline">Customer history</Link>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Branch</p>
            <p className="mt-1 flex items-center gap-1.5 text-base font-semibold"><MapPin className="h-4 w-4 text-gold" /> {branch?.name ?? "—"}</p>
          </div>
        </section>

        <section aria-label="Schedule" className="rounded-xl border border-gold/30 bg-gold/[0.06] p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-gold/20 pb-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gold"><CalendarDays className="h-4 w-4" /> Schedule overview</p>
            <span className="font-mono text-xs font-semibold">{plural(days, isRoom ? "night" : "rental day")}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Fact label={isRoom ? startWord : "Pickup / give date"}>
              <span className="font-mono text-base font-semibold text-gold">{dmy(r.start_at)}</span>
              <span className="block text-[11px] text-muted-foreground">{fmtTime(r.start_at, tz)}{r.actual_start_at ? ` · out ${dmy(r.actual_start_at)}` : ""}</span>
            </Fact>
            <Fact label={isRoom ? endWord : "Return date"}>
              <span className="font-mono text-base font-semibold">{dmy(r.end_at)}</span>
              <span className="block text-[11px] text-muted-foreground">{fmtTime(r.end_at, tz)}{r.actual_end_at ? ` · back ${dmy(r.actual_end_at)}` : ""}</span>
            </Fact>
            {isRoom ? (
              <Fact label="Guests"><span className="font-mono text-base font-semibold">{r.adults + r.children}</span><span className="block text-[11px] text-muted-foreground">{plural(r.adults, "adult")}{r.children ? `, ${plural(r.children, "child").replace("childs", "children")}` : ""}</span></Fact>
            ) : <>
              <Fact label="Maintenance buffer"><span className="font-mono text-base font-semibold">{plural(cleaning, "day")}</span></Fact>
              <Fact label="Available again"><span className="font-mono text-base font-semibold text-emerald">{isoToDisplay(freeAgain)}</span></Fact>
            </>}
          </dl>
          {r.with_driver || r.whole_property ? (
            <p className="mt-3 flex flex-wrap gap-2 text-xs">
              {r.with_driver ? <StatusBadge tone="muted">With driver</StatusBadge> : null}
              {r.whole_property ? <StatusBadge tone="muted">Whole property</StatusBadge> : null}
            </p>
          ) : null}
        </section>
      </div>

      <Panel title={`${word("items")} (${r.rental_lines.reduce((n, l) => n + l.qty, 0)})`} className="mb-4"
        actions={open && hasWear && canManage && feature("alterations") ? <button className="min-h-8 px-1 text-xs text-gold hover:underline" onClick={() => setDialog("alteration")}>Send to tailor</button> : null}>
        <ul className="space-y-3">
          {r.rental_lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0">
                <p className="font-semibold">{l.qty > 1 ? `${l.qty} × ` : ""}{l.description}</p>
                <p className="font-mono text-xs text-muted-foreground">{l.sku}</p>
                {unitsByLine(l.id).length ? (
                  <p className="mt-1.5 flex flex-wrap gap-1.5">
                    {unitsByLine(l.id).map((u) => (
                      <span key={u.unit_id} className={cn("rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold",
                        u.state === "out" ? "border-gold/50 bg-gold/10 text-gold" : u.state === "returned" ? "border-emerald/40 bg-emerald/10 text-emerald" : "border-gold/30 bg-gold/5 text-gold")}>
                        Piece: {u.units?.code}{u.state === "out" ? " · out" : u.state === "returned" ? " · back" : ""}
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
              <div className="flex items-start gap-1 text-right">
                <div>
                  <p className="font-mono text-base font-semibold text-emerald">{rupees(l.amount)}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{l.is_override ? "Agreed price" : lineMath(l)}</p>
                </div>
                {isOwner && !closed ? (
                  <button aria-label={`Change the price of ${l.description}`} className="rounded p-2 text-muted-foreground hover:bg-black/5"
                    onClick={() => setFix({ kind: "line", id: l.id, label: l.description, amount: Number(l.amount) })}><Pencil className="h-3.5 w-3.5" /></button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {r.rental_add_ons.length || r.rental_charges.length ? (
          <ul className="mt-3 divide-y divide-border text-sm">
            {r.rental_add_ons.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 py-2">
                <span>{a.name} <span className="text-xs text-muted-foreground">{rupees(a.unit_amount)} {BASIS_LABELS[a.basis]} × {Number(a.quantity)}</span></span>
                <span className="font-mono">{rupees(a.amount)}</span>
              </li>
            ))}
            {r.rental_charges.map((c) => (
              <li key={c.id} className="flex justify-between gap-3 py-2">
                <span>{CHARGE_LABELS[c.type]}{c.note ? <span className="text-xs text-muted-foreground"> · {c.note}</span> : null}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{rupees(c.amount)}</span>
                  {isOwner ? (
                    <button aria-label="Remove this charge" className="rounded p-2 text-muted-foreground hover:bg-black/5"
                      onClick={() => setFix({ kind: "delete_charge", id: c.id, label: `${CHARGE_LABELS[c.type]} ${rupees(c.amount)}` })}><XCircle className="h-3.5 w-3.5" /></button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {r.notes ? <p className="mt-3 rounded-md bg-muted/40 p-2.5 text-xs"><span className="font-medium text-muted-foreground">Notes: </span>{r.notes}</p> : null}
      </Panel>

      {/* the money, once, across the page: nothing is taken here, it is taken at hand over and return */}
      {seeMoney ? (
        <section aria-label="Payment summary" className="mb-4 glass p-4 shadow-sm sm:p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gold">Payment summary</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
            <Fact label={closed ? "Rental charge" : "Original total"}>
              <span className={cn("font-mono text-base font-semibold", closed && "text-muted-foreground line-through")}>{rupees(m.total)}</span>
              {Number(r.discount) ? <span className="block text-[11px] text-muted-foreground">after {rupees(r.discount)} discount</span> : null}
            </Fact>
            <Fact label="Advance received">
              <span className="font-mono text-base font-semibold text-emerald">{rupees(m.paid)}</span>
              {advanceVia ? <span className="block text-[11px] text-muted-foreground">via {METHOD_LABELS[advanceVia]}</span> : null}
            </Fact>
            <Fact label={closed ? "Receivable" : "Remaining amount"}>
              <span className={cn("font-mono text-base font-bold", closed || m.balance <= 0 ? "text-emerald" : "text-amber")}>{closed ? "₹0" : rupees(m.balance)}</span>
              {closed ? <span className="block text-[11px] text-emerald">Closed</span> : null}
            </Fact>
            <Fact label="Security deposit">
              <span className="font-mono text-base font-semibold">{rupees(r.deposit_agreed)}</span>
              <span className="block text-[11px] text-muted-foreground">
                {depositVia ? `via ${METHOD_LABELS[depositVia]} · ` : ""}held now {rupees(m.depositHeld)}
              </span>
            </Fact>
          </dl>
          {Number(r.charges_total) || Number(r.add_ons_total) || Number(r.deposit_applied) || Number(r.deposit_refunded) ? (
            <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
              {Number(r.add_ons_total) ? `Extras ${rupees(r.add_ons_total)}. ` : ""}
              {Number(r.charges_total) ? `Charges ${rupees(r.charges_total)}. ` : ""}
              {Number(r.deposit_applied) ? `Deposit kept ${rupees(r.deposit_applied)}. ` : ""}
              {Number(r.deposit_refunded) ? `Deposit returned ${rupees(r.deposit_refunded)}.` : ""}
            </p>
          ) : null}
          {r.payments.length ? (
            <details className="mt-3 border-t border-border pt-2">
              <summary className="min-h-8 cursor-pointer text-xs text-gold">Payment records ({r.payments.length})</summary>
              <ul className="mt-2 divide-y divide-border text-sm">
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
                          <DropdownMenuTrigger className="rounded p-2 text-muted-foreground hover:bg-black/5" aria-label="Correct this payment"><MoreHorizontal className="h-3.5 w-3.5" /></DropdownMenuTrigger>
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
            </details>
          ) : null}
        </section>
      ) : null}

      {feature("appointments") || hasWear ? (
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          {feature("appointments") ? (
            <Panel title="Appointments" actions={<button className="min-h-8 px-1 text-xs text-gold hover:underline" onClick={() => { setEditAppt(null); setDialog("appointment"); }}>Add</button>}>
              <AppointmentList items={appointments} onChanged={load} onEdit={(a) => { setEditAppt(a); setDialog("appointment"); }} showBooking={false} />
            </Panel>
          ) : null}
          {hasWear ? <MeasurementsPanel customerId={r.customer_id} compact /> : null}
        </div>
      ) : null}

      {r.rental_checks.length ? (
        <Panel title={`Handover record (${r.rental_checks.length})`} className="mb-4">
          <details>
            <summary className="min-h-8 cursor-pointer text-sm text-gold">Show the record</summary>
            <ul className="mt-3 space-y-3">
              {[...r.rental_checks].sort((a, b) => a.checked_at.localeCompare(b.checked_at)).map((c) => {
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
          </details>
        </Panel>
      ) : null}

      <PickupDialog rental={r} open={dialog === "pickup" && r.status === "reserved"} onClose={close} onDone={load} />
      <ReturnDialog rental={r} open={dialog === "return" && r.status === "active"} onClose={close} onDone={load} scannedUnitId={scannedUnit} />
      <PaymentDialog rental={r} open={dialog === "pay"} onClose={close} onDone={load} />
      <EditRentalDialog rental={r} open={dialog === "edit" && r.status === "active"} onClose={close} onDone={load} />
      <ChargeDialog rental={r} open={dialog === "charge"} onClose={close} onDone={load} />
      <ExtendDialog rental={r} open={dialog === "extend"} onClose={close} onDone={load} />
      <CancelDialog rental={r} open={dialog === "cancel"} onClose={close} onDone={load} />
      <SwapDialog rental={r} open={dialog === "swap"} onClose={close} onDone={load} />
      <WhatsAppDialog rental={r} open={dialog === "whatsapp"} onClose={close} />
      <NotesDialog rental={r} open={dialog === "notes"} onClose={close} onDone={load} />
      <AlterationDialog rental={r} open={dialog === "alteration"} onClose={close} onDone={load} />
      <AppointmentDialog open={dialog === "appointment"} appointment={editAppt} rental={r} onClose={close} onSaved={load} />
      <CorrectionDialog rental={r} fix={fix} onClose={() => setFix(null)}
        onDone={(deleted) => { if (deleted) router.push("/bookings"); else void load(); }} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function NotesDialog({ rental, open, onClose, onDone }: { rental: RentalDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setNotes(rental.notes ?? ""); }, [open, rental.notes]);
  const tooLong = notes.trim().length > 600;
  const save = async () => {
    if (tooLong) return toast.error("The notes are too long (600 characters at most).");
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
      footer={<><button className={ghostButtonClass} onClick={onClose}>Cancel</button><button className={goldButtonClass} disabled={busy || tooLong} onClick={save}>{busy ? "Saving..." : "Save"}</button></>}>
      <Field label="Notes" error={tooLong ? "The notes are too long (600 characters at most)." : undefined}><textarea className={inputClass} rows={4} maxLength={640} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}
