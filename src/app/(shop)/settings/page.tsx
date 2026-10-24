"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { FEATURE_LABELS, errorText } from "@/lib/shop/format";
import { Field, PageHeader, Panel, StatusBadge, goldButtonClass, inputClass, monoInputClass } from "@/components/shop/ui";

export default function Settings() {
  const { shop, templates, isOwner, feature, setting } = useShop();
  const hasRoom = templates.some((t) => t.kind === "room");
  const hasVehicle = templates.some((t) => t.kind === "vehicle");
  const [f, setF] = useState({
    phone: shop.phone ?? "", email: shop.email ?? "", address: shop.address ?? "", gstin: shop.gstin ?? "",
    grace_minutes: String(setting("grace_minutes", 60)),
    check_in_time: setting("check_in_time", "14:00"), check_out_time: setting("check_out_time", "11:00"),
    require_licence: setting("require_licence", true),
  });
  const [busy, setBusy] = useState(false);
  const features = Array.from(new Set(templates.flatMap((t) => Object.keys(t.features))));

  if (!isOwner) return <Panel><p className="text-sm text-muted-foreground">Only the owner can change shop settings.</p></Panel>;

  const save = async () => {
    const grace = Number(f.grace_minutes);
    if (!Number.isInteger(grace) || grace < 0 || grace > 1440) return toast.error("Grace time is whole minutes, 0 to 1440.");
    setBusy(true);
    try {
      await call("update_my_shop", {
        p: {
          phone: f.phone.trim(), email: f.email.trim(), address: f.address.trim(), gstin: f.gstin.trim().toUpperCase(),
          settings: { grace_minutes: grace, check_in_time: f.check_in_time, check_out_time: f.check_out_time, require_licence: f.require_licence },
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
      <PageHeader title="Shop settings" actions={<button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Shop details" className="lg:row-span-2">
          <div className="grid gap-3">
            <Field label="Shop name" hint="Ask Zypher to change it"><input className={inputClass} value={shop.name} readOnly /></Field>
            <Field label="Phone" hint="Shown in WhatsApp messages when a branch has no phone"><input className={inputClass} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Email"><input type="email" className={inputClass} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Address"><textarea className={inputClass} rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
            <Field label="GSTIN (optional)"><input className={monoInputClass} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} /></Field>
          </div>
        </Panel>
        <Panel title="Rules">
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
        </Panel>
        <Panel title="Optional features">
          <ul className="space-y-1.5 text-sm">
            {features.map((k) => (
              <li key={k} className="flex items-center justify-between">
                <span>{FEATURE_LABELS[k] ?? k}</span>
                <StatusBadge tone={feature(k) ? "emerald" : "muted"}>{feature(k) ? "On" : "Off"}</StatusBadge>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">To switch a feature on or off, contact Zypher.</p>
        </Panel>
      </div>
    </>
  );
}
