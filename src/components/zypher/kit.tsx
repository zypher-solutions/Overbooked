"use client";

import { useState, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { inviteShopOwner } from "@/app/actions/zypher";
import { StatusBadge, Field, inputClass } from "@/components/overbooked/primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ---- shapes returned by the console functions ----
export type Plan = "starter" | "pro" | "business";

export interface OverviewRow {
  shop_id: string;
  name: string;
  slug: string;
  token_prefix: string;
  business_types: string[];
  plan: Plan;
  status: "active" | "suspended";
  monthly_fee: number;
  paid_until: string | null;
  last_payment_on: string | null;
  last_payment_amount: number | null;
  branches: number;
  active_logins: number;
  units: number;
  rentals_30d: number;
  created_at: string;
}

export interface Template {
  key: string;
  name: string;
  kind: "wearable" | "vehicle" | "room";
  labels: Record<string, string>;
  variation_fields: { key: string; label: string; type: string; options?: string[] }[];
  unit_fields: { key: string; label: string; type: string; required?: boolean }[];
  checks: { pickup?: string[]; return?: string[] };
  rate_types: string[];
  turnaround: string;
  features: Record<string, boolean>;
  default_add_ons: { name: string; basis: string; amount: number }[];
  sort: number;
}

export const PLANS: { key: Plan; label: string; limits: string }[] = [
  { key: "starter", label: "Starter", limits: "1 branch, 3 logins" },
  { key: "pro", label: "Pro", limits: "3 branches, unlimited logins" },
  { key: "business", label: "Business", limits: "No limits" },
];

export const FEATURE_LABELS: Record<string, string> = {
  sets: "Sets (bundle of pieces)",
  measurements: "Customer measurements",
  alterations: "Alterations",
  appointments: "Appointments (fittings, trials)",
  guests: "Guest counts",
  meal_plans: "Meal plans",
  whole_property: "Whole-property booking",
  with_driver: "With driver",
};

export const RATE_LABELS: Record<string, string> = {
  hour: "Per hour", day: "Per day", night: "Per night", extra_km: "Extra km", extra_hour: "Extra hour",
  extra_person: "Extra person", driver_day: "Driver per day", late_penalty: "Late penalty",
};

export const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank transfer", upi: "UPI", cash: "Cash", cheque: "Cheque",
};

// ---- dates and money (India time) ----
export function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function addMonths(iso: string, months: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  // 31 Jan + 1 month = 28/29 Feb, not 3 Mar
  if (date.getUTCDate() !== d) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export function fmtDay(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtWhen(iso: string | null | undefined) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

// Postgres interval text ("1 day", "03:00:00", "1 day 02:00:00") in words
export function fmtInterval(value: string | null | undefined) {
  if (!value) return "none";
  const parts: string[] = [];
  const days = value.match(/(\d+) days?/);
  if (days) parts.push(`${days[1]} day${days[1] === "1" ? "" : "s"}`);
  const time = value.match(/(\d+):(\d+):(\d+)/);
  if (time) {
    const h = Number(time[1]);
    const m = Number(time[2]);
    if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
    if (m) parts.push(`${m} minutes`);
  }
  return parts.join(" ") || "none";
}

export function rupees(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

// ---- billing state of a shop ----
export type BillingState = "paused" | "overdue" | "due_soon" | "paid";

export function billingState(s: { status: string; paid_until: string | null }, today = todayIST()): BillingState {
  if (s.status === "suspended") return "paused";
  if (!s.paid_until || s.paid_until < today) return "overdue";
  if (daysBetween(today, s.paid_until) <= 7) return "due_soon";
  return "paid";
}

export function BillingBadge({ shop }: { shop: { status: string; paid_until: string | null } }) {
  const state = billingState(shop);
  if (state === "paused") return <StatusBadge tone="muted">Paused</StatusBadge>;
  if (state === "overdue") return <StatusBadge tone="rust">Overdue</StatusBadge>;
  if (state === "due_soon") return <StatusBadge tone="gold">Due soon</StatusBadge>;
  return <StatusBadge tone="emerald">Paid</StatusBadge>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={"rounded-xl border border-border bg-surface p-4 shadow-sm " + (className ?? "")}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-sm font-semibold text-foreground">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export const tableWrap = "overflow-x-auto rounded-xl border border-border bg-surface shadow-sm";
export const theadClass = "bg-muted/70 text-xs font-medium uppercase tracking-wider text-muted-foreground";

// ---- dialogs ----
export function ShareLinkDialog({ share, onClose }: { share: { name: string; link: string } | null; onClose: () => void }) {
  return (
    <AlertDialog open={share !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Invite link for {share?.name}</AlertDialogTitle>
          <AlertDialogDescription>
            Send this link to them (WhatsApp is fine). It works once and expires in one hour; they set their own password.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <textarea readOnly value={share?.link ?? ""} aria-label="Invite link" rows={3}
          className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground" />
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => {
            e.preventDefault();
            navigator.clipboard.writeText(share?.link ?? "").then(() => toast.success("Link copied"), () => toast.error("Could not copy"));
          }}>
            <Copy className="mr-1 h-4 w-4" /> Copy link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface PayTarget { id: string; name: string; monthly_fee: number; paid_until: string | null }

export function PaymentDialog({ shop, onClose, onSaved }: { shop: PayTarget | null; onClose: () => void; onSaved: () => void }) {
  const today = todayIST();
  const from = shop?.paid_until && shop.paid_until > today ? shop.paid_until : today;
  const [form, setForm] = useState({ amount: "", method: "bank_transfer", paidOn: today, periodTo: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);

  // reset the form each time it opens for a shop
  if (shop && openFor !== shop.id) {
    setOpenFor(shop.id);
    setForm({ amount: shop.monthly_fee ? String(shop.monthly_fee) : "", method: "bank_transfer", paidOn: today,
              periodTo: addMonths(from, 1), note: "" });
  }
  if (!shop && openFor !== null) setOpenFor(null);

  const save = async () => {
    if (!shop) return;
    const amount = Number(form.amount);
    if (!(amount > 0)) return toast.error("Enter the amount received.");
    if (!form.periodTo) return toast.error("Enter the date this payment covers until.");
    setBusy(true);
    const { error } = await createClient().rpc("record_shop_payment", {
      p_shop_id: shop.id, p_amount: amount, p_paid_on: form.paidOn, p_period_to: form.periodTo,
      p_method: form.method, p_note: form.note.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Payment from ${shop.name} recorded`);
    onSaved();
    onClose();
  };

  const monthsChip = (n: number) => (
    <button type="button" key={n} onClick={() => setForm({ ...form, periodTo: addMonths(from, n),
      amount: shop?.monthly_fee ? String(shop.monthly_fee * n) : form.amount })}
      className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-gold/40 hover:bg-gold/5">
      {n === 12 ? "1 year" : `${n} month${n > 1 ? "s" : ""}`}
    </button>
  );

  return (
    <AlertDialog open={shop !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Payment from {shop?.name}</AlertDialogTitle>
          <AlertDialogDescription>
            Money received by bank transfer or other means. Paid until moves to the end of the period
            {shop?.paid_until ? <> (now {fmtDay(shop.paid_until)})</> : null}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-wrap gap-1.5">{[1, 3, 6, 12].map(monthsChip)}</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)">
            <input className={inputClass} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Method">
            <select className={inputClass} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Received on">
            <input type="date" className={inputClass} value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} />
          </Field>
          <Field label="Covers until">
            <input type="date" className={inputClass} value={form.periodTo} onChange={(e) => setForm({ ...form, periodTo: e.target.value })} />
          </Field>
          <Field label="Note (reference no., installation ...)" className="col-span-2">
            <input className={inputClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void save(); }}>
            {busy ? "Saving..." : "Record payment"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function InviteOwnerDialog({ shop, onClose, onLink }: {
  shop: { id: string; name: string } | null;
  onClose: () => void;
  onLink: (share: { name: string; link: string }) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!shop) return;
    setBusy(true);
    try {
      const { link } = await inviteShopOwner({ shopId: shop.id, ownerName: name, ownerEmail: email });
      onClose();
      onLink({ name, link });
      setName("");
      setEmail("");
    } catch (e: any) {
      toast.error(e?.message || "Could not create the invite.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={shop !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Invite an owner for {shop?.name}</AlertDialogTitle>
          <AlertDialogDescription>You get a one-hour link to send them.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3">
          <Field label="Owner name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Owner email"><input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void send(); }}>
            {busy ? "Creating..." : "Create invite link"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
