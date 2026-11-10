"use client";

import { addressError, businessNameError, emailError, gstinError, normalizeEmail, normalizePhone, phoneError, textLimitError } from "@/lib/validate";
import { useState } from "react";
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

// Branch management: the shop's branches, then the shop's own settings (they were one "Shop settings" page before).
export default function BranchManagement() {
  const { shop, templates, isOwner, isSupport, setting, businessModule } = useShop();
  const hasRoom = templates.some((t) => t.kind === "room");
  const hasVehicle = templates.some((t) => t.kind === "vehicle");
  const [f, setF] = useState({
    phone: shop.phone ?? "", email: shop.email ?? "", address: shop.address ?? "", gstin: shop.gstin ?? "",
    grace_minutes: String(setting("grace_minutes", 60)),
    check_in_time: setting("check_in_time", "14:00"), check_out_time: setting("check_out_time", "11:00"),
    require_licence: setting("require_licence", true),
    gst_percent: String(setting("gst_percent", 0)),
    receipt_note: setting("receipt_note", ""),
    sac_code: setting("sac_code", ""),
  });
  const [busy, setBusy] = useState(false);

  if (!isOwner) return <Panel><p className="text-sm text-muted-foreground">Only the owner can manage branches and shop settings.</p></Panel>;

  const save = async () => {
    const grace = Number(f.grace_minutes);
    if (!Number.isInteger(grace) || grace < 0 || grace > 1440) return toast.error("Grace time is whole minutes, 0 to 1440.");
    const gst = Number(f.gst_percent || 0);
    if (!(gst >= 0 && gst <= 28)) return toast.error("GST is a percentage from 0 to 28.");
    const bad = phoneError(f.phone) ?? emailError(f.email, false) ?? addressError(f.address) ?? gstinError(f.gstin)
      ?? textLimitError(f.receipt_note, "receipt note", 200)
      ?? (f.sac_code.trim() && !/^\d{4,8}$/.test(f.sac_code.trim()) ? "The SAC code is 4 to 8 digits." : null)
      ?? (!f.check_in_time || !f.check_out_time ? "Enter the check-in and check-out times." : null);
    if (bad) return toast.error(bad);
    setBusy(true);
    try {
      await call("update_my_shop", {
        p: {
          phone: normalizePhone(f.phone), email: normalizeEmail(f.email), address: f.address.trim(), gstin: f.gstin.trim().toUpperCase(),
          settings: { grace_minutes: grace, check_in_time: f.check_in_time, check_out_time: f.check_out_time, require_licence: f.require_licence,
            gst_percent: gst, receipt_note: f.receipt_note.trim(), sac_code: f.sac_code.trim() },
        },
      });
      toast.success("Saved");
      window.location.reload(); // everyone's screens read the new rules on load
    } catch (e) {
      toast.error(errorText(e));
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Branch management" subtitle="Your branches and your shop's settings." />
      {/* branches are changed by the real owner only (migration 033); a Zypher support login sees the settings */}
      {isSupport ? null : <BranchesPanel />}
      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold text-foreground">Shop settings</h2>
        <button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save settings"}</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SubscriptionPanel />
        <Panel title="Shop details" className="lg:row-span-2">
          <div className="grid gap-3">
            <Field label="Shop name" hint="Ask Zypher to change it"><input className={inputClass} value={shop.name} readOnly /></Field>
            <Field label="Phone" hint="Shown in WhatsApp messages when a branch has no phone"><input className={inputClass} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Email"><input type="email" className={inputClass} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Address"><textarea className={inputClass} rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
            <Field label="GSTIN (optional)"><input className={monoInputClass} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} /></Field>
          </div>
        </Panel>
        {businessModule === "clothing" ? null : <Panel title="Rules">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Grace time before late charges (minutes)" hint="For hourly and nightly rentals" className="sm:col-span-2">
              <input className={monoInputClass} inputMode="numeric" value={f.grace_minutes} onChange={(e) => setF({ ...f, grace_minutes: e.target.value.replace(/\D/g, "") })} />
            </Field>
            {hasRoom ? <>
              <Field label="Usual check-in time"><input type="time" className={inputClass} value={f.check_in_time} onChange={(e) => setF({ ...f, check_in_time: e.target.value })} /></Field>
              <Field label="Usual check-out time"><input type="time" className={inputClass} value={f.check_out_time} onChange={(e) => setF({ ...f, check_out_time: e.target.value })} /></Field>
            </> : null}
            {hasVehicle ? (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={f.require_licence} onChange={(e) => setF({ ...f, require_licence: e.target.checked })} />
                A driving licence must be on record and checked before a vehicle goes out
              </label>
            ) : null}
          </div>
        </Panel>}
        <Panel title="Receipts">
          <div className="grid gap-3">
            <Field label="GST included in prices (%)" hint="With a GSTIN and a rate above 0, a rental gets a tax invoice (own number and date, CGST and SGST) once it is returned; until then, and without these, a plain receipt prints.">
              <input className={monoInputClass} inputMode="decimal" value={f.gst_percent} onChange={(e) => setF({ ...f, gst_percent: e.target.value })} />
            </Field>
            <Field label="SAC code on tax invoices (optional)" hint="The service code your accountant gives you for renting out clothes. Leave empty to print none.">
              <input className={monoInputClass} value={f.sac_code} maxLength={8} onChange={(e) => setF({ ...f, sac_code: e.target.value })} />
            </Field>
          </div>
        </Panel>
      </div>
    </>
  );
}

const EMPTY_BRANCH = { name: "", phone: "", email: "", address: "" };

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
    const bad = businessNameError(f.name, "branch name", 40) ?? phoneError(f.phone) ?? emailError(f.email, false) ?? addressError(f.address);
    if (bad) return void toast.error(bad);
    setBusy(true);
    const { error } = await createClient().rpc("setup_save_branch", {
      p_shop_id: shop.id, p_branch_id: edit.id,
      p: { name: f.name.trim().replace(/\s+/g, " "), phone: normalizePhone(f.phone), email: normalizeEmail(f.email), address: f.address.trim() },
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
                  {b.address ? <span className="block text-xs text-muted-foreground">{b.address}</span> : null}
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
                    onClick={() => setEdit({ id: b.id, form: { name: b.name, phone: b.phone ?? "", email: b.email ?? "", address: b.address ?? "" } })}
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
        closed until they are returned or cancelled. Your plan decides how many branches can be open.
      </p>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? "Edit branch" : "Add branch"}
        footer={<>
          <button type="button" className={ghostButtonClass} onClick={() => setEdit(null)}>Cancel</button>
          <button type="button" className={goldButtonClass} disabled={busy} onClick={() => void saveBranch()}>{busy ? "Saving..." : "Save"}</button>
        </>}>
        {edit ? (["name", "phone", "email", "address"] as const).map((k) => (
          <Field key={k} label={k === "name" ? "Branch name" : k.charAt(0).toUpperCase() + k.slice(1)}>
            <input className={inputClass} value={edit.form[k]} type={k === "email" ? "email" : "text"} autoFocus={k === "name"}
              onChange={(e) => setEdit({ ...edit, form: { ...edit.form, [k]: e.target.value } })} />
          </Field>
        )) : null}
      </Modal>

      <ConfirmDialog open={closing !== null} onConfirm={() => void toggleBranch()} onCancel={() => setClosing(null)}
        message={closing?.open ? `Close ${closing.name}? Its staff can no longer sign in until you reopen it.` : `Reopen ${closing?.name ?? ""}?`} />
    </Panel>
  );
}
