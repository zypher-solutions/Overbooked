"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/overbooked/primitives";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { METHOD_LABELS, STATUS_LABELS } from "@/lib/shop/format";
import type { Method, Rental } from "@/lib/shop/types";

export { Field, SummaryCard, StatusBadge, inputClass, monoInputClass, goldButtonClass, ghostButtonClass } from "@/components/overbooked/primitives";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("glass p-5", className)}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-sm font-semibold text-foreground">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export const tableWrap = "overflow-x-auto glass";
export const theadClass = "bg-muted/70 text-xs font-medium uppercase tracking-wider text-muted-foreground";
export const linkClass = "font-medium text-foreground hover:text-gold";
export const dangerButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-md border border-rust/40 bg-rust/10 px-3 py-2 sm:py-1.5 text-xs font-medium text-rust transition-colors hover:bg-rust/15 disabled:opacity-50";

export function isOverdue(r: Pick<Rental, "status" | "end_at" | "start_at">, now = Date.now()) {
  return (r.status === "active" && Date.parse(r.end_at) < now) || (r.status === "reserved" && Date.parse(r.start_at) < now);
}

// room: a stay (checked in / checked out) rather than something handed over
export function RentalStatusBadge({ rental, room = false }: { rental: Pick<Rental, "status" | "end_at" | "start_at">; room?: boolean }) {
  const late = isOverdue(rental);
  if (rental.status === "active") return <StatusBadge tone={late ? "rust" : "gold"}>{late ? (room ? "Past check-out" : "Overdue") : room ? "Checked in" : "Out"}</StatusBadge>;
  if (rental.status === "reserved") return <StatusBadge tone={late ? "rust" : "indigo"}>{late ? (room ? "Not checked in" : "Not picked up") : "Booked"}</StatusBadge>;
  if (rental.status === "completed") return <StatusBadge tone="emerald">{room ? "Checked out" : "Returned"}</StatusBadge>;
  return <StatusBadge tone="muted">{STATUS_LABELS[rental.status]}</StatusBadge>;
}

export function BalanceBadge({ rental }: { rental: Pick<Rental, "total" | "paid" | "status"> }) {
  const due = Number(rental.total) - Number(rental.paid);
  if (rental.status === "cancelled" || rental.status === "no_show") return null;
  if (due <= 0) return <StatusBadge tone="emerald">Paid</StatusBadge>;
  if (Number(rental.paid) > 0) return <StatusBadge tone="gold">Part paid</StatusBadge>;
  return <StatusBadge tone="rust">Unpaid</StatusBadge>;
}

export function MethodPicker({ value, onChange, allowNone = false, error }: { value: Method | ""; onChange: (m: Method | "") => void; allowNone?: boolean; error?: string }) {
  const options: (Method | "")[] = [...(allowNone ? [""] as const : []), "cash", "upi", "card", "bank_transfer"];
  return (
    <div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Payment method" aria-invalid={error ? true : undefined}>
        {options.map((m) => (
          <button key={m || "none"} type="button" role="radio" aria-checked={value === m} onClick={() => onChange(m)}
            className={cn("min-h-9 rounded-full border px-3.5 py-1.5 text-xs transition-colors",
              value === m ? "border-gold/60 bg-gold/10 font-medium text-foreground" : error ? "border-rust/50 text-muted-foreground hover:text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
            {m ? METHOD_LABELS[m] : "Not now"}
          </button>
        ))}
      </div>
      {error ? <span className="mt-1 block text-xs text-rust">{error}</span> : null}
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, wide }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cn("max-h-[92dvh] overflow-y-auto", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-4">{children}</div>
        {/* phones: the buttons are wide, at least 44px tall and stay at the bottom of the sheet while the form scrolls */}
        {footer ? <div className="flex flex-wrap justify-end gap-2 pt-2 max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-4 max-sm:-mb-4 max-sm:flex-nowrap max-sm:border-t max-sm:border-border max-sm:bg-background max-sm:px-4 max-sm:py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:[&>*]:min-h-11 max-sm:[&>*]:flex-1">{footer}</div> : null}
      </DialogContent>
    </Dialog>
  );
}

export function MoneyRows({ rows }: { rows: [ReactNode, ReactNode, ("strong" | "muted" | "rust" | "emerald")?][] }) {
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([label, value, tone], i) => (
        <div key={i} className={cn("flex justify-between gap-3",
          tone === "strong" && "border-t border-border pt-1.5 font-semibold text-foreground",
          tone === "muted" && "text-muted-foreground", tone === "rust" && "font-semibold text-rust", tone === "emerald" && "text-emerald")}>
          <dt>{label}</dt>
          <dd className="font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---- loading placeholders: the shape of the page appears at once, so a click never lands on a blank screen ----
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted/70", className)} />;
}

// a page with a title and a few cards (a booking, a customer, a product)
export function PageSkeleton({ columns = true }: { columns?: boolean }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-72 max-w-full" />
      <div className={cn("grid gap-4", columns && "lg:grid-cols-[1fr_360px]")}>
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
        {columns ? <div className="space-y-4"><Skeleton className="h-64 rounded-xl" /><Skeleton className="h-32 rounded-xl" /></div> : null}
      </div>
    </div>
  );
}

// a list of rows (bookings, customers, products)
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
    </div>
  );
}
