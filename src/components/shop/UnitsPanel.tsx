"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Plus, QrCode } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { errorText } from "@/lib/shop/format";
import { variationLabel } from "@/lib/shop/useCatalog";
import type { Product, Template, Unit, UnitStatus } from "@/lib/shop/types";
import { Empty, Field, Modal, Panel, StatusBadge, ghostButtonClass, goldButtonClass, inputClass, monoInputClass } from "./ui";

const STATUS: Record<UnitStatus | "alteration", string> = {
  available: "Available", maintenance: "In service / cleaning", alteration: "In alteration", lost: "Lost", retired: "Retired",
};

// the physical pieces, rooms or vehicles of one item, per branch
export function UnitsPanel({ product, template }: { product: Product; template: Template }) {
  const { shop, branches, activeBranches, myBranchId, role, feature } = useShop();
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [adding, setAdding] = useState<{ variation_id: string; branch_id: string; codes: string; count: string; attributes: Record<string, string> } | null>(null);
  const [statusFor, setStatusFor] = useState<{ unit: Unit; status: UnitStatus | "alteration"; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = (branchId: string) => role === "owner" || role === "super_admin" || (role === "manager" && branchId === myBranchId);
  const singles = template.kind !== "wearable"; // rooms and vehicles each have their own number

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("units").select("*").eq("product_id", product.id).order("code");
    if (error) toast.error(errorText(error));
    setUnits((data as Unit[]) ?? []);
  }, [product.id]);
  useEffect(() => { void load(); }, [load]);

  const variations = (product.product_variations ?? []).filter((v) => v.is_enabled);

  const add = async () => {
    if (!adding) return;
    const v = variations.find((x) => x.id === adding.variation_id);
    if (!v) return toast.error("Choose which one.");
    let codes: string[];
    if (singles) {
      codes = adding.codes.split(/[\n,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
      if (!codes.length) return toast.error(`Enter the ${template.labels.unit?.toLowerCase() ?? "unit"} number.`);
    } else {
      const n = Math.max(1, Math.min(200, Math.floor(Number(adding.count) || 1)));
      const used = new Set((units ?? []).map((u) => u.code));
      codes = [];
      for (let i = 1; codes.length < n; i++) if (!used.has(`${v.sku}-${i}`)) codes.push(`${v.sku}-${i}`);
    }
    setBusy(true);
    const rows = codes.map((code) => ({
      shop_id: shop.id, product_id: product.id, variation_id: v.id, branch_id: adding.branch_id, code,
      attributes: { ...Object.fromEntries(Object.entries(adding.attributes).filter(([, x]) => x)),
        ...(template.unit_fields.some((f) => f.key === "registration_no") ? { registration_no: code } : {}) },
    }));
    const { error } = await createClient().from("units").insert(rows);
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? "One of these numbers is already used." : errorText(error));
    toast.success(`${codes.length} added`);
    setAdding(null);
    await load();
  };

  const saveStatus = async () => {
    if (!statusFor) return;
    setBusy(true);
    try {
      const res = await call<{ upcoming_rentals_to_swap: string[] }>("set_unit_status",
        { p_unit_id: statusFor.unit.id, p_status: statusFor.status, p_reason: statusFor.reason || null });
      if (res.upcoming_rentals_to_swap?.length && statusFor.status !== "available") {
        toast.warning(`Booked on ${res.upcoming_rentals_to_swap.join(", ")}. Open those bookings and give another unit.`, { duration: 8000 });
      } else toast.success("Updated");
      setStatusFor(null);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: Unit) => {
    if (!confirm(`Delete ${u.code}? Only possible if it was never booked; otherwise retire it.`)) return;
    const { error } = await createClient().from("units").delete().eq("id", u.id);
    if (error) return toast.error(error.code === "23503" ? "It has bookings, so it cannot be deleted. Retire it instead." : errorText(error));
    toast.success("Deleted");
    await load();
  };

  const statusOptions: (UnitStatus | "alteration")[] = ["available", "maintenance", ...(feature("alterations") ? ["alteration" as const] : []), "lost", "retired"];

  return (
    <Panel title={template.labels.units ?? "Units"} actions={<div className="flex gap-2">
      {units?.length ? <Link href={`/print/tags?product=${product.id}`} className={ghostButtonClass}><QrCode className="h-4 w-4" /> Print tags</Link> : null}
      {activeBranches.some((b) => canEdit(b.id)) && variations.length ? (
        <button className={ghostButtonClass} onClick={() => setAdding({ variation_id: variations[0].id, branch_id: myBranchId ?? activeBranches[0].id, codes: "", count: "1", attributes: {} })}>
          <Plus className="h-4 w-4" /> Add
        </button>
      ) : null}</div>}>
      {units === null ? <p className="text-sm text-muted-foreground">Loading...</p> : units.length === 0 ? (
        <Empty>No {template.labels.units?.toLowerCase() ?? "units"} yet. Add them so they can be booked.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {units.map((u) => {
            const v = product.product_variations?.find((x) => x.id === u.variation_id);
            return (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-mono font-medium">{u.code}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {v && (product.product_variations?.length ?? 0) > 1 ? variationLabel(product, v) + " · " : ""}
                    {branches.find((b) => b.id === u.branch_id)?.name}
                    {u.odometer != null ? ` · ${u.odometer} km` : ""}
                    {Object.entries(u.attributes ?? {}).filter(([k]) => k !== "registration_no").map(([, x]) => ` · ${x}`).join("")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {u.status !== "available" ? <StatusBadge tone={u.status === "maintenance" ? "gold" : "rust"}>{u.status_reason || STATUS[u.status]}</StatusBadge> : <StatusBadge tone="emerald">Available</StatusBadge>}
                  {u.status === "available" ? (
                    <Link href={`/book?variation=${u.variation_id}`} aria-label={`Book ${u.code}`} className="rounded p-1 text-muted-foreground hover:bg-black/5"><CalendarPlus className="h-4 w-4" /></Link>
                  ) : null}
                  {canEdit(u.branch_id) ? <>
                    <button className={ghostButtonClass} onClick={() => setStatusFor({ unit: u, status: u.status === "available" ? "maintenance" : "available", reason: "" })}>Status</button>
                    <button className="text-xs text-muted-foreground hover:text-rust" onClick={() => remove(u)}>Delete</button>
                  </> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={adding !== null} onClose={() => setAdding(null)} title={`Add ${template.labels.units?.toLowerCase() ?? "units"}`}
        footer={<><button className={ghostButtonClass} onClick={() => setAdding(null)}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={add}>{busy ? "Adding..." : "Add"}</button></>}>
        {adding ? <>
          {variations.length > 1 ? (
            <Field label={template.labels.variation ?? "Which one"}>
              <select className={inputClass} value={adding.variation_id} onChange={(e) => setAdding({ ...adding, variation_id: e.target.value })}>
                {variations.map((v) => <option key={v.id} value={v.id}>{variationLabel(product, v)}</option>)}
              </select>
            </Field>
          ) : null}
          {activeBranches.length > 1 ? (
            <Field label="Branch">
              <select className={inputClass} value={adding.branch_id} disabled={!!myBranchId} onChange={(e) => setAdding({ ...adding, branch_id: e.target.value })}>
                {activeBranches.filter((b) => canEdit(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          ) : null}
          {singles ? (
            <Field label={template.unit_fields.find((f) => f.key === "registration_no")?.label ?? `${template.labels.unit ?? "Unit"} number`}
              hint="One per line to add several">
              <textarea className={monoInputClass} rows={3} value={adding.codes} onChange={(e) => setAdding({ ...adding, codes: e.target.value })} />
            </Field>
          ) : (
            <Field label="How many pieces" hint="Each gets its own code to put on its tag">
              <input className={monoInputClass} inputMode="numeric" value={adding.count} onChange={(e) => setAdding({ ...adding, count: e.target.value.replace(/\D/g, "") })} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            {template.unit_fields.filter((f) => f.key !== "registration_no").map((f) => (
              <Field key={f.key} label={f.label}>
                <input className={f.type === "number" ? monoInputClass : inputClass} value={adding.attributes[f.key] ?? ""}
                  onChange={(e) => setAdding({ ...adding, attributes: { ...adding.attributes, [f.key]: e.target.value } })} />
              </Field>
            ))}
          </div>
        </> : null}
      </Modal>

      <Modal open={statusFor !== null} onClose={() => setStatusFor(null)} title={`Status of ${statusFor?.unit.code}`}
        description="Anything other than Available cannot be booked or handed over."
        footer={<><button className={ghostButtonClass} onClick={() => setStatusFor(null)}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={saveStatus}>{busy ? "Saving..." : "Save"}</button></>}>
        {statusFor ? <>
          <div className="flex flex-wrap gap-1.5">
            {statusOptions.map((s) => (
              <button key={s} type="button" aria-pressed={statusFor.status === s} onClick={() => setStatusFor({ ...statusFor, status: s })}
                className={"rounded-full border px-3 py-1 text-xs " + (statusFor.status === s ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}>
                {STATUS[s]}
              </button>
            ))}
          </div>
          {statusFor.status !== "available" ? (
            <Field label="Reason"><input className={inputClass} value={statusFor.reason} onChange={(e) => setStatusFor({ ...statusFor, reason: e.target.value })} /></Field>
          ) : null}
        </> : null}
      </Modal>
    </Panel>
  );
}
