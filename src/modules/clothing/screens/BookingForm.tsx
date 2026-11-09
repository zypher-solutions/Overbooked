"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { call, money } from "@/lib/shop/api";
import {
  addDays,
  isoToZoned,
  plural,
  rupees,
  todayLocal,
} from "@/lib/shop/format";
import { CustomerPicker } from "@/components/shop/CustomerPicker";
import { customerProblem } from "@/components/shop/CustomerForm";
import { DateInput, isoToDisplay } from "@/components/shop/DateInput";
import {
  Field,
  Modal,
  dangerButtonClass,
  ghostButtonClass,
  goldButtonClass,
  inputClass,
  monoInputClass,
  PageHeader,
  Panel,
  Skeleton,
} from "@/components/shop/ui";
import type {
  BookedRental,
  BookingForm as BookingFormState,
} from "@/components/shop/useBookingForm";
import { CartSwitcher } from "@/modules/clothing/components/CartSwitcher";
import { CheckoutCart } from "@/modules/clothing/components/CheckoutCart";
import {
  CheckoutPayment,
  CheckoutSummary,
} from "@/modules/clothing/components/CheckoutPayment";

function rentalIssue(f: BookingFormState): string | null {
  if (!f.d.start) return "Enter a pickup date.";
  if (f.startInPast) return "Choose a pickup date of today or later.";
  if (!f.d.end) return "Enter a return date to check availability.";
  if (!f.periodOk)
    return "The return date must be on or after the pickup date.";
  if (!f.branchId) return "Choose a branch.";
  if (f.cleaningBad) return "The maintenance buffer cannot be negative.";
  if (!f.lines.length) return "Add at least one item to the cart.";
  if (f.stockError) return `Could not check stock. ${f.stockError}`;
  if (f.shortItems.length)
    return "Some cart items are unavailable. Change the dates or adjust the cart.";
  if (f.checkingStock || f.quotePending)
    return "Wait for availability and rental pricing to finish checking.";
  return (
    f.pieceProblem() ??
    (f.quote
      ? null
      : (f.quoteError ??
        "Rental pricing is unavailable. Check the dates and cart."))
  );
}

function RentalSetup({
  f,
  branchName,
}: {
  f: BookingFormState;
  branchName: string;
}): React.JSX.Element {
  const {
    d,
    editing,
    tz,
    myBranchId,
    activeBranches,
    branchId,
    setBranch,
    set,
    startInPast,
    periodOk,
    cleaningBad,
    cleaning,
    quote,
  } = f;
  const pickup = d.start.slice(0, 10);
  const returns = d.end.slice(0, 10);

  function changePickup(date: string): void {
    set({
      start: date ? `${date}T${d.start.slice(11, 16) || "10:00"}` : "",
      end: date && returns && returns < date ? "" : d.end,
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <Field
          label="Pickup date (required)"
          hint="Use today for a walk-in."
          error={startInPast ? "Pickup cannot be in the past." : undefined}
        >
          <DateInput
            value={pickup}
            min={editing ? undefined : todayLocal(tz)}
            onChange={changePickup}
            aria-label="Pickup date"
            required
          />
        </Field>
        <Field
          label="Return date (required)"
          hint="Used to check availability."
          error={
            d.start && d.end && !startInPast && !periodOk
              ? "Must be on or after the pickup date."
              : undefined
          }
        >
          <DateInput
            value={returns}
            min={pickup || todayLocal(tz)}
            aria-label="Return date"
            required
            onChange={(date) =>
              set({
                end: date ? `${date}T${d.end.slice(11, 16) || "18:00"}` : "",
              })
            }
          />
        </Field>
        <Field label="Branch" hint="Where the items will be picked up.">
          {activeBranches.length > 1 && !myBranchId && !editing ? (
            <select
              className={inputClass}
              value={branchId}
              onChange={(event) => setBranch(event.target.value)}
            >
              {activeBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={cn(inputClass, "bg-muted")}
              value={branchName}
              readOnly
            />
          )}
        </Field>
        <Field
          label="Maintenance buffer (days)"
          hint="Optional cleaning time after return."
          error={cleaningBad ? "Cannot be negative." : undefined}
        >
          <input
            type="number"
            min={0}
            className={monoInputClass}
            inputMode="numeric"
            placeholder="0"
            value={d.cleaningDays}
            onChange={(event) => set({ cleaningDays: event.target.value })}
          />
        </Field>
      </div>
      {periodOk ? (
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Rental duration</dt>
            <dd className="font-semibold">
              {quote ? plural(quote.days, "day") : "…"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cleaning buffer</dt>
            <dd className="font-semibold">{plural(cleaning ?? 0, "day")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Available again</dt>
            <dd className="font-semibold text-gold">
              {isoToDisplay(addDays(returns, (cleaning ?? 0) + 1))}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

export function BookingForm({ f }: { f: BookingFormState }): React.JSX.Element {
  const {
    activeBranches,
    branchId,
    busy,
    customer,
    d,
    editing,
    loadingCustomer,
    set,
    setCustomer,
  } = f;
  const [attempted, setAttempted] = useState(false);
  const branchName =
    activeBranches.find((branch) => branch.id === branchId)?.name ?? "";
  const customerIssue =
    editing || loadingCustomer
      ? null
      : customer
        ? customer.is_blocked
          ? "Choose a customer who can make a booking."
          : null
        : customerProblem(d.customer);
  const paymentIssue =
    Object.values(f.moneyErrors).find(Boolean) ??
    (editing && f.quote && f.total < money(editing).paid
      ? "The new total is less than what was already paid. Record a refund on the booking first."
      : null);
  const issue = rentalIssue(f) ?? customerIssue ?? paymentIssue;
  const pending =
    (f.checkingStock || f.quotePending) &&
    !f.shortItems.length &&
    !f.stockError;
  const activeCustomer = customer?.full_name ?? d.customer.full_name.trim();

  function confirm(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || pending || loadingCustomer) return;
    setAttempted(true);
    f.showErrors();
    if (!issue) void f.submit();
  }

  return (
    <>
      {!busy ? (
        <Link
          href={editing ? `/rentals/${editing.id}` : "/scan"}
          className={cn(ghostButtonClass, "mb-3 -ml-2.5")}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {editing ? "Back to booking" : "Inventory search"}
        </Link>
      ) : null}
      <PageHeader
        title={editing ? `Change booking ${editing.token}` : "Checkout"}
        subtitle={
          editing
            ? undefined
            : "Review the rental, customer details, and payment before confirming."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {!editing && !busy ? (
              <CartSwitcher activeLabel={activeCustomer} />
            ) : null}
            <a
              href="#checkout-summary-title"
              className={cn(ghostButtonClass, "min-h-11 lg:hidden")}
            >
              <ArrowDown className="size-4" aria-hidden="true" /> Order summary
            </a>
          </div>
        }
      />

      <form noValidate onSubmit={confirm}>
        <fieldset
          disabled={busy}
          className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.72fr)] xl:gap-6"
        >
          <legend className="sr-only">Rental checkout</legend>
          <div className="min-w-0 space-y-5 [&_input:not([type])]:min-h-11 [&_select]:min-h-11">
            <Panel title="Rental details">
              <RentalSetup f={f} branchName={branchName} />
              <CheckoutCart f={f} />
            </Panel>

            <Panel title="Customer">
              {editing ? (
                <div className="text-sm">
                  <p className="font-semibold">{editing.customers.full_name}</p>
                  <p className="mt-1 text-muted-foreground">
                    {editing.customers.phone}
                  </p>
                </div>
              ) : loadingCustomer ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <CustomerPicker
                  showOptionalDetails
                  selected={customer}
                  onSelect={(selected) => {
                    setCustomer(selected);
                    set({ customerId: selected?.id ?? null });
                  }}
                  draft={d.customer}
                  onDraft={(draft) => set({ customer: draft })}
                  needsLicence={false}
                />
              )}
            </Panel>

            <Panel title="Payment">
              <CheckoutPayment f={f} />
            </Panel>
          </div>

          <aside
            aria-labelledby="checkout-summary-title"
            className="min-w-0 rounded-xl border border-border bg-surface p-4 sm:p-5 lg:sticky lg:top-6"
          >
            <CheckoutSummary f={f} />
            {pending ? (
              <p role="status" className="mt-4 text-sm text-muted-foreground">
                {f.checkingStock
                  ? "Checking availability…"
                  : "Updating rental pricing…"}
              </p>
            ) : null}
            {attempted && issue && !pending ? (
              <p
                role="alert"
                className="mt-4 rounded-md border border-rust/30 bg-rust/5 p-2.5 text-sm text-rust"
              >
                {issue}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || pending || loadingCustomer}
              className={cn(goldButtonClass, "mt-4 min-h-11 w-full")}
            >
              {busy
                ? "Saving booking…"
                : editing
                  ? "Save change"
                  : "Confirm booking"}
            </button>
            {!editing && !busy ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <Link href="/catalog" className={ghostButtonClass}>
                  <Plus className="size-4" aria-hidden="true" /> Add items
                </Link>
                <button
                  type="button"
                  className={dangerButtonClass}
                  onClick={() => f.setConfirmDiscard(true)}
                >
                  Discard cart
                </button>
              </div>
            ) : null}
          </aside>
        </fieldset>
      </form>

      <Modal
        open={f.confirmDiscard}
        onClose={() => f.setConfirmDiscard(false)}
        title="Discard this cart?"
        description="This removes the items and checkout details for this cart."
        footer={
          <>
            <button
              className={ghostButtonClass}
              onClick={() => f.setConfirmDiscard(false)}
            >
              Keep cart
            </button>
            <button className={dangerButtonClass} onClick={f.reset}>
              Discard
            </button>
          </>
        }
      >
        <span />
      </Modal>
    </>
  );
}

export function BookingConfirmation({
  booked,
  tz,
  onDone,
}: {
  booked: BookedRental;
  tz: string;
  onDone: () => void;
}): React.JSX.Element {
  return (
    <Modal
      open
      onClose={onDone}
      title="Booking confirmed"
      description={`${booked.customer} · ${booked.phone}`}
      footer={
        <>
          <Link
            href={`/print/rental/${booked.rentalId}`}
            target="_blank"
            className={ghostButtonClass}
          >
            Print receipt
          </Link>
          {booked.wa ? (
            <a
              href={booked.wa}
              target="_blank"
              rel="noopener noreferrer"
              className={ghostButtonClass}
              onClick={() => {
                void call("mark_reminder_sent", {
                  p_rental_id: booked.rentalId,
                  p_kind: "confirmation",
                }).catch(() => undefined);
              }}
            >
              WhatsApp
            </a>
          ) : null}
          <button className={goldButtonClass} onClick={onDone}>
            Done
          </button>
        </>
      }
    >
      <div className="rounded-xl bg-accent/60 p-4 text-center">
        <p className="text-2xl font-bold text-gold">{booked.token}</p>
        <p className="mt-2 text-sm tabular-nums">
          {isoToDisplay(isoToZoned(booked.start, tz).slice(0, 10))} →{" "}
          {isoToDisplay(isoToZoned(booked.end, tz).slice(0, 10))}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Total {rupees(booked.total)} · Paid {rupees(booked.paid)}
          {booked.total - booked.paid > 0
            ? ` · Due ${rupees(booked.total - booked.paid)}`
            : ""}
        </p>
      </div>
    </Modal>
  );
}
