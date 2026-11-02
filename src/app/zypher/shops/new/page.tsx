"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { createShopWithOwner } from "@/app/actions/zypher";
import { cn } from "@/lib/utils";
import { addressError, amountError, businessNameError, emailError, normalizeEmail, normalizePhone, personNameError, phoneError, prefixError, slugError } from "@/lib/validate";
import { Field, goldButtonClass, ghostButtonClass, inputClass, monoInputClass } from "@/components/overbooked/primitives";
import { FEATURE_LABELS, PLANS, PageHeader, Panel, fmtInterval, rupees, type Plan, type Template } from "@/components/zypher/kit";

const STEPS = ["Business type", "Shop and plan", "Branch and owner", "Review"];

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// "Kalyani Bridal Studio" -> KBS, "Kalyani" -> KAL
const prefixFrom = (name: string) => {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean);
  const p = words.length >= 2 ? words.map((w) => w[0]).join("") : (words[0] ?? "");
  return p.slice(0, words.length >= 2 ? 4 : 3);
};

const empty = {
  businessTypes: [] as string[],
  name: "", slug: "", tokenPrefix: "", plan: "starter" as Plan, monthlyFee: "",
  phone: "", email: "", address: "",
  branchName: "Main", ownerName: "", ownerEmail: "",
};

export default function NewShop() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(empty);
  const [touched, setTouched] = useState({ slug: false, prefix: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ shopId: string; link: string | null; inviteError?: string } | null>(null);

  useEffect(() => {
    void createClient().from("business_templates").select("*").order("sort").then(({ data, error }) => {
      if (error) toast.error("Could not load business types: " + error.message);
      setTemplates((data as Template[]) ?? []);
    });
  }, []);

  const set = (patch: Partial<typeof empty>) => setForm((f) => ({ ...f, ...patch }));
  const toggleType = (key: string) =>
    set({ businessTypes: form.businessTypes.includes(key) ? form.businessTypes.filter((k) => k !== key) : [...form.businessTypes, key] });

  // what is wrong with each field; shown under the field once the person has left it or pressed Next
  const errs: Record<string, string | null> = {
    name: businessNameError(form.name, "shop name"),
    slug: slugError(form.slug),
    tokenPrefix: prefixError(form.tokenPrefix),
    monthlyFee: amountError(form.monthlyFee, { max: 1_000_000 }),
    phone: phoneError(form.phone),
    email: emailError(form.email, false),
    address: addressError(form.address),
    branchName: businessNameError(form.branchName, "branch name", 40),
    ownerName: personNameError(form.ownerName, "owner's name"),
    ownerEmail: emailError(form.ownerEmail),
  };
  const STEP_FIELDS: string[][] = [[], ["name", "slug", "tokenPrefix", "monthlyFee", "phone", "email", "address"], ["branchName", "ownerName", "ownerEmail"], []];
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const err = (k: string) => (shown[k] ? errs[k] ?? undefined : undefined);
  const leave = (k: string) => setShown((s) => ({ ...s, [k]: true }));

  const next = () => {
    if (step === 0 && !form.businessTypes.length) return toast.error("Choose at least one business type.");
    const bad = STEP_FIELDS[step].filter((k) => errs[k]);
    if (bad.length) {
      setShown((s) => ({ ...s, ...Object.fromEntries(STEP_FIELDS[step].map((k) => [k, true])) }));
      return toast.error(errs[bad[0]]!);
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const create = async () => {
    setBusy(true);
    try {
      const res = await createShopWithOwner({
        ...form, name: form.name.trim().replace(/\s+/g, " "), branchName: form.branchName.trim().replace(/\s+/g, " "),
        ownerName: form.ownerName.trim().replace(/\s+/g, " "), phone: normalizePhone(form.phone), email: normalizeEmail(form.email),
        ownerEmail: normalizeEmail(form.ownerEmail), address: form.address.trim(), monthlyFee: Number(form.monthlyFee || 0),
      });
      setDone(res);
      toast.success(`${form.name} created`);
    } catch (e: any) {
      toast.error(e?.message || "Could not create the shop.");
    } finally {
      setBusy(false);
    }
  };

  const chosen = templates.filter((t) => form.businessTypes.includes(t.key));
  const features = Array.from(new Set(chosen.flatMap((t) => Object.keys(t.features))));

  if (done) {
    return (
      <>
        <PageHeader title="Shop created" subtitle={form.name} />
        <Panel>
          {done.link ? (
            <>
              <p className="text-sm text-foreground">
                Send this link to <span className="font-medium">{form.ownerName}</span>. It works once and expires in one hour;
                they set their own password and land in their shop.
              </p>
              <textarea readOnly value={done.link} rows={3} aria-label="Owner invite link"
                className="mt-3 w-full rounded-md border border-border bg-background p-2 font-mono text-xs" />
              <button className={cn(goldButtonClass, "mt-3")}
                onClick={() => navigator.clipboard.writeText(done.link!).then(() => toast.success("Link copied"), () => toast.error("Could not copy"))}>
                <Copy className="h-4 w-4" /> Copy link
              </button>
            </>
          ) : (
            <p className="text-sm text-rust">
              The shop was created, but the owner invite failed: {done.inviteError}. Use Invite owner on the shop page.
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={`/zypher/shops/${done.shopId}`} className={ghostButtonClass}>Open the shop page</Link>
            <button className={ghostButtonClass} onClick={() => { setDone(null); setForm(empty); setTouched({ slug: false, prefix: false }); setStep(0); }}>
              Create another shop
            </button>
          </div>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader title="New shop" subtitle="Set up a client: business types, plan, first branch and the owner's invite." />

      <ol className="mb-5 flex flex-wrap gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className={cn("flex items-center gap-2 rounded-full border px-3 py-1",
            i === step ? "border-gold/50 bg-gold/10 font-medium text-foreground" : i < step ? "border-emerald/40 text-emerald" : "border-border text-muted-foreground")}>
            {i < step ? <Check className="h-3.5 w-3.5" /> : <span className="font-mono">{i + 1}</span>}
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => {
            const on = form.businessTypes.includes(t.key);
            return (
              <button key={t.key} type="button" onClick={() => toggleType(t.key)} aria-pressed={on}
                className={cn("rounded-xl border bg-surface p-4 text-left shadow-sm transition-colors",
                  on ? "border-gold ring-2 ring-gold/30" : "border-border hover:border-gold/40")}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-foreground">{t.name}</span>
                  <span className={cn("flex h-5 w-5 items-center justify-center rounded border", on ? "border-gold bg-gold text-white" : "border-border")}>
                    {on ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Rents {t.labels.items?.toLowerCase() ?? "items"} · counted by {t.kind === "room" ? "night" : t.kind === "vehicle" ? "hour or day" : "day"}
                  {" · "}{t.labels.turnaround?.toLowerCase() ?? "turnaround"}: {fmtInterval(t.turnaround)}
                </p>
                {t.default_add_ons.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">Extras: {t.default_add_ons.map((a) => a.name).join(", ")}</p>
                ) : null}
              </button>
            );
          })}
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">
            A shop can run more than one type (for example a resort that also rents bikes). Each type gets its own category.
          </p>
        </div>
      )}

      {step === 1 && (
        <Panel>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shop name" error={err("name")}>
              <input className={inputClass} value={form.name} autoFocus maxLength={60} onBlur={() => leave("name")} onChange={(e) => {
                const name = e.target.value;
                set({ name, ...(touched.slug ? {} : { slug: slugify(name) }), ...(touched.prefix ? {} : { tokenPrefix: prefixFrom(name) }) });
              }} />
            </Field>
            <Field label="Web name" hint="Unique; small letters, numbers and dashes" error={err("slug")}>
              <input className={monoInputClass} value={form.slug} maxLength={40} onBlur={() => leave("slug")}
                onChange={(e) => { setTouched({ ...touched, slug: true }); set({ slug: slugify(e.target.value) }); }} />
            </Field>
            <Field label="Booking prefix" hint={`Bookings will read ${form.tokenPrefix || "ABC"}-${new Date().getFullYear()}-0001`} error={err("tokenPrefix")}>
              <input className={monoInputClass} maxLength={6} value={form.tokenPrefix} onBlur={() => leave("tokenPrefix")}
                onChange={(e) => { setTouched({ ...touched, prefix: true }); set({ tokenPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") }); }} />
            </Field>
            <Field label="Monthly fee (₹)" hint="As agreed with the client" error={err("monthlyFee")}>
              <input className={monoInputClass} inputMode="decimal" value={form.monthlyFee} onBlur={() => leave("monthlyFee")} onChange={(e) => set({ monthlyFee: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Plan</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {PLANS.map((p) => (
                  <button key={p.key} type="button" onClick={() => set({ plan: p.key })} aria-pressed={form.plan === p.key}
                    className={cn("rounded-lg border p-3 text-left", form.plan === p.key ? "border-gold ring-2 ring-gold/30" : "border-border hover:border-gold/40")}>
                    <span className="font-medium">{p.label}</span>
                    <span className="block text-xs text-muted-foreground">{p.limits}</span>
                  </button>
                ))}
              </div>
            </div>
            <Field label="Shop phone" hint="10-digit mobile number" error={err("phone")}><input className={inputClass} inputMode="tel" maxLength={16} value={form.phone} onBlur={() => leave("phone")} onChange={(e) => set({ phone: e.target.value })} /></Field>
            <Field label="Shop email" error={err("email")}><input className={inputClass} inputMode="email" autoCapitalize="none" maxLength={254} value={form.email} onBlur={() => { leave("email"); set({ email: normalizeEmail(form.email) }); }} onChange={(e) => set({ email: e.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2" error={err("address")}><input className={inputClass} maxLength={220} value={form.address} onBlur={() => leave("address")} onChange={(e) => set({ address: e.target.value })} /></Field>
          </div>
        </Panel>
      )}

      {step === 2 && (
        <Panel>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First branch" hint="More branches can be added later, within the plan" className="sm:col-span-2" error={err("branchName")}>
              <input className={inputClass} maxLength={40} value={form.branchName} onBlur={() => leave("branchName")} onChange={(e) => set({ branchName: e.target.value })} />
            </Field>
            <Field label="Owner name" error={err("ownerName")}><input className={inputClass} maxLength={60} value={form.ownerName} onBlur={() => leave("ownerName")} onChange={(e) => set({ ownerName: e.target.value })} /></Field>
            <Field label="Owner email" hint="Their login; they get an invite link from you" error={err("ownerEmail")}>
              <input className={inputClass} inputMode="email" autoCapitalize="none" maxLength={254} value={form.ownerEmail}
                onBlur={() => { leave("ownerEmail"); set({ ownerEmail: normalizeEmail(form.ownerEmail) }); }} onChange={(e) => set({ ownerEmail: e.target.value })} />
            </Field>
          </div>
        </Panel>
      )}

      {step === 3 && (
        <Panel>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="Shop">{form.name} <span className="font-mono text-xs text-muted-foreground">({form.slug})</span></Row>
            <Row label="Business types">{chosen.map((t) => t.name).join(", ")}</Row>
            <Row label="Plan">{PLANS.find((p) => p.key === form.plan)?.label} · {rupees(Number(form.monthlyFee || 0))}/month</Row>
            <Row label="Booking numbers">{form.tokenPrefix}-{new Date().getFullYear()}-0001</Row>
            <Row label="First branch">{form.branchName}</Row>
            <Row label="Owner">{form.ownerName} · {form.ownerEmail}</Row>
            <Row label="Optional features">
              {features.length ? features.map((f) => FEATURE_LABELS[f] ?? f).join(", ") : "None"}
              <span className="block text-xs text-muted-foreground">Switch them on or off on the shop page after creating it.</span>
            </Row>
            <Row label="Contact">{[form.phone, form.email, form.address].filter(Boolean).join(" · ") || "—"}</Row>
          </dl>
        </Panel>
      )}

      <div className="mt-5 flex justify-between gap-2">
        <button className={ghostButtonClass} disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        {step < STEPS.length - 1 ? (
          <button className={goldButtonClass} onClick={next}>Next <ChevronRight className="h-4 w-4" /></button>
        ) : (
          <button className={goldButtonClass} disabled={busy} onClick={create}>{busy ? "Creating..." : "Create shop and owner invite"}</button>
        )}
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  );
}
