"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/overbooked/primitives";

// Dates are typed and shown as DD/MM/YY. The value stays "YYYY-MM-DD", so nothing else in the app changes.
// A calendar button opens the browser's own picker.

/** "2026-11-03" -> "03/11/26" */
export function isoToDisplay(iso: string): string {
  const [y, m, d] = (iso || "").split("-");
  if (!y || !m || !d) return "";
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y.slice(2)}`;
}

/** "3/11/26", "03-11-2026", "03.11.26" or "2026-11-03" -> "2026-11-03"; "" for empty; null when it is not a real date */
export function parseDateText(input: string): string | null {
  const t = (input ?? "").trim();
  if (!t) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  let y: number, m: number, d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])];
  else return null;
  if (m < 1 || m > 12 || d < 1 || y < 2000 || y > 2099 || d > new Date(y, m, 0).getDate()) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

interface DateInputProps {
  value: string; // YYYY-MM-DD, or ""
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
  id?: string;
}

export function DateInput({ value, onChange, min, max, disabled, required, className, id, "aria-label": ariaLabel }: DateInputProps) {
  const [text, setText] = useState(() => isoToDisplay(value));
  const picker = useRef<HTMLInputElement>(null);
  // follow the value when it changes from outside (the calendar, a draft, another field)
  useEffect(() => { setText(isoToDisplay(value)); }, [value]);

  const type = (next: string) => {
    setText(next);
    if (next.trim() === "") { onChange(""); return; }
    const iso = parseDateText(next);
    if (iso) onChange(iso);
  };
  const leave = () => {
    const iso = parseDateText(text);
    setText(iso === null ? isoToDisplay(value) : isoToDisplay(iso)); // an unreadable date goes back to the last good one
  };
  const open = () => {
    if (disabled) return;
    try { picker.current?.showPicker(); } catch { picker.current?.focus(); }
  };

  return (
    <div className={cn("relative", className)}>
      <input id={id} aria-label={ariaLabel} type="text" inputMode="numeric" autoComplete="off" disabled={disabled} required={required} placeholder="DD/MM/YY" maxLength={10}
        className={cn(inputClass, "w-full pr-10 font-sans tabular-nums")} value={text} onChange={(e) => type(e.target.value)} onBlur={leave} />
      <button type="button" tabIndex={-1} disabled={disabled} onClick={open} title="Open calendar" aria-label="Open calendar"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-gold disabled:opacity-40">
        <CalendarIcon className="h-4 w-4" />
      </button>
      <input ref={picker} type="date" tabIndex={-1} aria-hidden="true" disabled={disabled} min={min} max={max} value={value || ""}
        onChange={(e) => { onChange(e.target.value); setText(isoToDisplay(e.target.value)); }}
        className="pointer-events-none absolute bottom-0 right-2 h-0 w-0 opacity-0" />
    </div>
  );
}

// A date and a time for things that happen at a moment (a return, an extension, an appointment).
// The value stays "YYYY-MM-DDTHH:MM" like the browser's own datetime box.
export function DateTimeInput({ value, onChange, min, max, disabled, className }: {
  value: string; onChange: (local: string) => void; min?: string; max?: string; disabled?: boolean; className?: string;
}) {
  const [date, time = ""] = (value || "").split("T");
  return (
    <div className={cn("grid grid-cols-[1fr_7.5rem] gap-2", className)}>
      <DateInput value={date ?? ""} min={min?.slice(0, 10)} max={max?.slice(0, 10)} disabled={disabled} aria-label="Date"
        onChange={(d) => onChange(d ? `${d}T${time || "10:00"}` : "")} />
      <input type="time" aria-label="Time" disabled={disabled || !date} className={cn(inputClass, "font-sans tabular-nums")} value={time}
        onChange={(e) => onChange(date ? `${date}T${e.target.value || "00:00"}` : "")} />
    </div>
  );
}
