"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ImageOff,
  LogIn,
  LogOut,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Printer,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShop } from "@/lib/shop/ShopContext";
import {
  call,
  loadRental,
  money,
  photoUrls,
  type RentalDetail,
} from "@/lib/shop/api";
import {
  BASIS_LABELS,
  CHARGE_LABELS,
  errorText,
  fmtDateTime,
  fmtTime,
  isoToZoned,
  lineMath,
  plural,
  rupees,
  todayLocal,
} from "@/lib/shop/format";
import { isoToDisplay } from "@/components/shop/DateInput";
import { EditRentalDialog } from "@/components/shop/EditRentalDialog";
import { BookingPaymentSummary } from "@/components/shop/BookingPaymentSummary";
import {
  FUEL_LABELS,
  PickupDialog,
  ReturnDialog,
} from "@/components/shop/HandoverDialogs";
import {
  APPOINTMENT_COLUMNS,
  AppointmentDialog,
  AppointmentList,
} from "@/components/shop/Appointments";
import { MeasurementsPanel } from "@/components/shop/MeasurementsPanel";
import { createClient } from "@/lib/supabase/client";
import type { Appointment } from "@/lib/shop/types";
import {
  AlterationDialog,
  CancelDialog,
  ChargeDialog,
  CorrectionDialog,
  ExtendDialog,
  PaymentDialog,
  SwapDialog,
  WhatsAppDialog,
  type Fix,
} from "@/components/shop/RentalDialogs";
import {
  BalanceBadge,
  Field,
  Modal,
  PageSkeleton,
  Panel,
  RentalStatusBadge,
  StatusBadge,
  dangerButtonClass,
  ghostButtonClass,
  goldButtonClass,
  inputClass,
  isOverdue,
} from "@/components/shop/ui";

type DialogName =
  | "pickup"
  | "return"
  | "pay"
  | "charge"
  | "extend"
  | "cancel"
  | "swap"
  | "whatsapp"
  | "notes"
  | "alteration"
  | "appointment"
  | "edit"
  | null;

export default function RentalPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RentalView />
    </Suspense>
  );
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
  const [dialog, setDialog] = useState<DialogName>(
    params.get("new")
      ? "whatsapp"
      : params.get("receive")
        ? "return"
        : params.get("handover")
          ? "pickup"
          : null,
  );
  const [scannedUnit] = useState(() => {
    const u = params.get("receive");
    return u && u !== "1" ? u : undefined;
  });
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
            ? createClient()
                .from("appointments")
                .select(APPOINTMENT_COLUMNS)
                .eq("rental_id", rental.id)
                .order("scheduled_at")
            : Promise.resolve({ data: [] as unknown[] }),
        ]);
        setPhotos(urls);
        setAppointments((appts.data as unknown as Appointment[]) ?? []);
      }
    } catch (e) {
      toast.error(errorText(e));
    }
  }, [id, feature]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (params.get("new") || params.get("receive") || params.get("handover"))
      router.replace(`/rentals/${id}`);
  }, [params, router, id]);

  if (r === undefined) return <PageSkeleton />;
  if (r === null) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">
          This booking does not exist, or it belongs to another branch.
        </p>
        <Link href="/bookings" className={ghostButtonClass + " mt-3"}>
          Back to bookings
        </Link>
      </Panel>
    );
  }

  const m = money(r);
  const open = r.status === "reserved" || r.status === "active";
  const closed = r.status === "cancelled" || r.status === "no_show";
  const isRoom =
    r.rental_lines.length > 0 && r.rental_lines.every((l) => l.kind === "room");
  const startWord = isRoom ? "Check-in" : word("start");
  const endWord = isRoom ? "Check-out" : word("end");
  const branch = branches.find((b) => b.id === r.branch_id);
  const close = () => setDialog(null);
  const unitsByLine = (lineId: string) =>
    r.unit_reservations.filter(
      (u) => u.line_id === lineId && u.state !== "released",
    );
  const seeMoney = role !== "staff";
  const hasWear = r.rental_lines.some((l) => l.kind === "wearable");
  const showAppointments = feature("appointments");
  const showMeasurements = hasWear && feature("measurements");
  const inAlteration = r.unit_reservations.filter(
    (u) =>
      (u.state === "held" || u.state === "out") &&
      u.units?.status === "maintenance",
  );
  const backFromTailor = async (unitId: string) => {
    try {
      await call("set_unit_status", {
        p_unit_id: unitId,
        p_status: "available",
      });
      toast.success("Marked back");
      await load();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  // dates are shown DD/MM/YY with the time beside them
  const dmy = (iso: string) => isoToDisplay(isoToZoned(iso, tz).slice(0, 10));
  const startDate = isoToZoned(r.start_at, tz).slice(0, 10);
  const endDate = isoToZoned(r.end_at, tz).slice(0, 10);
  const today = todayLocal(tz);
  const days = Math.max(
    1,
    Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000),
  );
  const cleaning = r.cleaning_days;
  const holdEnd = latestHoldEnd(r.unit_reservations);
  const lateDays =
    r.status === "active" && endDate < today
      ? Math.round((Date.parse(today) - Date.parse(endDate)) / 86_400_000)
      : 0;
  const overdue = isOverdue(r);
  const depositToTake = Math.max(
    0,
    Number(r.deposit_agreed) - Number(r.deposit_received),
  );
  // the next thing to do, by status: money is taken at hand over and return, so only a finished booking that still owes asks for it here
  const primary =
    r.status === "reserved"
      ? {
          label: isRoom ? "Check in" : "Hand over",
          icon: LogIn,
          dialog: "pickup" as const,
        }
      : r.status === "active"
        ? {
            label: isRoom ? "Check out" : "Mark returned",
            icon: LogOut,
            dialog: "return" as const,
          }
        : r.status === "completed" &&
            seeMoney &&
            (m.balance > 0 || m.depositHeld > 0)
          ? {
              label: m.balance > 0 ? "Take payment" : "Return deposit",
              icon: null,
              dialog: "pay" as const,
            }
          : null;
  const statusTitle =
    r.status === "reserved"
      ? overdue
        ? `${startWord} overdue`
        : startDate === today
          ? `${startWord} today`
          : `Awaiting ${startWord.toLowerCase()}`
      : r.status === "active"
        ? overdue
          ? `${endWord} overdue`
          : endDate === today
            ? `${endWord} today`
            : `Awaiting ${endWord.toLowerCase()}`
        : r.status === "completed"
          ? `${endWord} recorded`
          : r.status === "no_show"
            ? "No-show recorded"
            : "Cancellation recorded";
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-16">
      <Link
        href="/bookings"
        className="inline-flex min-h-8 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Bookings
      </Link>

      {/* the booking and what can be done to it */}
      <header className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
        <div className="min-w-0">
          <h1 className="break-words font-display text-2xl font-semibold sm:text-3xl">
            {r.token}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <RentalStatusBadge rental={r} room={isRoom} />
            <BalanceBadge rental={r} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open ? (
            <button
              className={cn(ghostButtonClass, "min-h-11 px-3")}
              onClick={() =>
                r.status === "reserved"
                  ? router.push(`/book?edit=${r.id}`)
                  : setDialog("edit")
              }
            >
              <Pencil className="h-4 w-4" /> Edit
            </button>
          ) : null}
          <button
            className={cn(ghostButtonClass, "min-h-11 px-3")}
            onClick={() => setDialog("whatsapp")}
            aria-label="WhatsApp the customer"
          >
            <MessageCircle className="h-4 w-4" />
            <span className="max-sm:sr-only"> WhatsApp</span>
          </button>
          <Link
            href={`/print/rental/${r.id}`}
            className={cn(ghostButtonClass, "min-h-11 px-3")}
            aria-label="Print"
          >
            <Printer className="h-4 w-4" />
            <span className="max-sm:sr-only"> Print</span>
          </Link>
          {r.status === "reserved" ? (
            <button
              className={cn(dangerButtonClass, "min-h-11 px-3 text-foreground")}
              onClick={() => setDialog("cancel")}
            >
              <XCircle className="h-4 w-4" /> Cancel booking
            </button>
          ) : null}
        </div>
      </header>

      {inAlteration.length ? (
        <div
          role="status"
          className="mb-4 rounded-lg border border-gold/50 bg-gold/10 p-3 text-sm"
        >
          {inAlteration.map((u) => (
            <p
              key={u.unit_id}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span>
                <span className="font-mono">{u.units?.code}</span> is not ready
                ({u.units?.status_reason ?? "in service"}) and cannot be handed
                over yet.
              </span>
              {canManage ? (
                <button
                  className={ghostButtonClass}
                  onClick={() => backFromTailor(u.unit_id)}
                >
                  Ready again
                </button>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}
      <section
        aria-label="Booking overview"
        className="overflow-hidden rounded-2xl border border-border bg-surface"
      >
        <div className="grid divide-y divide-border md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:divide-x md:divide-y-0">
          <div className="min-w-0 px-4 py-5 sm:px-6">
            <h2 className="text-sm font-medium text-muted-foreground">
              Customer
            </h2>
            <p className="mt-1 break-words text-xl font-semibold">
              {r.customers.full_name}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {r.customers.phone ? (
                <a
                  href={`tel:${r.customers.phone}`}
                  className="inline-flex min-h-9 items-center gap-1.5 font-medium text-gold hover:underline"
                >
                  <Phone aria-hidden="true" className="size-4" />{" "}
                  {r.customers.phone}
                </a>
              ) : null}
              <Link
                href={`/customers/${r.customers.id}`}
                className="inline-flex min-h-9 items-center font-medium text-gold hover:underline"
              >
                Customer history
              </Link>
            </div>
            {branch ? (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin aria-hidden="true" className="size-4 shrink-0" />{" "}
                <span className="break-words">{branch.name}</span>
              </p>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 bg-muted/35 px-4 py-5 sm:px-6">
            <div className="min-w-0 space-y-1">
              <h2 className="text-lg font-semibold">{statusTitle}</h2>
              {overdue ? (
                <p className="text-sm font-medium text-foreground">
                  {lateDays ? `${plural(lateDays, "day")} late. ` : ""}
                  {r.status === "active"
                    ? "Return was due "
                    : `${startWord} was due `}
                  {fmtDateTime(
                    r.status === "active" ? r.end_at : r.start_at,
                    tz,
                  )}
                  .
                </p>
              ) : null}
              {closed && r.cancel_reason ? (
                <p className="break-words whitespace-pre-wrap text-sm text-muted-foreground">
                  {r.cancel_reason}
                </p>
              ) : null}
              {closed && r.cancelled_at ? (
                <p className="text-sm text-muted-foreground">
                  {fmtDateTime(r.cancelled_at, tz)}
                </p>
              ) : null}
              {seeMoney && open && m.balance > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Rental balance due{" "}
                  <strong className="font-semibold text-foreground">
                    {rupees(m.balance)}
                  </strong>
                </p>
              ) : null}
              {seeMoney && open && depositToTake > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Deposit outstanding{" "}
                  <strong className="font-semibold text-foreground">
                    {rupees(depositToTake)}
                  </strong>
                </p>
              ) : null}
              {r.status === "completed" &&
              seeMoney &&
              (m.balance > 0 || m.depositHeld > 0) ? (
                <p className="text-sm text-muted-foreground">
                  {m.balance > 0 ? `${rupees(m.balance)} still due. ` : ""}
                  {m.depositHeld > 0
                    ? `Deposit held: ${rupees(m.depositHeld)}.`
                    : ""}
                </p>
              ) : null}
            </div>
            {primary ? (
              <button
                type="button"
                className={cn(goldButtonClass, "min-h-11")}
                onClick={() => setDialog(primary.dialog)}
              >
                {primary.icon ? (
                  <primary.icon aria-hidden="true" className="size-4" />
                ) : null}{" "}
                {primary.label}
              </button>
            ) : null}
          </div>
        </div>

        <section
          aria-labelledby="booking-schedule"
          className="border-t border-border px-4 py-5 sm:px-6"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="booking-schedule" className="text-base font-semibold">
              Schedule
            </h2>
            <p className="text-sm text-muted-foreground">
              {plural(days, isRoom ? "night" : "rental day")}
            </p>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
            <Fact label={`Scheduled ${startWord.toLowerCase()}`}>
              <span className="text-base font-semibold tabular-nums">
                {dmy(r.start_at)}
              </span>
              <span className="block text-sm text-muted-foreground">
                {fmtTime(r.start_at, tz)}
              </span>
              {r.actual_start_at ? (
                <span className="mt-1 block text-sm text-muted-foreground">
                  Actual {startWord.toLowerCase()} ·{" "}
                  {fmtDateTime(r.actual_start_at, tz)}
                </span>
              ) : null}
            </Fact>
            <Fact label={`Scheduled ${endWord.toLowerCase()}`}>
              <span className="text-base font-semibold tabular-nums">
                {dmy(r.end_at)}
              </span>
              <span className="block text-sm text-muted-foreground">
                {fmtTime(r.end_at, tz)}
              </span>
              {r.actual_end_at ? (
                <span className="mt-1 block text-sm text-muted-foreground">
                  Actual {endWord.toLowerCase()} ·{" "}
                  {fmtDateTime(r.actual_end_at, tz)}
                </span>
              ) : null}
            </Fact>
            {isRoom ? (
              <Fact label="Guests">
                <span className="text-base font-semibold">
                  {r.adults + r.children}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {plural(r.adults, "adult")}
                  {r.children
                    ? `, ${r.children} ${r.children === 1 ? "child" : "children"}`
                    : ""}
                </span>
              </Fact>
            ) : (
              <>
                <Fact label="Maintenance buffer">
                  <span className="text-base font-semibold">
                    {cleaning == null
                      ? "Product defaults"
                      : plural(cleaning, "day")}
                  </span>
                </Fact>
                {!closed && holdEnd ? (
                  <Fact label="Stock hold ends">
                    <span className="text-base font-semibold tabular-nums">
                      {dmy(holdEnd)}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {fmtTime(holdEnd, tz)}
                    </span>
                    {overdue && r.status === "active" ? (
                      <span className="block text-sm text-muted-foreground">
                        Still out. Availability depends on return.
                      </span>
                    ) : null}
                  </Fact>
                ) : null}
              </>
            )}
          </dl>
          {r.with_driver || r.whole_property ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {r.with_driver ? <StatusBadge>With driver</StatusBadge> : null}
              {r.whole_property ? (
                <StatusBadge>Whole property</StatusBadge>
              ) : null}
            </div>
          ) : null}
        </section>
      </section>

      <div
        className={cn(
          "grid items-start gap-5",
          seeMoney && "xl:grid-cols-[minmax(0,1fr)_minmax(21rem,0.7fr)]",
        )}
      >
        <div className="min-w-0 space-y-5">
          <Panel
            title={`${word("items")} (${r.rental_lines.reduce((n, line) => n + line.qty, 0)})`}
            actions={
              open && hasWear && canManage && feature("alterations") ? (
                <button
                  type="button"
                  className={ghostButtonClass}
                  onClick={() => setDialog("alteration")}
                >
                  Send to tailor
                </button>
              ) : null
            }
          >
            {r.rental_lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No items recorded.
              </p>
            ) : null}
            <ul className="divide-y divide-border">
              {r.rental_lines.map((line) => {
                const units = unitsByLine(line.id);
                return (
                  <li
                    key={line.id}
                    className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-3 py-4 first:pt-1 last:pb-1 sm:grid-cols-[3rem_minmax(0,1fr)_auto]"
                  >
                    <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground">
                      {line.image_url ? (
                        <img
                          src={line.image_url}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <ImageOff aria-hidden="true" className="size-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-semibold">
                        {line.qty > 1 ? `${line.qty} × ` : ""}
                        {line.description}
                      </p>
                      {line.sku ? (
                        <p className="mt-0.5 break-words text-sm text-muted-foreground">
                          {line.sku}
                        </p>
                      ) : null}
                      {units.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {units.map((unit) => (
                            <StatusBadge
                              key={unit.id}
                              tone={
                                unit.state === "out"
                                  ? "gold"
                                  : unit.state === "returned"
                                    ? "emerald"
                                    : "muted"
                              }
                            >
                              {unit.units?.code ?? "Piece"}
                              {unit.state === "out"
                                ? " · Out"
                                : unit.state === "returned"
                                  ? " · Back"
                                  : ""}
                            </StatusBadge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="col-start-2 flex min-w-0 items-start justify-end gap-1 text-right sm:col-start-3">
                      <div className="min-w-0">
                        <p className="break-words font-semibold tabular-nums">
                          {rupees(line.amount)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {line.is_override ? "Agreed price" : lineMath(line)}
                        </p>
                      </div>
                      {isOwner && !closed ? (
                        <button
                          type="button"
                          aria-label={`Change the price of ${line.description}`}
                          className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
                          onClick={() =>
                            setFix({
                              kind: "line",
                              id: line.id,
                              label: line.description,
                              amount: Number(line.amount),
                            })
                          }
                        >
                          <Pencil aria-hidden="true" className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {r.rental_add_ons.length || r.rental_charges.length ? (
            <Panel title="Extras and charges">
              <ul className="divide-y divide-border text-sm">
                {r.rental_add_ons.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3 py-2">
                    <span>
                      {a.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        {rupees(a.unit_amount)} {BASIS_LABELS[a.basis]} ×{" "}
                        {Number(a.quantity)}
                      </span>
                    </span>
                    <span className="font-mono">{rupees(a.amount)}</span>
                  </li>
                ))}
                {r.rental_charges.map((c) => (
                  <li key={c.id} className="flex justify-between gap-3 py-2">
                    <span>
                      {CHARGE_LABELS[c.type]}
                      {c.note ? (
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          · {c.note}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono">{rupees(c.amount)}</span>
                      {isOwner ? (
                        <button
                          aria-label="Remove this charge"
                          className="rounded p-2 text-muted-foreground hover:bg-black/5"
                          onClick={() =>
                            setFix({
                              kind: "delete_charge",
                              id: c.id,
                              label: `${CHARGE_LABELS[c.type]} ${rupees(c.amount)}`,
                            })
                          }
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {r.notes ? (
            <Panel title="Booking notes">
              <p className="break-words whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {r.notes}
              </p>
            </Panel>
          ) : null}
        </div>
        {seeMoney ? (
          <BookingPaymentSummary
            rental={r}
            tz={tz}
            isOwner={isOwner}
            onCorrection={setFix}
          />
        ) : null}
      </div>

      {showAppointments || showMeasurements ? (
        <div
          className={cn(
            "grid gap-5",
            showAppointments && showMeasurements && "lg:grid-cols-2",
          )}
        >
          {showAppointments ? (
            <Panel
              title="Appointments"
              actions={
                <button
                  className="min-h-8 px-1 text-xs text-gold hover:underline"
                  onClick={() => {
                    setEditAppt(null);
                    setDialog("appointment");
                  }}
                >
                  Add
                </button>
              }
            >
              <AppointmentList
                items={appointments}
                onChanged={load}
                onEdit={(a) => {
                  setEditAppt(a);
                  setDialog("appointment");
                }}
                showBooking={false}
              />
            </Panel>
          ) : null}
          {showMeasurements ? (
            <MeasurementsPanel customerId={r.customer_id} compact />
          ) : null}
        </div>
      ) : null}

      {r.rental_checks.length ? (
        <Panel title={`Handover record (${r.rental_checks.length})`}>
          <details>
            <summary className="min-h-10 cursor-pointer rounded-md py-2 text-sm font-medium text-gold">
              Show the record
            </summary>
            <ul className="mt-3 space-y-3">
              {[...r.rental_checks]
                .sort((a, b) => a.checked_at.localeCompare(b.checked_at))
                .map((c) => {
                  const unit = r.unit_reservations.find(
                    (u) => u.unit_id === c.unit_id,
                  )?.units;
                  return (
                    <li
                      key={c.id}
                      className="rounded-lg border border-border p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {c.phase === "pickup" ? startWord : endWord} ·{" "}
                          {unit?.code}
                        </span>
                        {c.condition ? (
                          <StatusBadge
                            tone={c.condition === "good" ? "emerald" : "rust"}
                          >
                            {c.condition}
                          </StatusBadge>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {fmtDateTime(c.checked_at, tz)}
                        </span>
                      </div>
                      {c.odometer != null || c.fuel_level != null ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {c.odometer != null
                            ? `Odometer ${c.odometer} km`
                            : ""}
                          {c.fuel_level != null
                            ? ` · Fuel ${FUEL_LABELS[c.fuel_level]}`
                            : ""}
                        </p>
                      ) : null}
                      {c.notes ? (
                        <p className="mt-1 text-xs">{c.notes}</p>
                      ) : null}
                      {c.photo_paths.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {c.photo_paths.map((p) =>
                            photos[p] ? (
                              <a
                                key={p}
                                href={photos[p]}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <img
                                  src={photos[p]}
                                  alt="Handover photo"
                                  className="h-16 w-16 rounded-md object-cover"
                                />
                              </a>
                            ) : null,
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          </details>
        </Panel>
      ) : null}

      <PickupDialog
        rental={r}
        open={dialog === "pickup" && r.status === "reserved"}
        onClose={close}
        onDone={load}
      />
      <ReturnDialog
        rental={r}
        open={dialog === "return" && r.status === "active"}
        onClose={close}
        onDone={load}
        scannedUnitId={scannedUnit}
      />
      <PaymentDialog
        rental={r}
        open={dialog === "pay"}
        onClose={close}
        onDone={load}
      />
      <EditRentalDialog
        rental={r}
        open={dialog === "edit" && r.status === "active"}
        onClose={close}
        onDone={load}
      />
      <ChargeDialog
        rental={r}
        open={dialog === "charge"}
        onClose={close}
        onDone={load}
      />
      <ExtendDialog
        rental={r}
        open={dialog === "extend"}
        onClose={close}
        onDone={load}
      />
      <CancelDialog
        rental={r}
        open={dialog === "cancel"}
        onClose={close}
        onDone={load}
      />
      <SwapDialog
        rental={r}
        open={dialog === "swap"}
        onClose={close}
        onDone={load}
      />
      <WhatsAppDialog rental={r} open={dialog === "whatsapp"} onClose={close} />
      <NotesDialog
        rental={r}
        open={dialog === "notes"}
        onClose={close}
        onDone={load}
      />
      <AlterationDialog
        rental={r}
        open={dialog === "alteration"}
        onClose={close}
        onDone={load}
      />
      <AppointmentDialog
        open={dialog === "appointment"}
        appointment={editAppt}
        rental={r}
        onClose={close}
        onSaved={load}
      />
      <CorrectionDialog
        rental={r}
        fix={fix}
        onClose={() => setFix(null)}
        onDone={(deleted) => {
          if (deleted) router.push("/bookings");
          else void load();
        }}
      />
    </div>
  );
}

// PostgREST returns the reservation period as a PostgreSQL timestamp range.
function latestHoldEnd(
  reservations: RentalDetail["unit_reservations"],
): string | null {
  let latest = 0;
  for (const reservation of reservations) {
    if (reservation.state === "released") continue;
    const upper = reservation.period.match(/,"?([^"\])]+)"?[)\]]$/)?.[1];
    if (!upper) continue;
    const iso = upper.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
    const end = Date.parse(iso);
    if (Number.isFinite(end) && end > latest) latest = end;
  }
  return latest ? new Date(latest).toISOString() : null;
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function NotesDialog({
  rental,
  open,
  onClose,
  onDone,
}: {
  rental: RentalDetail;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setNotes(rental.notes ?? "");
  }, [open, rental.notes]);
  const tooLong = notes.trim().length > 600;
  const save = async () => {
    if (tooLong)
      return toast.error("The notes are too long (600 characters at most).");
    setBusy(true);
    try {
      await call("update_rental_notes", {
        p_rental_id: rental.id,
        p_notes: notes,
      });
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
    <Modal
      open={open}
      onClose={onClose}
      title="Notes"
      footer={
        <>
          <button className={ghostButtonClass} onClick={onClose}>
            Cancel
          </button>
          <button
            className={goldButtonClass}
            disabled={busy || tooLong}
            onClick={save}
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </>
      }
    >
      <Field
        label="Notes"
        error={
          tooLong
            ? "The notes are too long (600 characters at most)."
            : undefined
        }
      >
        <textarea
          className={inputClass}
          rows={4}
          maxLength={640}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
