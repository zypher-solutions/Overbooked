import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { PaymentStatus, RentalStatus } from "@/lib/overbooked/types";
import { paymentLabel } from "@/lib/overbooked/utils";

export function TokenBadge({ token, className }: { token: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-gold/35 bg-gold/10 px-2 py-1 font-mono text-[11px] font-medium tracking-tight text-gold",
        className,
      )}
    >
      {token}
    </span>
  );
}

type Tone = "gold" | "emerald" | "rust" | "muted" | "indigo";

const toneClasses: Record<Tone, string> = {
  gold: "border-gold/35 bg-gold/10 text-gold",
  emerald: "border-emerald/40 bg-emerald/12 text-emerald",
  rust: "border-rust/45 bg-rust/14 text-rust",
  muted: "border-border bg-white/5 text-muted-foreground",
  indigo: "border-indigo/45 bg-indigo/14 text-indigo",
};

export function StatusBadge({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-[11px] font-medium",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const tone: Tone = status === "paid" ? "emerald" : status === "partial" ? "gold" : "rust";
  return <StatusBadge tone={tone}>{paymentLabel(status)}</StatusBadge>;
}

export function RentalStatusBadge({ status }: { status: RentalStatus | string }) {
  if (status === "confirmed") return <StatusBadge tone="indigo">Booked</StatusBadge>;
  if (status === "pending") return <StatusBadge tone="gold">Pending</StatusBadge>;
  if (status === "completed") return <StatusBadge tone="emerald">Completed</StatusBadge>;
  if (status === "cancelled") return <StatusBadge tone="rust">Cancelled</StatusBadge>;
  return (
    <StatusBadge tone={status === "returned" ? "emerald" : "rust"}>
      {status === "returned" ? "Returned" : "Out"}
    </StatusBadge>
  );
}

export function BookingStatusBadge({ status }: { status: string }) {
  const tone: Tone = status === "confirmed" ? "emerald" : status === "pending" ? "gold" : status === "completed" ? "indigo" : "rust";
  return <StatusBadge tone={tone}>{status.toUpperCase()}</StatusBadge>;
}

export function StockBadge({ qty }: { qty: number }) {
  return (
    <StatusBadge tone={qty > 0 ? "emerald" : "rust"} className="font-mono">
      {qty}
    </StatusBadge>
  );
}

export function BranchPill({ branch, qty }: { branch: string; qty: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
        qty > 0
          ? "border-emerald/35 bg-emerald/10 text-emerald"
          : "border-rust/35 bg-rust/10 text-rust",
      )}
    >
      {branch}: <span className="font-mono">{qty}</span>
    </span>
  );
}

export function SummaryCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "gold" | "rust" | "emerald";
}) {
  const valueTone =
    tone === "gold"
      ? "text-gold"
      : tone === "rust"
        ? "text-rust"
        : tone === "emerald"
          ? "text-emerald"
          : "text-foreground";
  return (
    <div className="glass p-4 transition-colors duration-300 hover:border-gold/25">
      <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className={cn("mt-2 font-mono text-2xl font-semibold", valueTone)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
        {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-rust">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-sm border border-input bg-white/[0.03] px-3 py-2.5 sm:py-2 text-sm text-foreground outline-none transition-all duration-200 placeholder:text-muted-foreground/60 focus:border-gold/50 focus:ring-2 focus:ring-ring disabled:opacity-60 read-only:text-muted-foreground";

export const monoInputClass = cn(inputClass, "font-mono");

export const labelClass = "mb-1.5 block text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase";

export const goldButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-md bg-gold px-4 py-2.5 sm:py-2 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:brightness-110 hover:shadow-glow-gold disabled:opacity-50 disabled:hover:shadow-none";

export const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-md border border-border bg-white/[0.03] px-3 py-2 sm:py-1.5 text-xs font-medium text-foreground transition-colors duration-200 hover:border-gold/30 hover:bg-white/[0.07]";
