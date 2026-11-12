"use client";

import { addressError, businessNameError, emailError, gstinError, normalizeEmail, normalizePhone, phoneError } from "@/lib/validate";
import { useState } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { errorText } from "@/lib/shop/format";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { Switch } from "@/components/ui/switch";
import {
  Empty, Field, Modal, PageHeader, Panel, ghostButtonClass, goldButtonClass, inputClass, monoInputClass,
} from "@/components/shop/ui";
import { cn } from "@/lib/utils";
import { SubscriptionPanel } from "@/components/shop/Subscription";

// India's states and union territories, for the address of the shop and its branches
const STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
];
const pinError = (pin: string) => (pin.trim() && !/^[1-9]\d{5}$/.test(pin.trim()) ? "The PIN code is 6 digits." : null);
const cityError = (city: string) => (city.trim().length > 60 ? "The city is at most 60 characters." : null);

function StateSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not set</option>
      {/* a state saved before this list keeps showing */}
      {value && !STATES.includes(value) ? <option value={value}>{value}</option> : null}
      {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

// Branch management: the shop's branches and its basic details. Everything about how the shop works is on Settings.
export default function BranchManagement() {
  const { shop, isOwner, isSupport } = useShop();
  const [f, setF] = useState({
    name: shop.name, phone: shop.phone ?? "", email: shop.email ?? "", address: shop.address ?? "",
    city: shop.city ?? "", state: shop.state ?? "", pincode: shop.pincode ?? "", gstin: shop.gstin ?? "", logo_url: shop.logo_url ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  // the logo printed on the bill: into the shop's folder of product_images (public links, owner/manager write only)
  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const small = await imageCompression(file, { maxSizeMB: 0.3, maxWidthOrHeight: 600, useWebWorker: true });
      const ext = small.type === "image/png" ? "png" : small.type === "image/webp" ? "webp" : "jpg";
      const path = `${shop.id}/logo-${crypto.randomUUID()}.${ext}`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("product_images").upload(path, small, { contentType: small.type || "image/jpeg" });
      if (error) throw error;
      setF((x) => ({ ...x, logo_url: supabase.storage.from("product_images").getPublicUrl(path).data.publicUrl }));
      toast.success("Logo added. Save details to keep it.");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setUploading(false);
    }
  };

  if (!isOwner) return <Panel><p className="text-sm text-muted-foreground">Only the owner can manage branches and the shop&apos;s details.</p></Panel>;

  const save = async () => {
    const bad = businessNameError(f.name, "shop name", 80) ?? phoneError(f.phone) ?? emailError(f.email, false) ?? addressError(f.address)
      ?? cityError(f.city) ?? pinError(f.pincode) ?? gstinError(f.gstin);
    if (bad) return toast.error(bad);
    setBusy(true);
    try {
      await call("update_my_shop", {
        p: {
          name: f.name.trim().replace(/\s+/g, " "), phone: normalizePhone(f.phone), email: normalizeEmail(f.email), address: f.address.trim(),
          city: f.city.trim(), state: f.state, pincode: f.pincode.trim(), gstin: f.gstin.trim().toUpperCase(),
          logo_url: f.logo_url,
        },
      });
      toast.success("Saved");
      window.location.reload(); // the shop name and details show on every screen
    } catch (e) {
      toast.error(errorText(e));
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Branch management" subtitle="Your business details, shared by every branch, and each branch's own details." />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-semibold text-foreground">Business details</h2>
          <p className="text-xs text-muted-foreground">Shared by all branches. A branch&apos;s own address, phone, GSTIN or bank, set below, wins on its bills.</p>
        </div>
        <button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save details"}</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="All branches">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Logo" hint="Printed at the top left of the bill. PNG or JPG" className="sm:col-span-2">
              <div className="flex items-center gap-3">
                {f.logo_url ? <img src={f.logo_url} alt="Shop logo" className="h-16 w-20 rounded border border-border bg-white object-contain" /> : null}
                <label className={ghostButtonClass + " cursor-pointer"}>
                  {uploading ? "Uploading..." : f.logo_url ? "Change logo" : "Upload logo"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading}
                    onChange={(e) => { void uploadLogo(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {f.logo_url ? <button type="button" className={ghostButtonClass} onClick={() => setF({ ...f, logo_url: "" })}>Remove</button> : null}
              </div>
            </Field>
            <Field label="Shop name" hint="Shown on bills and messages" className="sm:col-span-2">
              <input className={inputClass} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Phone" hint="Printed on every bill after the branch's own phone; used in WhatsApp messages"><input className={inputClass} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Email"><input type="email" className={inputClass} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Head office address" hint="Printed on the bills of a branch that has no address of its own" className="sm:col-span-2"><textarea className={inputClass} rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
            <Field label="City"><input className={inputClass} value={f.city} maxLength={60} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
            <Field label="State"><StateSelect value={f.state} onChange={(state) => setF({ ...f, state })} /></Field>
            <Field label="PIN code"><input className={monoInputClass} inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label="GSTIN (optional)" hint="Turns on GST invoices. Printed on bills of branches without their own GSTIN"><input className={monoInputClass} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} /></Field>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            GST, receipts, late returns and the shop&apos;s other rules are on <Link href="/settings" className="underline">Settings</Link>.
          </p>
        </Panel>
        <SubscriptionPanel />
      </div>
      {/* branches are changed by the real owner only (migration 033); a Zypher support login sees the details */}
      {isSupport ? null : <div className="mt-6"><BranchesPanel /></div>}
    </>
  );
}

const EMPTY_BRANCH = {
  name: "", phone: "", email: "", address: "", city: "", state: "", pincode: "",
  gstin: "", bank_name: "", bank_holder: "", bank_last4: "", bank_ifsc: "",
};
type BranchForm = typeof EMPTY_BRANCH;
// a branch's own bank details (its settings, migration 042); blank = the shop's
const BANK = ["bank_name", "bank_holder", "bank_last4", "bank_ifsc"] as const;

// The shop's branches (also its stock locations). setup_save_branch checks the real owner and the plan's branch limit;
// a branch with pieces out or bookings open cannot be closed (guard trigger). The console reads the same table.
// Each card shows what the branch's bills print: its own value, or the shop's when it has none.
function BranchesPanel() {
  const { shop, branches, refresh } = useShop();
  const [edit, setEdit] = useState<{ id: string | null; form: BranchForm } | null>(null);
  const [closing, setClosing] = useState<{ id: string; name: string; open: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const ss = (shop.settings ?? {}) as Record<string, unknown>;
  const shopBank = (k: (typeof BANK)[number]) => String(ss[k] ?? "");

  const saveBranch = async () => {
    if (!edit) return;
    const f = edit.form;
    const bad = businessNameError(f.name, "branch name", 40) ?? phoneError(f.phone) ?? emailError(f.email, false) ?? addressError(f.address)
      ?? cityError(f.city) ?? pinError(f.pincode) ?? gstinError(f.gstin)
      ?? (f.bank_last4.trim() && !/^\d{4}$/.test(f.bank_last4.trim()) ? "Enter only the last 4 digits of the account." : null)
      ?? (f.bank_ifsc.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.bank_ifsc.trim().toUpperCase()) ? "The IFSC is 11 characters, like SBIN0001234." : null);
    if (bad) return void toast.error(bad);
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: id, error } = await supabase.rpc("setup_save_branch", {
        p_shop_id: shop.id, p_branch_id: edit.id,
        p: { name: f.name.trim().replace(/\s+/g, " "), phone: normalizePhone(f.phone), email: normalizeEmail(f.email), address: f.address.trim(),
             city: f.city.trim(), state: f.state, pincode: f.pincode.trim(), gstin: f.gstin.trim().toUpperCase() },
      });
      if (error) throw error;
      const set: Record<string, string> = {};
      const clear: string[] = [];
      for (const k of BANK) {
        const v = k === "bank_ifsc" ? f[k].trim().toUpperCase() : f[k].trim();
        if (v) set[k] = v; else clear.push(k);
      }
      const { error: e2 } = await supabase.rpc("update_branch_settings", { p_branch_id: (id as string) ?? edit.id, p_set: set, p_clear: clear });
      if (e2) throw e2;
      toast.success(edit.id ? "Branch saved" : "Branch added");
      setEdit(null);
      await refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleBranch = async () => {
    if (!closing) return;
    const { id, name, open } = closing;
    setClosing(null);
    setBusy(true);
    const { error } = await createClient().rpc("setup_save_branch", { p_shop_id: shop.id, p_branch_id: id, p: { is_active: !open } });
    setBusy(false);
    if (error) return void toast.error(error.message);
    toast.success(open ? `${name} closed` : `${name} reopened`);
    await refresh();
  };

  const setForm = (p: Partial<BranchForm>) => edit && setEdit({ ...edit, form: { ...edit.form, ...p } });
  const formOf = (b: (typeof branches)[number]): BranchForm => {
    const own = (b.settings ?? {}) as Record<string, unknown>;
    return {
      name: b.name, phone: b.phone ?? "", email: b.email ?? "", address: b.address ?? "", city: b.city ?? "", state: b.state ?? "",
      pincode: b.pincode ?? "", gstin: b.gstin ?? "",
      bank_name: String(own.bank_name ?? ""), bank_holder: String(own.bank_holder ?? ""),
      bank_last4: String(own.bank_last4 ?? ""), bank_ifsc: String(own.bank_ifsc ?? ""),
    };
  };
  const bankText = (s: Record<string, unknown>) => s.bank_name
    ? `${String(s.bank_name)}${s.bank_last4 ? ` · XXXX${String(s.bank_last4)}` : ""}${s.bank_ifsc ? ` · ${String(s.bank_ifsc)}` : ""}` : "";

  return (
    <Panel title="Branches"
      actions={<button type="button" className={ghostButtonClass} onClick={() => setEdit({ id: null, form: EMPTY_BRANCH })}><Plus className="h-4 w-4" aria-hidden="true" /> Add branch</button>}>
      {branches.length === 0 ? <Empty>No branches yet.</Empty> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {branches.map((b) => (
            <li key={b.id} className={cn("rounded-2xl border border-border bg-surface p-4", !b.is_active && "opacity-70")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-display text-lg font-semibold text-foreground">{b.name}</p>
                <div className="flex items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium has-[:disabled]:cursor-not-allowed">
                    <Switch checked={b.is_active} disabled={busy} aria-label={(b.is_active ? "Close " : "Reopen ") + b.name}
                      onCheckedChange={() => setClosing({ id: b.id, name: b.name, open: b.is_active })} />
                    <span className={b.is_active ? "text-foreground" : "text-muted-foreground"}>{b.is_active ? "Open" : "Closed"}</span>
                  </label>
                  <button type="button" aria-label={"Edit " + b.name} onClick={() => setEdit({ id: b.id, form: formOf(b) })}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Printed on this branch&apos;s bills</p>
              <dl className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                <BranchLine label="Address" own={[b.address, b.city, b.state, b.pincode].filter(Boolean).join(", ")}
                  shop={[shop.address, shop.city, shop.state, shop.pincode].filter(Boolean).join(", ")} />
                <BranchLine label="Phone" own={b.phone} shop={shop.phone} />
                <BranchLine label="Email" own={b.email} shop={shop.email} />
                <BranchLine label="GSTIN" own={b.gstin} shop={shop.gstin} mono />
                <BranchLine label="Bank" own={bankText((b.settings ?? {}) as Record<string, unknown>)} shop={bankText(ss)} />
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        A value marked &quot;business&quot; comes from the business details above, because the branch has none of its own. A closed branch
        cannot take bookings and its staff cannot sign in; a branch with pieces out or bookings open cannot be closed. Your plan decides
        how many branches can be open. A branch&apos;s own rules (late fees, receipt note) are on <Link href="/settings" className="underline">Settings</Link>.
      </p>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? "Edit branch" : "Add branch"}
        footer={<>
          <button type="button" className={ghostButtonClass} onClick={() => setEdit(null)}>Cancel</button>
          <button type="button" className={goldButtonClass} disabled={busy} onClick={() => void saveBranch()}>{busy ? "Saving..." : "Save"}</button>
        </>}>
        {edit ? <>
          <p className="text-xs text-muted-foreground">Leave a box empty to print the business details shown in grey.</p>
          {(["name", "phone", "email", "address"] as const).map((k) => (
            <Field key={k} label={k === "name" ? "Branch name" : k.charAt(0).toUpperCase() + k.slice(1)}>
              <input className={inputClass} value={edit.form[k]} type={k === "email" ? "email" : "text"} autoFocus={k === "name"}
                placeholder={k === "name" ? "" : shop[k] ?? ""} onChange={(e) => setForm({ [k]: e.target.value })} />
            </Field>
          ))}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="City"><input className={inputClass} maxLength={60} value={edit.form.city} placeholder={shop.city ?? ""} onChange={(e) => setForm({ city: e.target.value })} /></Field>
            <Field label="State"><StateSelect value={edit.form.state} onChange={(state) => setForm({ state })} /></Field>
            <Field label="PIN code">
              <input className={monoInputClass} inputMode="numeric" maxLength={6} value={edit.form.pincode} placeholder={shop.pincode ?? ""}
                onChange={(e) => setForm({ pincode: e.target.value.replace(/\D/g, "") })} />
            </Field>
          </div>
          <p className="border-t border-border pt-3 text-sm font-semibold">GST and bank on this branch&apos;s bills</p>
          <Field label="GSTIN" hint="A branch in another state has its own GST number">
            <input className={monoInputClass} value={edit.form.gstin} placeholder={shop.gstin ?? ""} onChange={(e) => setForm({ gstin: e.target.value.toUpperCase() })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bank name">
              <input className={inputClass} maxLength={60} value={edit.form.bank_name} placeholder={shopBank("bank_name")} onChange={(e) => setForm({ bank_name: e.target.value })} />
            </Field>
            <Field label="Account holder">
              <input className={inputClass} maxLength={80} value={edit.form.bank_holder} placeholder={shopBank("bank_holder")} onChange={(e) => setForm({ bank_holder: e.target.value })} />
            </Field>
            <Field label="Last 4 digits of the account" hint="Only the last 4 are kept; prints as XXXX1234">
              <input className={monoInputClass} inputMode="numeric" maxLength={4} value={edit.form.bank_last4} placeholder={shopBank("bank_last4")}
                onChange={(e) => setForm({ bank_last4: e.target.value.replace(/\D/g, "") })} />
            </Field>
            <Field label="IFSC">
              <input className={monoInputClass} maxLength={11} value={edit.form.bank_ifsc} placeholder={shopBank("bank_ifsc")}
                onChange={(e) => setForm({ bank_ifsc: e.target.value.toUpperCase() })} />
            </Field>
          </div>
        </> : null}
      </Modal>

      <ConfirmDialog open={closing !== null} onConfirm={() => void toggleBranch()} onCancel={() => setClosing(null)}
        message={closing?.open ? `Close ${closing.name}? Its staff can no longer sign in until you reopen it.` : `Reopen ${closing?.name ?? ""}?`} />
    </Panel>
  );
}

// one detail on a branch card: the branch's own value, or the business value in grey
function BranchLine({ label, own, shop, mono }: { label: string; own?: string | null; shop?: string | null; mono?: boolean }) {
  return <>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className={cn("min-w-0 break-words", mono && "font-mono text-xs", !own && "text-muted-foreground")}>
      {own || (shop ? <>{shop} <span className="text-[11px] italic">(business)</span></> : "Not set")}
    </dd>
  </>;
}
