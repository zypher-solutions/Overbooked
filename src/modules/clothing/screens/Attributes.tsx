"use client";

import { useState } from "react";
import Link from "next/link";
import { ArchiveRestore, Archive, ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { errorText } from "@/lib/shop/format";
import type { ShopAttribute } from "@/lib/shop/types";
import { tidyName } from "../bulk";
import { Field, Modal, PageHeader, Panel, ghostButtonClass, goldButtonClass, inputClass, linkClass, tableWrap, theadClass } from "@/components/shop/ui";

// Admin > Attributes: the shop's own attributes (Colour, Size, Length, Material ...). Each one in use gets a page in the
// menu for its preferred values. An attribute is archived, never deleted: products keep their values (migration 030).
export const attributeKey = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

/** moves row i up or down and numbers the list 1, 2, 3...; returns only the rows whose sort changed */
export function reorder<T extends { id: string; sort: number }>(list: T[], i: number, dir: -1 | 1): { id: string; sort: number }[] {
  if (!list[i] || !list[i + dir]) return [];
  const next = [...list];
  [next[i], next[i + dir]] = [next[i + dir], next[i]];
  return next.map((x, k) => ({ id: x.id, sort: k + 1, was: x.sort })).filter((x) => x.sort !== x.was).map(({ id, sort }) => ({ id, sort }));
}

export default function Attributes() {
  const { shop, attributes, canManage, refresh } = useShop();
  const [edit, setEdit] = useState<{ id?: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const live = attributes.filter((a) => !a.is_archived);
  const archived = attributes.filter((a) => a.is_archived);

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Only owners and managers can change attributes.</p></Panel>;

  const save = async () => {
    if (!edit) return;
    const label = tidyName(edit.label); // sleeve type -> Sleeve Type
    const key = attributeKey(label);
    if (!label || !key) return toast.error("Name the attribute, e.g. Length.");
    if (label.length > 40) return toast.error("Keep the name to 40 letters.");
    const same = attributes.find((a) => a.id !== edit.id && (a.label.toLowerCase() === label.toLowerCase() || (!edit.id && a.key === key)));
    if (same) return toast.error(same.is_archived ? `${same.label} is archived. Restore it below.` : `${same.label} already exists.`);
    setBusy(true);
    const supabase = createClient();
    const next = Math.max(0, ...attributes.map((a) => a.sort)) + 1;
    const skuNext = Math.max(0, ...attributes.map((a) => a.sku_position ?? 0)) + 1;
    // a new attribute goes into the SKU too (last), so its variations get SKUs of their own; Admin > SKU can take it out
    const { error } = edit.id
      ? await supabase.from("shop_attributes").update({ label }).eq("id", edit.id)
      : await supabase.from("shop_attributes").insert({ shop_id: shop.id, key, label, sort: next, sku_position: skuNext });
    setBusy(false);
    if (error?.code === "23505") {
      // the list on screen was out of date (loaded before someone else added it): reload it so the existing one shows
      await refresh();
      return toast.error(`An attribute called ${label} (or "${key}") already exists. The list has been reloaded.`);
    }
    if (error) return toast.error(errorText(error));
    toast.success("Saved");
    setEdit(null);
    await refresh();
  };

  const setArchived = async (a: ShopAttribute, is_archived: boolean) => {
    const { error } = await createClient().from("shop_attributes").update({ is_archived }).eq("id", a.id);
    if (error) return toast.error(errorText(error));
    toast.success(is_archived ? `${a.label} archived` : `${a.label} restored`);
    await refresh();
  };

  const move = async (i: number, dir: -1 | 1) => {
    const supabase = createClient();
    const res = await Promise.all(reorder(live, i, dir).map((u) => supabase.from("shop_attributes").update({ sort: u.sort }).eq("id", u.id)));
    const err = res.find((r) => r.error)?.error;
    if (err) toast.error(errorText(err));
    await refresh();
  };

  const row = (a: ShopAttribute, i: number) => (
    <tr key={a.id} className={a.is_archived ? "opacity-60" : undefined}>
      <td className="px-6 py-3">
        {a.is_archived ? <span className="font-medium">{a.label}</span> : <Link className={linkClass} href={`/admin/attributes/${a.id}`}>{a.label}</Link>}
      </td>
      <td className="px-6 py-3 text-muted-foreground">
        {a.shop_attribute_values.length ? a.shop_attribute_values.slice(0, 6).map((v) => v.value).join(", ") + (a.shop_attribute_values.length > 6 ? ` +${a.shop_attribute_values.length - 6}` : "") : "-"}
      </td>
      <td className="px-6 py-3">{a.sku_position !== null && !a.is_archived ? <span className="rounded bg-muted px-2 py-0.5 text-xs">In SKU</span> : null}</td>
      <td className="px-6 py-3">
        <div className="flex justify-end gap-1">
          {a.is_archived ? (
            <button className="rounded-md p-2 text-muted-foreground hover:bg-black/5 hover:text-foreground" aria-label={`Restore ${a.label}`} title="Restore" onClick={() => void setArchived(a, false)}><ArchiveRestore className="h-4 w-4" /></button>
          ) : <>
            <button className="rounded-md p-2 text-muted-foreground hover:bg-black/5 hover:text-foreground disabled:opacity-30" aria-label={`Move ${a.label} up`} title="Move up" disabled={i === 0} onClick={() => void move(i, -1)}><ArrowUp className="h-4 w-4" /></button>
            <button className="rounded-md p-2 text-muted-foreground hover:bg-black/5 hover:text-foreground disabled:opacity-30" aria-label={`Move ${a.label} down`} title="Move down" disabled={i === live.length - 1} onClick={() => void move(i, 1)}><ArrowDown className="h-4 w-4" /></button>
            <button className="rounded-md p-2 text-muted-foreground hover:bg-black/5 hover:text-foreground" aria-label={`Rename ${a.label}`} title="Rename" onClick={() => setEdit({ id: a.id, label: a.label })}><Pencil className="h-4 w-4" /></button>
            <button className="rounded-md p-2 text-muted-foreground hover:bg-black/5 hover:text-rust" aria-label={`Archive ${a.label}`} title="Archive" onClick={() => void setArchived(a, true)}><Archive className="h-4 w-4" /></button>
          </>}
        </div>
      </td>
    </tr>
  );

  return (
    <>
      <PageHeader title="Attributes" subtitle="What your products differ by: colour, size, length, material... Each one gets a page for its preferred values, offered as suggestions when adding a product."
        actions={<button className={goldButtonClass} onClick={() => setEdit({ label: "" })}><Plus className="h-4 w-4" /> Add attribute</button>} />
      <div className={tableWrap}>
        <table className="w-full text-left text-sm">
          <thead className={theadClass}>
            <tr><th className="px-6 py-3">Attribute</th><th className="px-6 py-3">Values</th><th className="px-6 py-3">SKU</th><th className="px-6 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {live.map(row)}
            {live.length === 0 ? <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No attributes yet. Add the ones your products differ by.</td></tr> : null}
            {archived.map((a) => row(a, -1))}
          </tbody>
        </table>
      </div>
      {archived.length ? <p className="mt-2 text-xs text-muted-foreground">Archived attributes are not offered on new products. Products that use them keep their values.</p> : null}
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? "Rename attribute" : "New attribute"}
        description={edit?.id ? "Products keep their values; only the name shown changes." : "For example Length, Material or Sleeve type."}
        footer={<><button className={ghostButtonClass} onClick={() => setEdit(null)}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button></>}>
        {edit ? (
          <Field label="Name">
            <input className={inputClass} autoFocus maxLength={40} value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
          </Field>
        ) : null}
      </Modal>
    </>
  );
}
