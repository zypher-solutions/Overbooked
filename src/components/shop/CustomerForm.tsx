"use client";

import { useState } from "react";
import { DateInput } from "@/components/shop/DateInput";
import type { NewCustomer } from "./CustomerPicker";
import { ID_TYPES } from "./CustomerPicker";
import { Field, inputClass } from "./ui";
import { emailError, normalizeEmail, normalizePhone, personNameError, phoneError } from "@/lib/validate";

export type CustomerDraft = NewCustomer & { notes: string };

export function customerPayload(d: CustomerDraft) {
  const clean = (v: string) => v.trim() || null;
  return {
    full_name: d.full_name.trim().replace(/\s+/g, " "), phone: normalizePhone(d.phone), email: d.email.trim() ? normalizeEmail(d.email) : null, address: clean(d.address),
    id_type: clean(d.id_type), id_number: clean(d.id_number), licence_number: clean(d.licence_number),
    licence_expiry: clean(d.licence_expiry), notes: clean(d.notes),
  };
}

export function CustomerForm({ value, onChange }: { value: CustomerDraft; onChange: (v: CustomerDraft) => void }) {
  const set = (patch: Partial<CustomerDraft>) => onChange({ ...value, ...patch });
  // a message shows under a field once the person has left it
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const see = (k: string) => setSeen((s) => ({ ...s, [k]: true }));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" error={seen.name ? personNameError(value.full_name, "customer's name") ?? undefined : undefined}>
        <input className={inputClass} maxLength={60} value={value.full_name} onBlur={() => see("name")} onChange={(e) => set({ full_name: e.target.value })} />
      </Field>
      <Field label="Phone" hint="10-digit mobile number" error={seen.phone ? phoneError(value.phone, true) ?? undefined : undefined}>
        <input className={inputClass} inputMode="tel" maxLength={16} value={value.phone} onBlur={() => see("phone")} onChange={(e) => set({ phone: e.target.value })} />
      </Field>
      <Field label="Email" error={seen.email ? emailError(value.email, false) ?? undefined : undefined}>
        <input className={inputClass} inputMode="email" autoCapitalize="none" maxLength={254} value={value.email} onBlur={() => see("email")} onChange={(e) => set({ email: e.target.value })} />
      </Field>
      <Field label="Address"><input className={inputClass} value={value.address} onChange={(e) => set({ address: e.target.value })} /></Field>
      <Field label="ID type">
        <select className={inputClass} value={value.id_type} onChange={(e) => set({ id_type: e.target.value })}>
          <option value="">—</option>
          {Object.entries(ID_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="ID number"><input className={inputClass} value={value.id_number} onChange={(e) => set({ id_number: e.target.value })} /></Field>
      <Field label="Driving licence number"><input className={inputClass} value={value.licence_number} onChange={(e) => set({ licence_number: e.target.value })} /></Field>
      <Field label="Licence valid until"><DateInput value={value.licence_expiry} onChange={(v) => set({ licence_expiry: v })} /></Field>
      <Field label="Notes" className="sm:col-span-2"><textarea className={inputClass} rows={2} value={value.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
    </div>
  );
}

// what is wrong with a customer before it is saved (name, a 10-digit mobile number, a real email when one is given); null when fine
export function customerProblem(d: { full_name: string; phone: string; email: string }): string | null {
  return personNameError(d.full_name, "customer's name") ?? phoneError(d.phone, true) ?? emailError(d.email, false);
}
