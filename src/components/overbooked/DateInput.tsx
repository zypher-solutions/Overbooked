"use client";

import React, { useRef, useState, useEffect } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Converts YYYY-MM-DD -> DD/MM/YY */
export function isoToDisplay(iso: string): string {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return "";
  const [y, m, d] = parts;
  if (!y || !m || !d) return "";
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y.slice(2)}`;
}

/** Parses DD/MM/YY, DD/MM/YYYY, DD-MM-YY, DD-MM-YYYY, or YYYY-MM-DD into YYYY-MM-DD */
export function parseDateInputToISO(input: string): string | null {
  if (!input || !input.trim()) return "";
  const trimmed = input.trim();

  // Already ISO format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const daysInMonth = new Date(y, m, 0).getDate();
      if (d <= daysInMonth) return trimmed;
    }
    return null;
  }

  // DD/MM/YY or DD/MM/YYYY with '/', '-', or '.'
  const clean = trimmed.replace(/[.-]/g, "/");
  const parts = clean.split("/");
  if (parts.length === 3) {
    let [d, m, y] = parts;
    if (d.length === 1) d = "0" + d;
    if (m.length === 1) m = "0" + m;
    if (y.length === 2) y = "20" + y;

    if (d.length === 2 && m.length === 2 && y.length === 4) {
      const dayNum = parseInt(d, 10);
      const monthNum = parseInt(m, 10);
      const yearNum = parseInt(y, 10);

      if (
        monthNum >= 1 &&
        monthNum <= 12 &&
        dayNum >= 1 &&
        dayNum <= 31 &&
        yearNum >= 2000 &&
        yearNum <= 2099
      ) {
        const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
        if (dayNum <= daysInMonth) {
          return `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
        }
      }
    }
  }
  return null;
}

export interface DateInputProps {
  value?: string; // ISO string YYYY-MM-DD
  onChange: (isoValue: string) => void;
  min?: string; // ISO string YYYY-MM-DD
  max?: string; // ISO string YYYY-MM-DD
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  name?: string;
}

export function DateInput({
  value = "",
  onChange,
  min,
  max,
  placeholder = "DD/MM/YY",
  className,
  disabled = false,
  readOnly = false,
  id,
  name,
}: DateInputProps) {
  const [displayText, setDisplayText] = useState(() => isoToDisplay(value));
  const nativePickerRef = useRef<HTMLInputElement>(null);

  // Keep display text synchronized with external value changes
  useEffect(() => {
    setDisplayText(isoToDisplay(value));
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextText = e.target.value;
    setDisplayText(nextText);

    if (nextText === "") {
      onChange("");
      return;
    }

    const iso = parseDateInputToISO(nextText);
    if (iso) {
      onChange(iso);
    }
  };

  const handleBlur = () => {
    if (!displayText.trim()) {
      if (value) onChange("");
      setDisplayText("");
      return;
    }

    const iso = parseDateInputToISO(displayText);
    if (iso) {
      onChange(iso);
      setDisplayText(isoToDisplay(iso));
    } else {
      // Revert to valid display for current value
      setDisplayText(isoToDisplay(value));
    }
  };

  const openPicker = () => {
    if (disabled || readOnly) return;
    if (nativePickerRef.current) {
      try {
        nativePickerRef.current.showPicker();
      } catch {
        nativePickerRef.current.focus();
      }
    }
  };

  return (
    <div className="relative flex items-center w-full group">
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        disabled={disabled}
        readOnly={readOnly}
        value={displayText}
        placeholder={placeholder}
        onChange={handleInputChange}
        onBlur={handleBlur}
        className={cn(
          "w-full rounded-sm border border-input bg-white/[0.03] px-3 py-2 pr-10 text-sm font-mono text-foreground outline-none transition-all duration-200 placeholder:text-muted-foreground/60 focus:border-gold/50 focus:ring-2 focus:ring-ring disabled:opacity-60 read-only:text-muted-foreground",
          className
        )}
      />

      {/* Calendar Icon Button */}
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled || readOnly}
        onClick={openPicker}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-gold transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-40"
        title="Open calendar"
      >
        <CalendarIcon className="w-4 h-4" />
      </button>

      {/* Hidden native date input used solely to open the browser/OS calendar picker */}
      <input
        ref={nativePickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled || readOnly}
        min={min}
        max={max}
        value={value || ""}
        onChange={(e) => {
          const newIso = e.target.value;
          onChange(newIso);
          setDisplayText(isoToDisplay(newIso));
        }}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 opacity-0 cursor-pointer pointer-events-auto"
        onClick={(e) => {
          // If browser doesn't open picker automatically on click, showPicker is called
          try {
            (e.target as HTMLInputElement).showPicker?.();
          } catch { /* ignore: unsupported picker */ }
        }}
      />
    </div>
  );
}
