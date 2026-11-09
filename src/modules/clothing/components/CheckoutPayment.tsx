import { money } from "@/lib/shop/api";
import {
  inclusiveTaxBreakdown,
  METHOD_LABELS,
  num,
  rupees,
} from "@/lib/shop/format";
import type { Method } from "@/lib/shop/types";
import { Field, inputClass, monoInputClass } from "@/components/shop/ui";
import type { BookingForm } from "@/components/shop/useBookingForm";

const fields = "grid gap-x-5 gap-y-4 sm:grid-cols-2";

function PaymentMethod({
  label,
  value,
  onChange,
  hasAmount,
  error,
}: {
  label: string;
  value: Method | "";
  onChange: (value: Method | "") => void;
  hasAmount: boolean;
  error?: string;
}): React.JSX.Element {
  return (
    <Field label={label} error={error}>
      <select
        aria-label={label}
        required={hasAmount}
        disabled={!hasAmount}
        className={inputClass}
        value={hasAmount ? value : ""}
        onChange={(event) => onChange(event.target.value as Method | "")}
      >
        <option value="">
          {hasAmount ? "Choose a method" : "Enter a positive amount first"}
        </option>
        {Object.entries(METHOD_LABELS).map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckoutPayment({ f }: { f: BookingForm }): React.JSX.Element {
  const { d, editing, set, shown, editPay, setEditPay } = f;

  return (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">Rental charges</legend>
        <div className={fields}>
          <Field
            label="Discount (₹)"
            hint="Optional reduction on the rental charge."
            error={shown("discount", d.discount)}
          >
            <input
              className={monoInputClass}
              inputMode="decimal"
              maxLength={10}
              placeholder="0"
              value={d.discount}
              onChange={(event) => set({ discount: event.target.value })}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-t border-border pt-4">
        <legend className="sr-only">
          {editing ? "Additional payment" : "Advance payment"}
        </legend>
        <h3 aria-hidden="true" className="text-base font-semibold">
          {editing ? "Additional payment" : "Advance payment"}
        </h3>
        {editing ? (
          <div className={fields}>
            <Field
              label="Take a payment now (₹)"
              hint="Optional. Already paid amounts are kept."
              error={shown("editPay", editPay.amount)}
            >
              <input
                className={monoInputClass}
                inputMode="decimal"
                maxLength={10}
                placeholder="0"
                value={editPay.amount}
                onChange={(event) => {
                  const amount = event.target.value;
                  setEditPay({
                    amount,
                    method: num(amount) > 0 ? editPay.method : "",
                  });
                }}
              />
            </Field>
            <PaymentMethod
              label="Payment method"
              value={editPay.method}
              hasAmount={num(editPay.amount) > 0}
              onChange={(method) => setEditPay({ ...editPay, method })}
              error={shown("editPayMethod", editPay.amount)}
            />
          </div>
        ) : (
          <div className={fields}>
            <Field
              label="Advance paid (₹, required)"
              hint="Enter 0 if no advance was collected."
              error={shown("advance", d.advance)}
            >
              <input
                className={monoInputClass}
                inputMode="decimal"
                maxLength={10}
                placeholder="0"
                required
                value={d.advance}
                onChange={(event) => {
                  const advance = event.target.value;
                  set({
                    advance,
                    advanceMethod: num(advance) > 0 ? d.advanceMethod : "",
                  });
                }}
              />
            </Field>
            <PaymentMethod
              label="Advance payment method"
              value={d.advanceMethod}
              hasAmount={num(d.advance) > 0}
              onChange={(method) => set({ advanceMethod: method })}
              error={shown("advanceMethod", d.advance)}
            />
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3 border-t border-border pt-4">
        <legend className="sr-only">Deposit</legend>
        <h3 aria-hidden="true" className="text-base font-semibold">
          Deposit
        </h3>
        <div className={fields}>
          <Field
            label="Security deposit (₹)"
            hint={
              editing
                ? "Agreed amount, tracked separately."
                : f.suggestedDeposit > 0
                  ? `Filled in from the products (${rupees(f.suggestedDeposit)}). Change it if you agreed a different amount.`
                  : "Leave blank if no deposit was collected."
            }
            error={shown("deposit", editing ? d.depositAgreed : d.deposit)}
          >
            {editing ? (
              <input
                className={monoInputClass}
                inputMode="decimal"
                maxLength={10}
                placeholder="0"
                value={d.depositAgreed}
                onChange={(event) => set({ depositAgreed: event.target.value })}
              />
            ) : (
              <input
                className={monoInputClass}
                inputMode="decimal"
                maxLength={10}
                placeholder="0"
                value={d.deposit}
                onChange={(event) => {
                  const deposit = event.target.value;
                  set({
                    deposit,
                    depositAgreed: deposit,
                    depositMethod: num(deposit) > 0 ? d.depositMethod : "",
                  });
                }}
              />
            )}
          </Field>
          {!editing ? (
            <PaymentMethod
              label="Deposit payment method"
              value={d.depositMethod}
              hasAmount={num(d.deposit) > 0}
              onChange={(method) => set({ depositMethod: method })}
              error={shown("depositMethod", d.deposit)}
            />
          ) : null}
        </div>
      </fieldset>

      <div className="border-t border-border pt-4">
        <Field
          label="Notes"
          hint="Optional. Visible to staff on the booking."
          error={shown("notes", d.notes)}
        >
          <textarea
            rows={3}
            maxLength={500}
            className={inputClass}
            value={d.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex justify-between gap-3">
      <dt className="min-w-0 break-words text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-semibold tabular-nums">
        {children}
      </dd>
    </div>
  );
}

export function CheckoutSummary({ f }: { f: BookingForm }): React.JSX.Element {
  const { d, editing, total, quote, editPay, lines, variations, shop } = f;
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

  return (
    <>
      <h2
        id="checkout-summary-title"
        className="scroll-mt-20 text-lg font-semibold"
      >
        Order summary
      </h2>
      {lines.length ? (
        <ul
          aria-label="Order items"
          className="mt-3 max-h-36 divide-y divide-border overflow-y-auto text-sm"
        >
          {lines.map((line) => {
            const product = variations.get(line.variation_id);
            const priced = f.quoteLineFor(line.variation_id);
            const name =
              product?.product.name ?? priced?.description ?? "Cart item";
            const variant = product?.variation.name;
            return (
              <li
                key={line.variation_id}
                className="flex items-baseline justify-between gap-3 py-2"
              >
                <span className="min-w-0 break-words">
                  <span className="font-medium">{name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {variant && variant !== name ? `${variant} · ` : ""}Qty{" "}
                    {line.qty}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {priced ? rupees(priced.amount) : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Your cart is empty.
        </p>
      )}
      <dl className="mt-3 space-y-2.5 border-t border-border pt-3 text-sm">
        <ReviewRow label="Cart subtotal">
          {quote ? rupees(quote.total_before_discount) : "—"}
        </ReviewRow>
        {quote && quote.add_ons_total > 0 ? (
          <ReviewRow label="Accessories included">
            {rupees(quote.add_ons_total)}
          </ReviewRow>
        ) : null}
        {discount > 0 ? (
          <ReviewRow label="Discount">−{rupees(discount)}</ReviewRow>
        ) : null}
        <ReviewRow label={gstRate > 0 ? `GST included (${gstRate}%)` : "GST"}>
          {quote ? rupees(includedTax) : "—"}
        </ReviewRow>
        <ReviewRow label="Rental total">
          {quote ? rupees(total) : "—"}
        </ReviewRow>
        {editing ? (
          <>
            <ReviewRow label="Paid so far">{rupees(priorPayment)}</ReviewRow>
            {additionalPayment > 0 ? (
              <ReviewRow label="Additional payment">
                {rupees(additionalPayment)}
              </ReviewRow>
            ) : null}
          </>
        ) : (
          <ReviewRow label="Advance paid">{rupees(advance)}</ReviewRow>
        )}
        <div className="flex justify-between gap-3 border-t border-border pt-3 text-base font-semibold">
          <dt>Remaining rental balance</dt>
          <dd className="shrink-0 tabular-nums text-gold">
            {quote ? rupees(due) : "—"}
          </dd>
        </div>
        <ReviewRow label="Security deposit (separate)">
          {rupees(deposit)}
        </ReviewRow>
      </dl>
    </>
  );
}
