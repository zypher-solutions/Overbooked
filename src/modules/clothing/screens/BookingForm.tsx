"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
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
} from "@/components/shop/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import type { BookingForm as BookingFormState } from "@/components/shop/useBookingForm";
import { CheckoutCart } from "@/modules/clothing/components/CheckoutCart";
import {
  CheckoutPayment,
  CheckoutReview,
} from "@/modules/clothing/components/CheckoutPayment";

const steps = [
  {
    id: "rental",
    label: "Rental setup",
    short: "Rental",
    next: "Continue to customer",
  },
  {
    id: "customer",
    label: "Customer information",
    short: "Customer",
    next: "Continue to payment",
  },
  { id: "payment", label: "Payment", short: "Payment", next: "Review booking" },
  { id: "review", label: "Review & confirm", short: "Review", next: "" },
] as const;

type Step = (typeof steps)[number]["id"];
const validationToast = "checkout-validation";

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
    router,
    tz,
    activeBranches,
    editing,
    d,
    customer,
    setCustomer,
    set,
    branchId,
    checkingStock,
    quotePending,
    busy,
    total,
    submit,
    booked,
    confirmDiscard,
    setConfirmDiscard,
    reset,
  } = f;
  const [step, setStep] = useState<Step>("rental");
  const notifiedIssue = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLElement>(null);
  const index = steps.findIndex(({ id }) => id === step);
  const current = steps[index];
  const pickup = isoToDisplay(d.start.slice(0, 10));
  const returns = isoToDisplay(d.end.slice(0, 10));
  const branchName =
    activeBranches.find((branch) => branch.id === branchId)?.name ?? "";

  const customerIssue = editing
    ? null
    : customer
      ? customer.is_blocked
        ? "Choose a customer who can make a booking."
        : null
      : customerProblem(d.customer);
  const paymentIssue =
    Object.values(f.moneyErrors).find(Boolean) ??
    (editing && f.quote && total < money(editing).paid
      ? "The new total is less than what was already paid. Record a refund on the booking first."
      : null);
  const issues = {
    rental: rentalIssue(f),
    customer: customerIssue,
    payment: paymentIssue,
    review: null,
  };
  const pending =
    step === "rental" &&
    (checkingStock || quotePending) &&
    !f.shortItems.length &&
    !f.stockError;
  const issue = issues[step];

  useEffect(() => {
    if (notifiedIssue.current && notifiedIssue.current !== issue) {
      toast.dismiss(validationToast);
      notifiedIssue.current = null;
    }
  }, [issue]);

  useEffect(
    () => () => {
      toast.dismiss(validationToast);
    },
    [],
  );

  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
    if (form.current) form.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  function goTo(next: Step): void {
    toast.dismiss(validationToast);
    notifiedIssue.current = null;
    setStep(next);
  }

  function showIssue(message: string): void {
    notifiedIssue.current = message;
    toast.error(message, { id: validationToast, toasterId: validationToast });
  }

  function closeForm(): void {
    if (busy || booked) return;
    if (editing) router.push(`/rentals/${editing.id}`);
    else if (window.history.length > 1) router.back();
    else router.push("/scan");
  }

  function advance(): void {
    if (step === "review") {
      const invalid = steps.find(({ id }) => issues[id]);
      const message = invalid && issues[invalid.id];
      if (invalid && message) {
        setStep(invalid.id);
        showIssue(message);
        return;
      }
      void submit();
      return;
    }
    if (issue) {
      showIssue(issue);
      return;
    }
    goTo(steps[index + 1].id);
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <DialogContent
          className="flex h-[min(54rem,calc(100dvh-2rem))] max-h-dvh w-full max-w-5xl flex-col gap-0 overflow-hidden! rounded-xl bg-surface p-0 max-sm:w-dvw! max-sm:p-0 sm:w-[calc(100%-2rem)]"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            heading.current?.focus();
          }}
        >
          <Toaster
            id={validationToast}
            containerAriaLabel="Checkout notifications"
            position="top-center"
            style={{ position: "absolute" }}
          />
          <header className="shrink-0 border-b border-border px-4 pt-5 sm:px-6 sm:pt-6">
            <DialogTitle className="pr-10 font-display text-xl font-semibold leading-tight sm:text-2xl">
              {editing ? `Change booking ${editing.token}` : "Create booking"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Complete rental setup, customer information, payment and final
              review.
            </DialogDescription>
            <nav aria-label="Checkout progress" className="mt-4">
              <ol className="grid grid-cols-4 gap-1.5 sm:gap-3">
                {steps.map(({ id, short, label }, position) => {
                  const done = position < index;
                  const active = id === step;
                  const itemClass = cn(
                    "flex w-full min-w-0 flex-col items-start gap-1.5 border-b-2 px-1 pb-2.5 text-left text-sm font-semibold sm:flex-row sm:items-center sm:gap-2 sm:px-2",
                    active
                      ? "border-gold text-gold"
                      : "border-transparent text-muted-foreground",
                  );
                  const content = (
                    <>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded-full text-xs tabular-nums",
                          active
                            ? "bg-gold text-primary-foreground"
                            : done
                              ? "bg-accent text-gold"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {done ? <Check className="size-4" /> : position + 1}
                      </span>
                      <span className="sm:hidden">{short}</span>
                      <span className="hidden sm:inline">{label}</span>
                    </>
                  );
                  return (
                    <li key={id} aria-current={active ? "step" : undefined}>
                      {done ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={cn(
                            itemClass,
                            "rounded-t-md hover:bg-accent/50",
                          )}
                          onClick={() => goTo(id)}
                        >
                          {content}
                        </button>
                      ) : (
                        <span className={itemClass}>{content}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
          </header>

          <div
            ref={body}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:overflow-hidden"
          >
            <section
              ref={form}
              aria-labelledby="checkout-step-title"
              className="min-w-0 shrink-0 space-y-5 px-4 py-5 sm:px-6 sm:py-6 lg:min-h-0 lg:overflow-y-auto [&_input:not([type])]:min-h-11 [&_input[type=number]]:min-h-11 [&_input[type=text]]:min-h-11 [&_label>span:first-child]:text-sm [&_label>span:first-child]:text-foreground [&_label>span:first-child]:tracking-normal [&_select]:min-h-11"
            >
              <div>
                <h2
                  ref={heading}
                  id="checkout-step-title"
                  tabIndex={-1}
                  className="font-display text-xl font-semibold outline-none"
                >
                  {current.label}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {step === "rental"
                    ? "Set the dates and branch, then check the cart for available pieces."
                    : step === "customer"
                      ? editing
                        ? "Review the customer linked to this booking."
                        : "Find a saved customer, or enter a name and phone number."
                      : step === "payment"
                        ? "Enter any discount, payments collected and security deposit."
                        : "Check the customer, dates and payment totals before saving."}
                </p>
              </div>
              {step === "rental" ? (
                <RentalSetup f={f} branchName={branchName} />
              ) : null}
              {step === "customer" ? (
                editing ? (
                  <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
                    <p className="font-semibold">
                      {editing.customers.full_name}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {editing.customers.phone}
                    </p>
                  </div>
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
                )
              ) : null}
              {step === "payment" ? <CheckoutPayment f={f} /> : null}
              {step === "review" ? (
                <CheckoutReview
                  f={f}
                  pickup={pickup}
                  returns={returns}
                  branchName={branchName}
                />
              ) : null}
            </section>
            <CheckoutCart f={f} editable={step === "rental"} />
          </div>

          <footer className="shrink-0 space-y-2 border-t border-border bg-surface px-4 py-3 sm:px-6 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {pending ? (
              <p role="status" className="text-sm text-muted-foreground">
                {checkingStock
                  ? "Checking availability…"
                  : "Updating rental pricing…"}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {index > 0 ? (
                  <button
                    type="button"
                    disabled={busy}
                    className={ghostButtonClass}
                    onClick={() => goTo(steps[index - 1].id)}
                  >
                    <ArrowLeft aria-hidden="true" className="size-4" /> Back
                  </button>
                ) : null}
                {step === "rental" ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      className={cn(
                        ghostButtonClass,
                        "min-h-11 disabled:opacity-50",
                      )}
                      onClick={closeForm}
                    >
                      {editing ? "Cancel" : "Close (keep draft)"}
                    </button>
                    {!editing ? (
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(
                          dangerButtonClass,
                          "min-h-11 rounded-lg px-4 text-[13px] text-foreground",
                        )}
                        onClick={() => setConfirmDiscard(true)}
                      >
                        Discard draft
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
              <button
                type="button"
                disabled={busy || pending}
                className={cn(
                  goldButtonClass,
                  "ml-auto min-h-11",
                  step === "rental" ? "max-sm:w-full" : "max-sm:flex-1",
                )}
                onClick={advance}
              >
                {step === "review"
                  ? busy
                    ? "Saving booking…"
                    : editing
                      ? "Save change"
                      : `Confirm Booking (${rupees(total)})`
                  : current.next}
                {step !== "review" ? (
                  <ArrowRight aria-hidden="true" className="size-4" />
                ) : null}
              </button>
            </div>
          </footer>
        </DialogContent>
      </Dialog>

      <Modal
        open={!!booked}
        onClose={() => router.push("/bookings")}
        title="Booking confirmed"
        description={
          booked ? `${booked.customer} · ${booked.phone}` : undefined
        }
        footer={
          <>
            {booked ? (
              <Link
                href={`/print/rental/${booked.rentalId}`}
                target="_blank"
                className={ghostButtonClass}
              >
                Print receipt
              </Link>
            ) : null}
            {booked?.wa ? (
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
            <button
              className={goldButtonClass}
              onClick={() => router.push("/bookings")}
            >
              Done
            </button>
          </>
        }
      >
        {booked ? (
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
        ) : (
          <span />
        )}
      </Modal>
      <Modal
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard this draft?"
        description="All cart items and the customer details typed in are cleared."
        footer={
          <>
            <button
              className={ghostButtonClass}
              onClick={() => setConfirmDiscard(false)}
            >
              Keep it
            </button>
            <button
              className={goldButtonClass}
              onClick={() => {
                reset();
                goTo("rental");
              }}
            >
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
