"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, UserCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/shop/format";
import type { Customer } from "@/lib/shop/types";
import { Field, inputClass } from "./ui";

export interface NewCustomer {
  full_name: string;
  phone: string;
  email: string;
  address: string;
  id_type: string;
  id_number: string;
  licence_number: string;
  licence_expiry: string;
}

export const emptyCustomer: NewCustomer = {
  full_name: "", phone: "", email: "", address: "", id_type: "", id_number: "", licence_number: "", licence_expiry: "",
};

export const ID_TYPES: Record<string, string> = {
  aadhaar: "Aadhaar", driving_licence: "Driving licence", passport: "Passport", voter_id: "Voter ID", pan: "PAN", other: "Other",
};

// Find a returning customer by name or phone, or fill in a new one. Vehicles need the driving licence.
export function CustomerPicker({ selected, onSelect, draft, onDraft, needsLicence }: {
  selected: Customer | null;
  onSelect: (c: Customer | null) => void;
  draft: NewCustomer;
  onDraft: (c: NewCustomer) => void;
  needsLicence: boolean;
}) {
  const [matches, setMatches] = useState<Customer[]>([]);
  const term = (draft.phone.length >= 4 ? draft.phone : draft.full_name).trim().replace(/[%_,()*]/g, "");

  useEffect(() => {
    if (selected || term.length < 3) {
      setMatches([]);
      return;
    }
    const t = setTimeout(async () => {
      const like = `%${term}%`;
      const { data } = await createClient().from("customers").select("*")
        .or(`full_name.ilike.${like},phone.ilike.${like}`).order("created_at", { ascending: false }).limit(5);
      setMatches((data as Customer[]) ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [term, selected]);

  const set = (patch: Partial<NewCustomer>) => onDraft({ ...draft, ...patch });
  const licenceExpired = (c: Pick<Customer, "licence_expiry">) => !!c.licence_expiry && c.licence_expiry < new Date().toISOString().slice(0, 10);

  if (selected) {
    return (
      <div className="rounded-lg border border-gold/40 bg-gold/5 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium text-foreground"><UserCheck className="h-4 w-4 text-gold" /> {selected.full_name}</p>
            <p className="text-xs text-muted-foreground">{selected.phone}{selected.email ? ` · ${selected.email}` : ""}</p>
            {needsLicence ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Licence: {selected.licence_number ? `${selected.licence_number}${selected.licence_expiry ? `, valid to ${fmtDate(selected.licence_expiry)}` : ""}` : "not on record"}
              </p>
            ) : null}
          </div>
          <button type="button" aria-label="Choose another customer" onClick={() => onSelect(null)} className="rounded-md p-1.5 hover:bg-black/5">
            <X className="h-4 w-4" />
          </button>
        </div>
        {selected.is_blocked ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-rust">
            <AlertTriangle className="h-3.5 w-3.5" /> Blocked: {selected.blocked_reason || "no reason given"}. The booking will be refused.
          </p>
        ) : null}
        {needsLicence && (!selected.licence_number || licenceExpired(selected)) ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <p className="text-xs text-rust sm:col-span-2">A valid driving licence is needed before the vehicle is handed over. Add it now or at pickup.</p>
            <Field label="Licence number"><input className={inputClass} value={draft.licence_number} onChange={(e) => set({ licence_number: e.target.value })} /></Field>
            <Field label="Valid until"><input type="date" className={inputClass} value={draft.licence_expiry} onChange={(e) => set({ licence_expiry: e.target.value })} /></Field>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone"><input className={inputClass} inputMode="tel" autoComplete="off" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label="Name"><input className={inputClass} autoComplete="off" value={draft.full_name} onChange={(e) => set({ full_name: e.target.value })} /></Field>
      </div>
      {matches.length ? (
        <div className="rounded-lg border border-border">
          <p className="border-b border-border px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Returning customer?</p>
          <ul>
            {matches.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onSelect(c)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gold/5">
                  <span><span className="font-medium">{c.full_name}</span> <span className="text-muted-foreground">· {c.phone}</span></span>
                  {c.is_blocked ? <span className="text-xs text-rust">Blocked</span> : <span className="text-xs text-gold">Use</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <details className="rounded-lg border border-border px-3 py-2 text-sm" open={needsLicence}>
        <summary className="cursor-pointer text-muted-foreground">ID {needsLicence ? "and driving licence" : ""}, email and address</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="ID type">
            <select className={inputClass} value={draft.id_type} onChange={(e) => set({ id_type: e.target.value })}>
              <option value="">—</option>
              {Object.entries(ID_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="ID number"><input className={inputClass} value={draft.id_number} onChange={(e) => set({ id_number: e.target.value })} /></Field>
          {needsLicence ? (
            <>
              <Field label="Driving licence number"><input className={inputClass} value={draft.licence_number} onChange={(e) => set({ licence_number: e.target.value })} /></Field>
              <Field label="Licence valid until"><input type="date" className={inputClass} value={draft.licence_expiry} onChange={(e) => set({ licence_expiry: e.target.value })} /></Field>
            </>
          ) : null}
          <Field label="Email"><input type="email" className={inputClass} value={draft.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Address"><input className={inputClass} value={draft.address} onChange={(e) => set({ address: e.target.value })} /></Field>
        </div>
      </details>
    </div>
  );
}
