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
import { NewCustomerDialog } from "@/components/shop/NewCustomerDialog";
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

// one band of the checkout card: a small heading, then its fields; a line separates the bands
function Band({
  title,
  actions,
  className,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className={cn("min-w-0 px-5 py-3", className)}>
      <div className="mb-2 flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
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
      {periodOk && f.branchId && !f.checkingStock && !f.stockError && f.shortItems.length ? (
        <p role="status" className="text-sm font-semibold text-rust">
          {f.shortItems.length === 1
            ? "1 item is not free for these dates."
            : `${f.shortItems.length} items are not free for these dates.`}{" "}
          <span className="font-normal">Change the dates or the cart below.</span>
        </p>
      ) : periodOk ? (
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
  // the new-customer popup: null when closed, else what was typed in the search box
  const [creating, setCreating] = useState<string | null>(null);
  const branchName =
    activeBranches.find((branch) => branch.id === branchId)?.name ?? "";
  const customerIssue =
    editing || loadingCustomer
      ? null
      : customer
        ? customer.is_blocked
          ? "Choose a customer who can make a booking."
          : null
        : customerProblem(d.customer)
          ? "Choose a customer, or create a new one."
          : null;
  const paymentIssue =
    Object.values(f.moneyErrors).find(Boolean) ??
    (editing && f.quote && f.total < money(editing).paid
      ? "The new total is less than what was already paid. Record a refund on the booking first."
      : null);
  const issue = rentalIssue(f) ?? customerIssue ?? paymentIssue;
  // said before anyone presses Confirm: what is still missing (dates, stock, pieces, the customer)
  const stillToDo = editing ? null : (rentalIssue(f) ?? customerIssue);
  const submitLabel = busy
    ? "Saving booking…"
    : editing
      ? "Save change"
      : "Confirm booking";
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
      <PageHeader
        compact
        title={editing ? `Change booking ${editing.token}` : "Checkout"}
        before={
          !busy ? (
            <Link
              href={editing ? `/rentals/${editing.id}` : "/scan"}
              className={cn(ghostButtonClass, "min-h-9")}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {editing ? "Back to booking" : "Inventory search"}
            </Link>
          ) : undefined
        }
        actions={
          !editing && !busy ? (
            <CartSwitcher activeLabel={activeCustomer} />
          ) : undefined
        }
      />

      <form noValidate onSubmit={confirm}>
        {/* One card in bands, like a paper bill: booking, customer, items, then a bottom strip with the notes, the
            payment and the bill. The dates sit right above the items, so a date that clashes with a booked piece shows
            up where it was typed. */}
        <fieldset disabled={busy} className="min-w-0">
          <legend className="sr-only">Rental checkout</legend>

          <div className="glass xl:-mb-24 xl:grid xl:h-[calc(100dvh-9.5rem)] xl:min-h-[42rem] xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-[minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 divide-y divide-border xl:flex xl:min-h-0 xl:flex-col">
              <Band title="Booking">
                <RentalSetup f={f} branchName={branchName} />
              </Band>

              <Band title="Customer">
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
                    onCreateNew={(typed) => setCreating(typed)}
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
              </Band>

              <Band
                className="xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"
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
              </Band>
            </div>

            {/* the money: a rail down the right of the card that stays in view while the left side scrolls */}
            <div className="min-h-0 min-w-0 border-t border-border bg-muted/20 xl:rounded-r-[inherit] xl:border-l xl:border-t-0">
              <aside
                aria-labelledby="checkout-summary-title"
                className="min-w-0 space-y-4 p-4 xl:h-full xl:overflow-y-auto"
              >
                <CheckoutSummary f={f} />
                <div className="border-t border-border pt-3">
                  <h2 className="text-sm font-semibold">Payment</h2>
                  <CheckoutPayment f={f} />
                </div>
                <CheckoutNotes f={f} />
                <div className="space-y-2">
                  {pending ? (
                    <p role="status" className="text-sm text-muted-foreground">
                      {f.checkingStock
                        ? "Checking availability…"
                        : "Updating the price…"}
                    </p>
                  ) : attempted && issue ? (
                    <p
                      role="alert"
                      className="rounded-md border border-rust/30 bg-rust/5 p-2.5 text-sm text-rust"
                    >
                      {issue}
                    </p>
                  ) : stillToDo ? (
                    // what is still missing, said before anyone presses Confirm (customer gaps only after a try)
                    <p className="rounded-md border border-border bg-muted/40 p-2.5 text-sm text-muted-foreground">
                      {stillToDo}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={busy || pending || loadingCustomer}
                    className={cn(goldButtonClass, "hidden min-h-11 w-full xl:inline-flex")}
                  >
                    {submitLabel}
                  </button>
                  {!editing && !busy ? (
                    <button
                      type="button"
                      className={cn(dangerButtonClass, "w-full")}
                      onClick={() => f.setConfirmDiscard(true)}
                    >
                      Discard this cart
                    </button>
                  ) : null}
                </div>
              </aside>
            </div>
          </div>

          {/* below xl the bill is at the end of the page, so Confirm stays at the bottom of the screen */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-lg backdrop-blur lg:left-64 xl:hidden">
            {attempted && issue && !pending ? (
              <p role="alert" className="mb-2 line-clamp-2 text-sm text-rust">
                {issue}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-sm">
                <span className="block text-xs text-muted-foreground">
                  Bill amount
                </span>
                <span className="font-semibold tabular-nums text-gold">
                  {f.quote ? rupees(f.total) : "—"}
                </span>
              </p>
              <button
                type="submit"
                disabled={busy || pending || loadingCustomer}
                className={cn(goldButtonClass, "min-h-11 shrink-0")}
              >
                {pending ? "Checking…" : submitLabel}
              </button>
            </div>
          </div>
        </fieldset>
      </form>

      <NewCustomerDialog
        open={creating !== null}
        prefill={creating ?? ""}
        onClose={() => setCreating(null)}
        onCreated={(created) => {
          setCustomer(created);
          set({ customerId: created.id });
          setCreating(null);
        }}
      />

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
