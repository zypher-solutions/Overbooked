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
    <section className={cn("rounded-xl border border-border bg-surface p-4 shadow-sm", className)}>
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

export const tableWrap = "overflow-x-auto rounded-xl border border-border bg-surface shadow-sm";
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

export function MethodPicker({ value, onChange, allowNone = false }: { value: Method | ""; onChange: (m: Method | "") => void; allowNone?: boolean }) {
  const options: (Method | "")[] = [...(allowNone ? [""] as const : []), "cash", "upi", "card", "bank_transfer"];
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Payment method">
      {options.map((m) => (
        <button key={m || "none"} type="button" role="radio" aria-checked={value === m} onClick={() => onChange(m)}
          className={cn("rounded-full border px-3 py-1 text-xs transition-colors",
            value === m ? "border-gold/60 bg-gold/10 font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
          {m ? METHOD_LABELS[m] : "Not now"}
        </button>
      ))}
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
        {footer ? <div className="flex flex-wrap justify-end gap-2 pt-2">{footer}</div> : null}
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
