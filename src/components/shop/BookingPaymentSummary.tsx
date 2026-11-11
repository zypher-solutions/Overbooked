"use client";

import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { money, type RentalDetail } from "@/lib/shop/api";
import {
  fmtDateTime,
  METHOD_LABELS,
  PAYMENT_LABELS,
  rupees,
} from "@/lib/shop/format";
import { cn } from "@/lib/utils";
import type { Fix } from "./RentalDialogs";

function MoneyRow({
  label,
  amount,
  hint,
}: {
  label: string;
  amount: number | string;
  hint?: string;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 text-sm text-muted-foreground">
        {label}
        {hint ? <span className="mt-0.5 block text-xs">{hint}</span> : null}
      </dt>
      <dd className="min-w-0 text-right text-sm font-semibold tabular-nums wrap-break-word">
        {rupees(amount)}
      </dd>
    </div>
  );
}

export function BookingPaymentSummary({
  rental,
  tz,
  isOwner,
  canVoid,
  onCorrection,
}: {
  rental: RentalDetail;
  tz: string;
  isOwner: boolean;
  /** the owner, or a manager when Settings > Staff controls allows it (migration 039) */
  canVoid: boolean;
  onCorrection: (fix: Fix) => void;
}): React.JSX.Element {
  const { total, paid, balance, depositHeld } = money(rental);
  const closed = rental.status === "cancelled" || rental.status === "no_show";
  const overpaid = !closed && balance < 0;

  return (
    <section
      aria-labelledby="booking-payment-title"
      className="glass min-w-0 p-4 sm:p-5"
    >
      <h2 id="booking-payment-title" className="text-base font-semibold">
        Payment summary
      </h2>
      <dl className="mt-3 rounded-lg border border-border bg-muted/45 px-3 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <dt className="text-sm font-medium">
            {overpaid ? "Overpayment" : "Balance due"}
          </dt>
          <dd className="text-xl font-semibold tabular-nums text-gold">
            {rupees(closed ? 0 : Math.abs(balance))}
          </dd>
        </div>
      </dl>

      <dl className="mt-4 space-y-2.5">
        <MoneyRow
          label={closed ? "Cancellation fee" : "Rental total"}
          amount={total}
          hint={
            !closed && Number(rental.discount)
              ? `After ${rupees(rental.discount)} discount`
              : undefined
          }
        />
        <MoneyRow
          label={closed ? "Paid after refunds" : "Paid toward rental"}
          amount={paid}
        />
        {closed && Number(rental.discount) ? (
          <MoneyRow label="Booking discount" amount={rental.discount} />
        ) : null}
        {Number(rental.add_ons_total) ? (
          <MoneyRow
            label={closed ? "Booking extras" : "Extras included"}
            amount={rental.add_ons_total}
          />
        ) : null}
        {Number(rental.charges_total) ? (
          <MoneyRow
            label={closed ? "Booking charges" : "Charges included"}
            amount={rental.charges_total}
          />
        ) : null}
      </dl>

      <div className="mt-4 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">Security deposit</h3>
        <dl className="mt-2 space-y-2">
          <MoneyRow label="Agreed amount" amount={rental.deposit_agreed} />
          <MoneyRow label="Amount held now" amount={depositHeld} />
          {Number(rental.deposit_applied) ? (
            <MoneyRow label="Deposit kept" amount={rental.deposit_applied} />
          ) : null}
          {Number(rental.deposit_refunded) ? (
            <MoneyRow
              label="Deposit returned"
              amount={rental.deposit_refunded}
            />
          ) : null}
        </dl>
      </div>

      {rental.payments.length ? (
        <details className="mt-4 border-t border-border pt-2">
          <summary className="min-h-11 cursor-pointer rounded-md py-3 text-sm font-semibold text-gold hover:underline">
            Payment records ({rental.payments.length})
          </summary>
          <ul className="divide-y divide-border text-sm">
            {rental.payments.map((payment) => {
              const label = PAYMENT_LABELS[payment.kind];
              const date = fmtDateTime(payment.paid_at, tz);
              const refund =
                payment.kind === "refund" || payment.kind === "deposit_refund";
              const voided = !!payment.voided_at;
              return (
                <li
                  key={payment.id}
                  className={cn("flex flex-wrap items-start justify-between gap-x-2 gap-y-1 py-2", voided && "text-muted-foreground")}
                >
                  <div className="min-w-0 flex-1 wrap-break-word">
                    {voided ? (
                      <p className="text-xs font-semibold uppercase tracking-wide text-rust">
                        Void{payment.void_reason ? `: ${payment.void_reason}` : ""}
                      </p>
                    ) : null}
                    <p className={cn("font-medium", voided && "line-through")}>
                      {label}
                      {payment.method
                        ? ` · ${METHOD_LABELS[payment.method]}`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {date}
                      {payment.note ? ` · ${payment.note}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={cn("font-semibold tabular-nums", voided && "line-through")}>
                      {refund ? "−" : ""}
                      {rupees(payment.amount)}
                    </span>
                    {!voided && (canVoid || (isOwner && payment.method)) ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          type="button"
                          className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
                          aria-label="Correct this payment"
                        >
                          <MoreHorizontal
                            aria-hidden="true"
                            className="size-4"
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {/* a wrong amount is voided and entered again, so the record keeps both; only the method is changed in place */}
                          {isOwner && payment.method ? (
                            <DropdownMenuItem
                              onClick={() =>
                                onCorrection({
                                  kind: "payment",
                                  id: payment.id,
                                  label,
                                  amount: Number(payment.amount),
                                  method: payment.method,
                                })
                              }
                            >
                              Change how it was paid
                            </DropdownMenuItem>
                          ) : null}
                          {canVoid ? (
                            <DropdownMenuItem
                              className="text-rust"
                              onClick={() =>
                                onCorrection({
                                  kind: "void_payment",
                                  id: payment.id,
                                  label: `${label} ${rupees(payment.amount)} on ${date}`,
                                  amount: Number(payment.amount),
                                  method: payment.method,
                                })
                              }
                            >
                              Void (and enter the correct one)
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
