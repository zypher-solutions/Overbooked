"use client";

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

// A 6-digit emailed code as six boxes (typing, pasting and phone autofill all work).
export function CodeBoxes({ value, onChange, label, onComplete }: {
  value: string; onChange: (v: string) => void; label: string; onComplete?: () => void;
}) {
  return (
    <InputOTP maxLength={6} value={value} onChange={(v) => onChange(v.replace(/\D/g, ""))} onComplete={onComplete}
      inputMode="numeric" pattern="^[0-9]*$" autoComplete="one-time-code" aria-label={label}
      containerClassName="justify-center">
      <InputOTPGroup className="gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <InputOTPSlot key={i} index={i}
            className="h-12 w-11 rounded-xl border border-input bg-white font-mono text-xl font-semibold text-foreground first:rounded-xl last:rounded-xl" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
