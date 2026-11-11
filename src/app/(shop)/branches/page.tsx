"use client";

import { addressError, businessNameError, emailError, gstinError, normalizeEmail, normalizePhone, phoneError } from "@/lib/validate";
import { useState } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { errorText } from "@/lib/shop/format";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { Switch } from "@/components/ui/switch";
import {
  Empty, Field, Modal, PageHeader, Panel, ghostButtonClass, goldButtonClass, inputClass, monoInputClass, tableWrap, theadClass,
} from "@/components/shop/ui";
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
    city: shop.city ?? "", state: shop.state ?? "", pincode: shop.pincode ?? "", gstin: shop.gstin ?? "",
  });
  const [busy, setBusy] = useState(false);

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
      <PageHeader title="Branch management" subtitle="Your branches and your shop's details." />
      {/* branches are changed by the real owner only (migration 033); a Zypher support login sees the details */}
      {isSupport ? null : <BranchesPanel />}
      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold text-foreground">Shop details</h2>
        <button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save details"}</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Shop details">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Shop name" hint="Shown on bills and messages" className="sm:col-span-2">
              <input className={inputClass} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Phone" hint="Shown in WhatsApp messages when a branch has no phone"><input className={inputClass} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Email"><input type="email" className={inputClass} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2"><textarea className={inputClass} rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
            <Field label="City"><input className={inputClass} value={f.city} maxLength={60} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
            <Field label="State"><StateSelect value={f.state} onChange={(state) => setF({ ...f, state })} /></Field>
            <Field label="PIN code"><input className={monoInputClass} inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label="GSTIN (optional)"><input className={monoInputClass} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} /></Field>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            GST, receipts, late returns and the shop&apos;s other rules are on <Link href="/settings" className="underline">Settings</Link>.
          </p>
        </Panel>
        <SubscriptionPanel />
      </div>
    </>
  );
}

const EMPTY_BRANCH = { name: "", phone: "", email: "", address: "", city: "", state: "", pincode: "" };

// The shop's branches (also its stock locations). setup_save_branch checks the real owner and the plan's branch limit;
// a branch with pieces out or bookings open cannot be closed (guard trigger). The console reads the same table.
function BranchesPanel() {
  const { shop, branches, refresh } = useShop();
  const [edit, setEdit] = useState<{ id: string | null; form: typeof EMPTY_BRANCH } | null>(null);
  const [closing, setClosing] = useState<{ id: string; name: string; open: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const saveBranch = async () => {
    if (!edit) return;
    const f = edit.form;
    const bad = businessNameError(f.name, "branch name", 40) ?? phoneError(f.phone) ?? emailError(f.email, false) ?? addressError(f.address)
      ?? cityError(f.city) ?? pinError(f.pincode);
    if (bad) return void toast.error(bad);
    setBusy(true);
    const { error } = await createClient().rpc("setup_save_branch", {
      p_shop_id: shop.id, p_branch_id: edit.id,
      p: { name: f.name.trim().replace(/\s+/g, " "), phone: normalizePhone(f.phone), email: normalizeEmail(f.email), address: f.address.trim(),
           city: f.city.trim(), state: f.state, pincode: f.pincode.trim() },
    });
    setBusy(false);
    if (error) return void toast.error(error.message);
    toast.success(edit.id ? "Branch saved" : "Branch added");
    setEdit(null);
    await refresh();
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

  const setForm = (p: Partial<typeof EMPTY_BRANCH>) => edit && setEdit({ ...edit, form: { ...edit.form, ...p } });

  return (
    <Panel title="Branches"
      actions={<button type="button" className={ghostButtonClass} onClick={() => setEdit({ id: null, form: EMPTY_BRANCH })}><Plus className="h-4 w-4" aria-hidden="true" /> Add branch</button>}>
      <div className={tableWrap}>
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className={theadClass}>
            <tr><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Open</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {branches.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-2.5">
                  <span className="block font-medium text-foreground">{b.name}</span>
                  {b.address || b.city ? (
                    <span className="block text-xs text-muted-foreground">
                      {[b.address, b.city, b.state, b.pincode].filter(Boolean).join(", ")}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{[b.phone, b.email].filter(Boolean).join(" · ") || "Not set"}</td>
                <td className="px-4 py-2.5">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium has-[:disabled]:cursor-not-allowed">
                    <Switch checked={b.is_active} disabled={busy} aria-label={(b.is_active ? "Close " : "Reopen ") + b.name}
                      onCheckedChange={() => setClosing({ id: b.id, name: b.name, open: b.is_active })} />
                    <span className={b.is_active ? "text-foreground" : "text-muted-foreground"}>{b.is_active ? "Open" : "Closed"}</span>
                  </label>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button type="button" aria-label={"Edit " + b.name}
                    onClick={() => setEdit({ id: b.id, form: { name: b.name, phone: b.phone ?? "", email: b.email ?? "", address: b.address ?? "",
                      city: b.city ?? "", state: b.state ?? "", pincode: b.pincode ?? "" } })}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                  </button>
                </td>
              </tr>
            ))}
            {branches.length === 0 ? <tr><td colSpan={4}><Empty>No branches yet.</Empty></td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        A closed branch cannot take bookings and its staff cannot sign in. A branch with pieces out or bookings open cannot be
        closed until they are returned or cancelled. Your plan decides how many branches can be open. A branch&apos;s own
        rules (late fees, receipt note) are on <Link href="/settings" className="underline">Settings</Link>.
      </p>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? "Edit branch" : "Add branch"}
        footer={<>
          <button type="button" className={ghostButtonClass} onClick={() => setEdit(null)}>Cancel</button>
          <button type="button" className={goldButtonClass} disabled={busy} onClick={() => void saveBranch()}>{busy ? "Saving..." : "Save"}</button>
        </>}>
        {edit ? <>
          {(["name", "phone", "email", "address"] as const).map((k) => (
            <Field key={k} label={k === "name" ? "Branch name" : k.charAt(0).toUpperCase() + k.slice(1)}>
              <input className={inputClass} value={edit.form[k]} type={k === "email" ? "email" : "text"} autoFocus={k === "name"}
                onChange={(e) => setForm({ [k]: e.target.value })} />
            </Field>
          ))}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="City"><input className={inputClass} maxLength={60} value={edit.form.city} onChange={(e) => setForm({ city: e.target.value })} /></Field>
            <Field label="State"><StateSelect value={edit.form.state} onChange={(state) => setForm({ state })} /></Field>
            <Field label="PIN code">
              <input className={monoInputClass} inputMode="numeric" maxLength={6} value={edit.form.pincode} onChange={(e) => setForm({ pincode: e.target.value.replace(/\D/g, "") })} />
            </Field>
          </div>
        </> : null}
      </Modal>

      <ConfirmDialog open={closing !== null} onConfirm={() => void toggleBranch()} onCancel={() => setClosing(null)}
        message={closing?.open ? `Close ${closing.name}? Its staff can no longer sign in until you reopen it.` : `Reopen ${closing?.name ?? ""}?`} />
    </Panel>
  );
}
