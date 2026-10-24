"use client";

import type { NewCustomer } from "./CustomerPicker";
import { ID_TYPES } from "./CustomerPicker";
import { Field, inputClass } from "./ui";

export type CustomerDraft = NewCustomer & { notes: string };

export function customerPayload(d: CustomerDraft) {
  const clean = (v: string) => v.trim() || null;
  return {
    full_name: d.full_name.trim(), phone: d.phone.replace(/[\s-]/g, ""), email: clean(d.email), address: clean(d.address),
    id_type: clean(d.id_type), id_number: clean(d.id_number), licence_number: clean(d.licence_number),
    licence_expiry: clean(d.licence_expiry), notes: clean(d.notes),
  };
}

export function CustomerForm({ value, onChange }: { value: CustomerDraft; onChange: (v: CustomerDraft) => void }) {
  const set = (patch: Partial<CustomerDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name"><input className={inputClass} value={value.full_name} onChange={(e) => set({ full_name: e.target.value })} /></Field>
      <Field label="Phone"><input className={inputClass} inputMode="tel" value={value.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
      <Field label="Email"><input type="email" className={inputClass} value={value.email} onChange={(e) => set({ email: e.target.value })} /></Field>
      <Field label="Address"><input className={inputClass} value={value.address} onChange={(e) => set({ address: e.target.value })} /></Field>
      <Field label="ID type">
        <select className={inputClass} value={value.id_type} onChange={(e) => set({ id_type: e.target.value })}>
          <option value="">—</option>
          {Object.entries(ID_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="ID number"><input className={inputClass} value={value.id_number} onChange={(e) => set({ id_number: e.target.value })} /></Field>
      <Field label="Driving licence number"><input className={inputClass} value={value.licence_number} onChange={(e) => set({ licence_number: e.target.value })} /></Field>
      <Field label="Licence valid until"><input type="date" className={inputClass} value={value.licence_expiry} onChange={(e) => set({ licence_expiry: e.target.value })} /></Field>
      <Field label="Notes" className="sm:col-span-2"><textarea className={inputClass} rows={2} value={value.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
    </div>
  );
}
