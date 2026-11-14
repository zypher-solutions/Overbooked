import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "accent" | "gold" | "emerald" | "rust" | "muted" | "indigo";

const toneClasses: Record<Tone, string> = {
  accent: "[--badge-tone:var(--gold)]",
  gold: "[--badge-tone:var(--amber)]",
  emerald: "[--badge-tone:var(--emerald)]",
  rust: "[--badge-tone:var(--rust)]",
  muted: "[--badge-tone:var(--muted-foreground)]",
  indigo: "[--badge-tone:var(--indigo)]",
};

export function StatusBadge({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "status-badge inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs leading-4 font-semibold",
        toneClasses[tone],
        className,
      )}
    >
      {children}
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
    <div className="glass p-4 transition-colors duration-150 hover:border-gold/25 sm:p-5">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 font-sans text-2xl font-semibold tabular-nums sm:text-[26px]",
          valueTone,
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p>
      ) : null}
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
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-foreground">
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
  "w-full rounded-xl border border-input bg-white px-3 py-2.5 sm:py-2 text-sm text-foreground outline-none transition-all duration-200 placeholder:text-muted-foreground/80 focus:border-neon focus:ring-2 focus:ring-ring disabled:opacity-60 read-only:text-muted-foreground";

export const monoInputClass = cn(inputClass, "font-sans tabular-nums");

export const labelClass =
  "mb-1.5 block text-xs font-semibold tracking-wide text-foreground";

export const goldButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[#101715] px-5 py-2.5 sm:py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-gold hover:shadow-lg disabled:opacity-50 disabled:hover:shadow-none";

export const ghostButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-medium text-foreground transition-colors duration-150 hover:border-gold/40 hover:bg-accent";
