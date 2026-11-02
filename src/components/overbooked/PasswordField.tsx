"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, Lock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/overbooked/primitives";

// The password rules Supabase enforces (supabase/config.toml): shown as a checklist so nobody has to guess.
export const PASSWORD_RULES: { label: string; ok: (pw: string) => boolean }[] = [
  { label: "At least 10 characters", ok: (pw) => pw.length >= 10 },
  { label: "A lowercase and an uppercase letter", ok: (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
  { label: "A number", ok: (pw) => /[0-9]/.test(pw) },
  { label: "A symbol, like ! or @", ok: (pw) => /[^A-Za-z0-9]/.test(pw) },
];
export const passwordIsStrong = (pw: string) => PASSWORD_RULES.every((r) => r.ok(pw));

// A password box with a show/hide eye, a Caps Lock warning and, for new passwords, the rules ticking off as you type.
export function PasswordField({ id, label, value, onChange, autoComplete, placeholder = "••••••••", rules = false, autoFocus, icon = true }: {
  id: string; label?: string; value: string; onChange: (v: string) => void; autoComplete: "current-password" | "new-password";
  placeholder?: string; rules?: boolean; autoFocus?: boolean; icon?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <div className="space-y-2">
      {label ? <label htmlFor={id} className="block text-sm font-medium text-muted-foreground">{label}</label> : null}
      <div className="relative">
        {icon ? <Lock className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground/50" /> : null}
        <input id={id} type={shown ? "text" : "password"} autoComplete={autoComplete} autoFocus={autoFocus} value={value}
          onChange={(e) => onChange(e.target.value)} onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))} onBlur={() => setCaps(false)}
          className={cn(inputClass, "h-12 pr-12", icon && "pl-10")} placeholder={placeholder} required spellCheck={false} autoCapitalize="none" />
        <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}
          className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground">
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {caps ? <p role="status" className="flex items-center gap-1.5 text-xs text-gold"><TriangleAlert className="h-3.5 w-3.5" /> Caps Lock is on</p> : null}
      {rules ? (
        <ul className="grid gap-0.5 text-xs" aria-label="Password rules">
          {PASSWORD_RULES.map((r) => (
            <li key={r.label} className={cn("flex items-center gap-1.5", r.ok(value) ? "text-emerald" : "text-muted-foreground")}>
              <Check className={cn("h-3 w-3", !r.ok(value) && "opacity-30")} /> {r.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
