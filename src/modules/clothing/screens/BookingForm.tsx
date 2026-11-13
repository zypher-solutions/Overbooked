"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, ShoppingBag } from "lucide-react";
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
  CheckoutNotes,
  CheckoutSummary,
} from "@/modules/clothing/components/CheckoutPayment";

function rentalIssue(f: BookingFormState): string | null {
  if (!f.d.start) return "Enter a pickup date.";
  if (f.startInPast) return "Choose a pickup date of today or later.";
  if (!f.d.end) return "Enter a return date to check availability.";
  if (!f.periodOk)
    return "The return date must be on or after the pickup date.";
  if (!f.branchId) return "Choose a branch.";
  if (f.cleaningBad) return "Cleaning days cannot be negative.";
  if (!f.lines.length) return "Add at least one item to the cart.";
  if (f.stockError) return `Could not check stock. ${f.stockError}`;
  if (f.shortItems.length)
    return "Some cart items are unavailable. Change the dates or adjust the cart.";
  const shortAccessory = f.pickableAddOns.find(
    (a) => f.d.addOns[a.id] !== undefined && f.addOnFree[a.id] !== undefined && f.d.addOns[a.id] > f.addOnFree[a.id],
  );
  if (shortAccessory)
    return `Only ${f.addOnFree[shortAccessory.id]} ${shortAccessory.name} free for these dates. Lower the number or change the dates.`;
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
    <div className="space-y-3">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Pickup date (required)"
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
        <Field label="Pickup branch">
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
          label="Cleaning days after return"
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
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            {quote ? plural(quote.days, "day") : "…"}
          </span>{" "}
          rental · {plural(cleaning ?? 0, "cleaning day")} · pieces free again{" "}
          <span className="font-semibold text-gold">
            {isoToDisplay(addDays(returns, (cleaning ?? 0) + 1))}
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Use today for a walk-in. The dates decide which pieces are free.
        </p>
      )}
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

  // a cart with nothing in it and no customer: nothing to check out, so say so instead of showing an empty bill
  const hasContent = f.lines.length > 0 || !!activeCustomer;
  const otherCarts = f.cart.carts.length > 1;

  if (!editing && !hasContent && !busy)
    return (
      <>
        <PageHeader
          title="Checkout"
          actions={<CartSwitcher activeLabel={activeCustomer} />}
        />
        <Panel>
          <div className="mx-auto max-w-md py-8 text-center">
            <ShoppingBag
              className="mx-auto size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <h2 className="mt-3 text-lg font-semibold">
              {`Cart ${f.cart.id} is empty`}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a product first. Scan a tag or search in Inventory search, or
              pick from Products.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link href="/scan" className={goldButtonClass}>
                Inventory search
              </Link>
              <Link href="/catalog" className={ghostButtonClass}>
                Products
              </Link>
              {otherCarts ? (
                <button type="button" className={ghostButtonClass} onClick={f.reset}>
                  Close this cart
                </button>
              ) : null}
            </div>
          </div>
        </Panel>
      </>
    );

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
        actions={
          !editing && !busy ? (
            <CartSwitcher activeLabel={activeCustomer} />
          ) : undefined
        }
      />

      <form noValidate onSubmit={confirm}>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <legend className="sr-only">Rental checkout</legend>

          <Panel title="Booking details">
            <RentalSetup f={f} branchName={branchName} />
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

          <Panel
            title="Items"
            actions={
              !editing ? (
                <Link href="/catalog" className={ghostButtonClass}>
                  <Plus className="size-4" aria-hidden="true" /> Add items
                </Link>
              ) : undefined
            }
          >
            <CheckoutCart f={f} />
          </Panel>

          <Panel>
            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.35fr)_minmax(17rem,1fr)]">
              <div className="order-3 min-w-0 lg:order-1">
                <CheckoutNotes f={f} />
              </div>
              <div className="order-1 min-w-0 lg:order-2">
                <h2 className="text-base font-semibold">Payment</h2>
                <CheckoutPayment f={f} />
              </div>
              <aside
                aria-labelledby="checkout-summary-title"
                className="order-2 min-w-0 rounded-xl border border-border bg-muted/30 p-4 lg:order-3"
              >
                <CheckoutSummary f={f} />
                {pending ? (
                  <p role="status" className="mt-3 text-sm text-muted-foreground">
                    {f.checkingStock
                      ? "Checking availability…"
                      : "Updating the price…"}
                  </p>
                ) : null}
                {attempted && issue && !pending ? (
                  <p
                    role="alert"
                    className="mt-3 rounded-md border border-rust/30 bg-rust/5 p-2.5 text-sm text-rust"
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
                  <button
                    type="button"
                    className={cn(dangerButtonClass, "mt-2 w-full")}
                    onClick={() => f.setConfirmDiscard(true)}
                  >
                    Discard this cart
                  </button>
                ) : null}
              </aside>
            </div>
          </Panel>
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
