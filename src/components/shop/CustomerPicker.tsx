"use client";

import { DateInput } from "@/components/shop/DateInput";
import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Plus, Search, UserCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/shop/format";
import type { Customer } from "@/lib/shop/types";
import { Field, inputClass } from "./ui";
import { emailError, normalizePhone, personNameError, phoneError } from "@/lib/validate";

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
export function CustomerPicker({ selected, onSelect, draft, onDraft, needsLicence, showOptionalDetails = false, onCreateNew }: {
  selected: Customer | null;
  onSelect: (c: Customer | null) => void;
  draft: NewCustomer;
  onDraft: (c: NewCustomer) => void;
  needsLicence: boolean;
  showOptionalDetails?: boolean;
  // when given, the picker is only a search: no fields for a new customer, and nothing found offers to create one through
  // this callback (with what was typed), so the caller can open its own popup
  onCreateNew?: (typed: string) => void;
}) {
  const [matches, setMatches] = useState<Customer[]>([]);
  // a message shows under a field once the person has left it
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const see = (k: string) => setSeen((s) => ({ ...s, [k]: true }));
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

  // a saved customer is found by name or phone in one box; with nothing typed it offers the latest ones
  const [q, setQ] = useState("");
  const [boxOpen, setBoxOpen] = useState(false);
  const [saved, setSaved] = useState<Customer[]>([]);
  useEffect(() => {
    if (selected || !boxOpen) return;
    const text = q.trim().replace(/[%_,()*]/g, "");
    const t = setTimeout(async () => {
      const base = createClient().from("customers").select("*");
      const { data } = text.length >= 2
        ? await base.or(`full_name.ilike.%${text}%,phone.ilike.%${text}%`).order("full_name").limit(8)
        : await base.order("created_at", { ascending: false }).limit(5);
      setSaved((data as Customer[]) ?? []);
    }, text.length >= 2 ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, boxOpen, selected]);

  // a number that is already saved: say so, so the same person is not added twice
  const [sameNumber, setSameNumber] = useState<Customer | null>(null);
  const digits = normalizePhone(draft.phone);
  useEffect(() => {
    if (selected || digits.length !== 10) { setSameNumber(null); return; }
    let live = true;
    void createClient().from("customers").select("*").eq("phone", digits).limit(1).maybeSingle().then(({ data }) => { if (live) setSameNumber((data as Customer) ?? null); });
    return () => { live = false; };
  }, [digits, selected]);

  const set = (patch: Partial<NewCustomer>) => onDraft({ ...draft, ...patch });
  // the optional details start folded, unless something is already filled in (a restored cart) or the email is wrong
  const [moreOpen, setMoreOpen] = useState(() => !!(draft.id_type || draft.id_number || draft.email || draft.address));
  const emailProblem = seen.email && !!emailError(draft.email, false);
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
            <Field label="Valid until"><DateInput value={draft.licence_expiry} onChange={(v) => set({ licence_expiry: v })} /></Field>
          </div>
        ) : null}
      </div>
    );
  }

  if (onCreateNew) {
    const typed = q.trim();
    const showList = boxOpen && (saved.length > 0 || typed.length > 0);
    return (
      <div className="relative">
        <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Find a customer</span>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input className={cn(inputClass, "pl-9")} autoComplete="off" aria-label="Search saved customers" placeholder="Search by name or phone"
              value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setBoxOpen(true)} onBlur={() => setTimeout(() => setBoxOpen(false), 150)} />
          </div>
          <button type="button" onClick={() => onCreateNew(typed)}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent">
            <Plus aria-hidden="true" className="size-4" /> New customer
          </button>
        </div>
        {showList ? (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
            {!typed ? <li className="border-b border-border px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Latest customers</li> : null}
            {saved.map((c) => (
              <li key={c.id}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onSelect(c); setQ(""); setBoxOpen(false); }}
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gold/5">
                  <span className="min-w-0 truncate"><span className="font-medium">{c.full_name}</span> <span className="font-mono text-xs text-muted-foreground">{c.phone}</span></span>
                  {c.is_blocked ? <span className="text-xs text-rust">Blocked</span> : <span className="text-xs text-gold">Use</span>}
                </button>
              </li>
            ))}
            {typed && !saved.length ? <li className="px-3 py-2 text-sm text-muted-foreground">No saved customer matches &quot;{typed}&quot;.</li> : null}
            {typed ? (
              <li className="border-t border-border">
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setBoxOpen(false); onCreateNew(typed); }}
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gold hover:bg-gold/5">
                  <Plus aria-hidden="true" className="size-4 shrink-0" /> Create &quot;{typed}&quot; as a new customer
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    );
  }

  const optionalDetails = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="ID type">
        <select
          className={inputClass}
          value={draft.id_type}
          onChange={(e) => set({ id_type: e.target.value })}
        >
          <option value="">—</option>
          {Object.entries(ID_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="ID number">
        <input
          className={inputClass}
          value={draft.id_number}
          onChange={(e) => set({ id_number: e.target.value })}
        />
      </Field>
      {needsLicence ? (
        <>
          <Field label="Driving licence number">
            <input
              className={inputClass}
              value={draft.licence_number}
              onChange={(e) => set({ licence_number: e.target.value })}
            />
          </Field>
          <Field label="Licence valid until">
            <DateInput
              value={draft.licence_expiry}
              onChange={(v) => set({ licence_expiry: v })}
            />
          </Field>
        </>
      ) : null}
      <Field
        label="Email"
        error={
          seen.email ? (emailError(draft.email, false) ?? undefined) : undefined
        }
      >
        <input
          className={inputClass}
          inputMode="email"
          autoCapitalize="none"
          maxLength={254}
          value={draft.email}
          onBlur={() => see("email")}
          onChange={(e) => set({ email: e.target.value })}
        />
      </Field>
      <Field label="Address">
        <input
          className={inputClass}
          value={draft.address}
          onChange={(e) => set({ address: e.target.value })}
        />
      </Field>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* checkout: the saved-customer search and the new customer's name and phone share one row on a wide screen */}
      <div className={cn("space-y-3", showOptionalDetails && "xl:grid xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,2fr)_auto] xl:items-end xl:gap-3 xl:space-y-0")}>
      <div className="relative">
        <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Saved customer</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputClass, "pl-9")} autoComplete="off" aria-label="Search saved customers" placeholder="Search by name or phone"
            value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setBoxOpen(true)} onBlur={() => setTimeout(() => setBoxOpen(false), 150)} />
        </div>
        {boxOpen && saved.length ? (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
            {!q.trim() ? <li className="border-b border-border px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Latest customers</li> : null}
            {saved.map((c) => (
              <li key={c.id}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onSelect(c); setQ(""); setBoxOpen(false); }}
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gold/5">
                  <span className="min-w-0 truncate"><span className="font-medium">{c.full_name}</span> <span className="font-mono text-xs text-muted-foreground">{c.phone}</span></span>
                  {c.is_blocked ? <span className="text-xs text-rust">Blocked</span> : <span className="text-xs text-gold">Use</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className={cn("flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground", showOptionalDetails && "xl:pb-3")}><span className={cn("h-px flex-1 bg-border", showOptionalDetails && "xl:hidden")} />or a new customer<span className={cn("h-px flex-1 bg-border", showOptionalDetails && "xl:hidden")} /></p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={showOptionalDetails ? "Name (required)" : "Name"} error={seen.name ? personNameError(draft.full_name, "customer's name") ?? undefined : undefined}>
          <input className={inputClass} autoComplete="off" required maxLength={60} value={draft.full_name} onBlur={() => see("name")} onChange={(e) => set({ full_name: e.target.value })} />
        </Field>
        <Field label={showOptionalDetails ? "Phone (required)" : "Phone"} error={seen.phone ? phoneError(draft.phone, true) ?? undefined : undefined}>
          <input className={inputClass} inputMode="tel" autoComplete="off" required maxLength={16} value={draft.phone} onBlur={() => see("phone")} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
      </div>
      {showOptionalDetails ? (
        <button type="button" aria-expanded={moreOpen || emailProblem} onClick={() => setMoreOpen((v) => !v)}
          className="inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
          More details <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", (moreOpen || emailProblem) && "rotate-180")} />
        </button>
      ) : null}
      </div>
      {sameNumber ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm">
          <span>This number is saved for <strong>{sameNumber.full_name}</strong>. Use the saved customer instead of adding a new one.</span>
          <button type="button" className="min-h-9 rounded-md bg-gold px-3 text-xs font-semibold text-white" onClick={() => onSelect(sameNumber)}>Use {sameNumber.full_name.split(" ")[0]}</button>
        </div>
      ) : null}
      {matches.length && !sameNumber ? (
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
      {showOptionalDetails ? (
        moreOpen || emailProblem ? (
          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Optional: ID, email and address</legend>
            {optionalDetails}
          </fieldset>
        ) : null
      ) : (
        <details className="rounded-lg border border-border px-3 py-2 text-sm" open={needsLicence}>
          <summary className="cursor-pointer text-muted-foreground">ID{needsLicence ? " and driving licence" : ""}, email and address</summary>
          <div className="mt-3">{optionalDetails}</div>
        </details>
      )}
    </div>
  );
}
