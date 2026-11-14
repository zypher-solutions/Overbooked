import { useState } from "react";
import { money } from "@/lib/shop/api";
import {
  inclusiveTaxBreakdown,
  METHOD_LABELS,
  num,
  plural,
  rupees,
} from "@/lib/shop/format";
import type { Method } from "@/lib/shop/types";
import { cn } from "@/lib/utils";
import { Field, inputClass, monoInputClass } from "@/components/shop/ui";
import type { BookingForm } from "@/components/shop/useBookingForm";

// The bottom of the checkout bill: what is taken now (discount, advance, deposit) as rows of
// label · amount · method, the notes, and the totals stacked like a paper bill.

function MoneyRow({
  label,
  hint,
  error,
  amount,
  onAmount,
  method,
}: {
  label: string;
  hint?: string;
  error?: string;
  amount: string;
  onAmount: (value: string) => void;
  method?: {
    label: string;
    value: Method | "";
    onChange: (value: Method | "") => void;
    error?: string;
  };
}): React.JSX.Element {
  const hasAmount = num(amount) > 0;
  const problem = error ?? method?.error;
  return (
    <div className="py-2">
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2 @md:grid-cols-[minmax(0,1fr)_7rem_9.5rem]">
        <span className="text-sm font-medium" title={hint}>{label}</span>
        <input
          className={cn(monoInputClass, "min-h-10 text-right", error && "border-rust/60")}
          inputMode="decimal"
          maxLength={10}
          placeholder="0"
          aria-label={`${label} (₹)`}
          aria-invalid={error ? true : undefined}
          value={amount}
          onChange={(event) => onAmount(event.target.value)}
        />
        {method ? (
          <select
            aria-label={method.label}
            disabled={!hasAmount}
            className={cn(
              inputClass,
              "col-span-2 min-h-10 @md:col-span-1",
              method.error && "border-rust/60",
              // in a narrow column the method only takes a line once there is an amount to pay
              !hasAmount && "hidden @md:block",
            )}
            value={hasAmount ? method.value : ""}
            onChange={(event) =>
              method.onChange(event.target.value as Method | "")
            }
          >
            <option value="">{hasAmount ? "Paid by…" : "No payment"}</option>
            {Object.entries(METHOD_LABELS).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <span className="hidden @md:block" />
        )}
      </div>
      {problem ? (
        <p className="mt-1 text-xs text-rust">{problem}</p>
      ) : hint ? (
        // on a wide screen the hint is a tooltip on the label, to keep the rail short
        <p className="mt-1 text-xs text-muted-foreground xl:sr-only">{hint}</p>
      ) : null}
    </div>
  );
}

export function CheckoutPayment({ f }: { f: BookingForm }): React.JSX.Element {
  const { d, editing, set, shown, editPay, setEditPay } = f;

  return (
    <div className="@container divide-y divide-border">
      <MoneyRow
        label="Discount"
        hint="Optional, taken off the rent."
        amount={d.discount}
        error={shown("discount", d.discount)}
        onAmount={(discount) => set({ discount })}
      />
      {editing ? (
        <MoneyRow
          label="Take a payment now"
          hint="Optional. Amounts already paid are kept."
          amount={editPay.amount}
          error={shown("editPay", editPay.amount)}
          onAmount={(amount) =>
            setEditPay({
              amount,
              method: num(amount) > 0 ? editPay.method : "",
            })
          }
          method={{
            label: "Payment method",
            value: editPay.method,
            onChange: (method) => setEditPay({ ...editPay, method }),
            error: shown("editPayMethod", ""),
          }}
        />
      ) : (
        <MoneyRow
          label="Advance paid"
          hint="Enter 0 if nothing was collected."
          amount={d.advance}
          error={shown("advance", d.advance)}
          onAmount={(advance) =>
            set({
              advance,
              advanceMethod: num(advance) > 0 ? d.advanceMethod : "",
            })
          }
          method={{
            label: "Advance payment method",
            value: d.advanceMethod,
            onChange: (method) => set({ advanceMethod: method }),
            error: shown("advanceMethod", ""),
          }}
        />
      )}
      {editing ? (
        <MoneyRow
          label="Security deposit"
          hint="Agreed amount, kept apart from the rent."
          amount={d.depositAgreed}
          error={shown("deposit", d.depositAgreed)}
          onAmount={(depositAgreed) => set({ depositAgreed })}
        />
      ) : (
        <MoneyRow
          label="Security deposit"
          hint={
            f.suggestedDeposit > 0
              ? `From the products: ${rupees(f.suggestedDeposit)}. Change it if you agreed another amount.`
              : "Kept apart from the rent. Leave blank if none."
          }
          amount={d.deposit}
          error={shown("deposit", d.deposit)}
          onAmount={(deposit) =>
            set({
              deposit,
              depositAgreed: deposit,
              depositMethod: num(deposit) > 0 ? d.depositMethod : "",
            })
          }
          method={{
            label: "Deposit payment method",
            value: d.depositMethod,
            onChange: (method) => set({ depositMethod: method }),
            error: shown("depositMethod", ""),
          }}
        />
      )}
    </div>
  );
}

export function CheckoutNotes({ f }: { f: BookingForm }): React.JSX.Element {
  const { d, set, shown } = f;
  const error = shown("notes", d.notes);
  // folded away until needed; starts open when there is already a note, and opens on a problem with it
  const [open, setOpen] = useState(() => d.notes.trim() !== "");
  return (
    <details
      className="rounded-lg border border-border px-3 py-2 text-sm"
      open={open || !!error}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium text-muted-foreground">
        Notes{d.notes.trim() ? " · added" : " (optional)"}
      </summary>
      <div className="mt-2">
        <Field
          label="Notes"
          hint="Staff see it on the booking."
          error={error}
        >
          <textarea
            rows={3}
            maxLength={500}
            placeholder="Alterations, fitting dates, anything agreed with the customer"
            className={inputClass}
            value={d.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </Field>
      </div>
    </details>
  );
}

function BillRow({
  label,
  children,
  strong,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex justify-between gap-3",
        strong && "border-t border-border pt-2.5 text-base font-semibold",
      )}
    >
      <dt className={cn("min-w-0 break-words", !strong && "text-muted-foreground")}>
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 break-words text-right tabular-nums",
          strong ? "text-gold" : "font-semibold",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function CheckoutSummary({ f }: { f: BookingForm }): React.JSX.Element {
  const { d, editing, total, quote, editPay, lines, shop } = f;
  const advance = num(d.advance);
  const deposit = num(editing ? d.depositAgreed : d.deposit);
  const priorPayment = editing ? money(editing).paid : 0;
  const additionalPayment = num(editPay.amount);
  const due = Math.max(
    0,
    total - (editing ? priorPayment + additionalPayment : advance),
  );
  const gstRate = shop.gstin ? Number(shop.settings?.gst_percent ?? 0) : 0;
  const { tax: includedTax } = inclusiveTaxBreakdown(total, gstRate);
  const discount = num(d.discount);
  const qty = lines.reduce((sum, line) => sum + line.qty, 0);
  const dash = "—";

  return (
    <>
      <h2 id="checkout-summary-title" className="scroll-mt-20 text-base font-semibold">
        Bill · {plural(qty, "item")}
      </h2>
      <dl className="mt-3 space-y-2 text-sm">
        <BillRow label="Rent">
          {quote ? rupees(quote.total_before_discount - quote.add_ons_total) : dash}
        </BillRow>
        {quote && quote.add_ons_total > 0 ? (
          <BillRow label="Accessories">{rupees(quote.add_ons_total)}</BillRow>
        ) : null}
        {discount > 0 ? (
          <BillRow label="Discount">−{rupees(discount)}</BillRow>
        ) : null}
        <BillRow label={gstRate > 0 ? `GST included (${gstRate}%)` : "GST"}>
          {quote ? rupees(includedTax) : dash}
        </BillRow>
        <BillRow label="Bill amount" strong>
          {quote ? rupees(total) : dash}
        </BillRow>
        {editing ? (
          <>
            <BillRow label="Paid so far">−{rupees(priorPayment)}</BillRow>
            {additionalPayment > 0 ? (
              <BillRow label="Paying now">−{rupees(additionalPayment)}</BillRow>
            ) : null}
          </>
        ) : (
          <BillRow label="Advance">−{rupees(advance)}</BillRow>
        )}
        <BillRow label="Balance due" strong>
          {quote ? rupees(due) : dash}
        </BillRow>
        <BillRow label="Security deposit (separate)">{rupees(deposit)}</BillRow>
      </dl>
    </>
  );
}
