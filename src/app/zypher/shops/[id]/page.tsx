"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, LogIn, Pause, Play, UserPlus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { cn } from "@/lib/utils";
import { Field, StatusBadge, SummaryCard, goldButtonClass, ghostButtonClass, inputClass, monoInputClass } from "@/components/overbooked/primitives";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BillingBadge, FEATURE_LABELS, InviteOwnerDialog, METHOD_LABELS, PLANS, PageHeader, Panel, PaymentDialog,
  ShareLinkDialog, fmtDay, fmtWhen, rupees, tableWrap, theadClass, type Plan, type Template,
} from "@/components/zypher/kit";

interface Detail {
  shop: {
    id: string; name: string; slug: string; token_prefix: string; business_types: string[]; plan: Plan;
    status: "active" | "suspended"; monthly_fee: number; paid_until: string | null; phone: string | null;
    email: string | null; address: string | null; notes: string | null; settings: Record<string, any>; created_at: string;
  };
  branches: { id: string; name: string; is_active: boolean; phone: string | null; address: string | null; units: number }[];
  people: { id: string; full_name: string; role: string; branch: string | null; is_active: boolean; email: string; last_sign_in_at: string | null }[];
  invites: { email: string; role: string; branch: string | null; created_at: string }[];
  usage: { products: number; units: number; customers: number; rentals: number; rentals_30d: number; open_rentals: number; last_rental_at: string | null };
  payments: { id: string; receipt_no: string; kind: string; amount: number; paid_on: string; period_to: string | null; method: string; note: string | null }[];
  features: Record<string, boolean>;
}

export default function ShopDetail() {
  const { id } = useParams<{ id: string }>();
  const { shop: openShop, switchShop } = useAuth();
  const [d, setD] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [edit, setEdit] = useState({ name: "", plan: "starter" as Plan, monthlyFee: "", phone: "", email: "", address: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [share, setShare] = useState<{ name: string; link: string } | null>(null);
  const [confirmPause, setConfirmPause] = useState(false);
  const [addType, setAddType] = useState<Template | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [res, t] = await Promise.all([
      supabase.rpc("shop_detail", { p_shop_id: id }),
      supabase.from("business_templates").select("*").order("sort"),
    ]);
    if (res.error) {
      if (/not found|invalid input/i.test(res.error.message)) setMissing(true);
      else toast.error("Could not load the shop: " + res.error.message);
      return;
    }
    const detail = res.data as Detail;
    setD(detail);
    setTemplates((t.data as Template[]) ?? []);
    const s = detail.shop;
    setEdit({ name: s.name, plan: s.plan, monthlyFee: String(s.monthly_fee ?? 0), phone: s.phone ?? "", email: s.email ?? "",
              address: s.address ?? "", notes: s.notes ?? "" });
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const update = async (p: Record<string, unknown>, success: string) => {
    setBusy(true);
    const { error } = await createClient().rpc("update_shop", { p_shop_id: id, p });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(success);
    await load();
    return true;
  };

  if (missing) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">This shop does not exist.</p>
        <Link href="/zypher/shops" className={cn(ghostButtonClass, "mt-3")}>Back to shops</Link>
      </Panel>
    );
  }
  if (!d) return <p className="py-10 text-center text-muted-foreground">Loading shop...</p>;

  const s = d.shop;
  const dirty = edit.name !== s.name || edit.plan !== s.plan || Number(edit.monthlyFee) !== Number(s.monthly_fee)
    || edit.phone !== (s.phone ?? "") || edit.email !== (s.email ?? "") || edit.address !== (s.address ?? "") || edit.notes !== (s.notes ?? "");
  const typeName = (k: string) => templates.find((t) => t.key === k)?.name ?? k;
  const otherTypes = templates.filter((t) => !s.business_types.includes(t.key));
  const isOpen = openShop?.id === s.id;

  const saveDetails = () => {
    if (!edit.name.trim()) return toast.error("The shop needs a name.");
    if (!(Number(edit.monthlyFee) >= 0)) return toast.error("The monthly fee cannot be negative.");
    void update({ name: edit.name, plan: edit.plan, monthly_fee: Number(edit.monthlyFee), phone: edit.phone, email: edit.email,
                  address: edit.address, notes: edit.notes }, "Shop saved");
  };

  // the whole features object is sent: settings are merged one level deep
  const setFeature = (key: string, on: boolean) =>
    void update({ settings: { features: { ...d.features, [key]: on } } }, `${FEATURE_LABELS[key] ?? key} switched ${on ? "on" : "off"}`);

  return (
    <>
      <Link href="/zypher/shops" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> Shops
      </Link>
      <PageHeader
        title={s.name}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">{s.slug} · {s.token_prefix}</span>
          <BillingBadge shop={s} />
          {s.business_types.map((t) => <StatusBadge key={t} tone="indigo">{typeName(t)}</StatusBadge>)}
          <span className="text-xs">Client since {fmtDay(s.created_at)}</span>
        </span>}
        actions={<>
          <button className={goldButtonClass} disabled={isOpen} onClick={() => switchShop(s.id)}>
            <LogIn className="h-4 w-4" /> {isOpen ? "Open now" : "Open shop"}
          </button>
          <button className={ghostButtonClass} onClick={() => setPayOpen(true)}><Wallet className="h-4 w-4" /> Record payment</button>
          <button className={ghostButtonClass} onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4" /> Invite owner</button>
          <button className={ghostButtonClass} disabled={busy} onClick={() => s.status === "active" ? setConfirmPause(true) : void update({ status: "active" }, `${s.name} resumed`)}>
            {s.status === "active" ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> Resume</>}
          </button>
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Paid until" value={s.paid_until ? fmtDay(s.paid_until) : "Never"} tone={s.paid_until ? "default" : "rust"} />
        <SummaryCard label="Rentals, 30 days" value={d.usage.rentals_30d} hint={`${d.usage.rentals} in total · ${d.usage.open_rentals} open`} />
        <SummaryCard label="Units" value={d.usage.units} hint={`${d.usage.products} products · ${d.usage.customers} customers`} />
        <SummaryCard label="Last booking" value={d.usage.last_rental_at ? fmtDay(d.usage.last_rental_at) : "None"} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Plan and details" actions={
          <button className={goldButtonClass} disabled={!dirty || busy} onClick={saveDetails}>{busy ? "Saving..." : "Save"}</button>
        }>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Shop name" className="sm:col-span-2"><input className={inputClass} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Plan" hint={PLANS.find((p) => p.key === edit.plan)?.limits}>
              <select className={inputClass} value={edit.plan} onChange={(e) => setEdit({ ...edit, plan: e.target.value as Plan })}>
                {PLANS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Monthly fee (₹)">
              <input className={monoInputClass} inputMode="decimal" value={edit.monthlyFee} onChange={(e) => setEdit({ ...edit, monthlyFee: e.target.value })} />
            </Field>
            <Field label="Phone"><input className={inputClass} value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Email"><input className={inputClass} value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2"><input className={inputClass} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Field label="Zypher notes (the shop never sees these)" className="sm:col-span-2">
              <textarea className={inputClass} rows={3} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </Field>
          </div>
        </Panel>

        <Panel title="Business types and features">
          <div className="flex flex-wrap gap-2">
            {s.business_types.map((t) => <StatusBadge key={t} tone="indigo">{typeName(t)}</StatusBadge>)}
            {otherTypes.length ? (
              <select className={cn(inputClass, "w-auto py-1 text-xs")} value="" aria-label="Add a business type"
                onChange={(e) => setAddType(otherTypes.find((t) => t.key === e.target.value) ?? null)}>
                <option value="">+ Add a business type</option>
                {otherTypes.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
              </select>
            ) : null}
          </div>
          <ul className="mt-4 divide-y divide-border">
            {Object.keys(d.features).sort().map((key) => (
              <li key={key} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-sm text-foreground">{FEATURE_LABELS[key] ?? key}</span>
                <Switch checked={d.features[key]} disabled={busy} aria-label={FEATURE_LABELS[key] ?? key}
                  onCheckedChange={(on) => setFeature(key, on)} />
              </li>
            ))}
            {Object.keys(d.features).length === 0 ? <li className="py-2 text-sm text-muted-foreground">No optional features for these types.</li> : null}
          </ul>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title={`Branches (${d.branches.filter((b) => b.is_active).length} active)`}>
          <ul className="divide-y divide-border">
            {d.branches.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <div>
                  <span className="font-medium text-foreground">{b.name}</span>
                  <span className="block text-xs text-muted-foreground">{[b.address, b.phone].filter(Boolean).join(" · ") || "No contact details"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{b.units} units</span>
                  {b.is_active ? null : <StatusBadge>Closed</StatusBadge>}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Branches are added by the owner, or by you after opening the shop.</p>
        </Panel>

        <Panel title="People">
          <ul className="divide-y divide-border">
            {d.people.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{p.full_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.email} · last sign-in {fmtWhen(p.last_sign_in_at)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusBadge tone={p.role === "owner" ? "gold" : "muted"}>{p.role}{p.branch ? ` · ${p.branch}` : ""}</StatusBadge>
                  {p.is_active ? null : <StatusBadge tone="rust">Inactive</StatusBadge>}
                </div>
              </li>
            ))}
            {d.people.length === 0 ? <li className="py-2 text-sm text-muted-foreground">Nobody yet. Invite the owner.</li> : null}
            {d.invites.map((i) => (
              <li key={i.email} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="text-muted-foreground">{i.email}</span>
                <StatusBadge tone="indigo">Invited {i.role} · {fmtDay(i.created_at)}</StatusBadge>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-4">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Payments to Zypher</h2>
        <div className={tableWrap}>
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className={theadClass}>
              <tr><th className="px-4 py-3">Received</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">For</th><th className="px-4 py-3">Receipt</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5">{fmtDay(p.paid_on)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{rupees(p.amount)}</td>
                  <td className="px-4 py-2.5">{METHOD_LABELS[p.method] ?? p.method}</td>
                  <td className="px-4 py-2.5">{p.kind === "subscription" ? `Subscription to ${fmtDay(p.period_to)}` : p.kind === "installation" ? "Installation" : "Other"}{p.note ? <span className="block text-xs text-muted-foreground">{p.note}</span> : null}</td>
                  <td className="px-4 py-2.5"><a href={`/print/zypher-receipt/${p.id}`} className="font-mono text-xs text-gold hover:underline">{p.receipt_no}</a></td>
                </tr>
              ))}
              {d.payments.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No payments yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <PaymentDialog shop={payOpen ? { id: s.id, name: s.name, monthly_fee: Number(s.monthly_fee), paid_until: s.paid_until } : null}
        onClose={() => setPayOpen(false)} onSaved={load} />
      <InviteOwnerDialog shop={inviteOpen ? { id: s.id, name: s.name } : null} onClose={() => setInviteOpen(false)} onLink={setShare} />
      <ShareLinkDialog share={share} onClose={() => setShare(null)} />

      <AlertDialog open={confirmPause} onOpenChange={setConfirmPause}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause {s.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone in the shop is signed out and cannot sign in until you resume it. Their data stays as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => {
              e.preventDefault();
              void update({ status: "suspended" }, `${s.name} paused`).then(() => setConfirmPause(false));
            }}>Pause shop</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={addType !== null} onOpenChange={(o) => { if (!o) setAddType(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add {addType?.name} to {s.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The shop gets a {addType?.name} category and its optional features. Default extras are not added to existing shops.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => {
              e.preventDefault();
              if (!addType) return;
              void update({ business_types: [...s.business_types, addType.key] }, `${addType.name} added`).then(() => setAddType(null));
            }}>Add</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
