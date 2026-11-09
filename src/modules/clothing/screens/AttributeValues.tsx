"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { errorText } from "@/lib/shop/format";
import { PageHeader, Panel, ghostButtonClass, goldButtonClass, inputClass, linkClass, tableWrap, theadClass } from "@/components/shop/ui";
import { reorder } from "./Attributes";
import { tidyValue } from "../bulk";

// Admin > <attribute> (Colour, Size ...): the preferred values, offered as suggestions when adding a product.
// A value typed on a product that is not here is added by the database when the product is saved (migration 030).
// Removing a value only stops suggesting it; products that use it keep it.

export default function AttributeValues() {
  const { id } = useParams<{ id: string }>();
  const { shop, attributes, canManage, refresh, loading } = useShop();
  const attr = attributes.find((a) => a.id === id);
  const values = attr?.shop_attribute_values ?? [];
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Only owners and managers can change attributes.</p></Panel>;
  if (!attr) return <Panel><p className="text-sm text-muted-foreground">{loading ? "Loading..." : <>This attribute was not found. See <Link className={linkClass} href="/admin/attributes">Attributes</Link>.</>}</p></Panel>;

  const add = async () => {
    // several at once: "Black, White, Red"
    const have = new Set(values.map((v) => v.value.toLowerCase()));
    const fresh = Array.from(new Map(text.split(",").map((v) => tidyValue(v, attr)).filter((v) => v && !have.has(v.toLowerCase())).map((v) => [v.toLowerCase(), v])).values());
    if (!fresh.length) { setText(""); return; }
    if (fresh.some((v) => v.length > 40)) return toast.error("Keep each value to 40 letters.");
    setBusy(true);
    const start = Math.max(0, ...values.map((v) => v.sort));
    const { error } = await createClient().from("shop_attribute_values")
      .insert(fresh.map((value, k) => ({ shop_id: shop.id, attribute_id: attr.id, value, sort: start + k + 1 })));
    setBusy(false);
    if (error?.code === "23505") {
      // the list on screen was out of date: reload it so the existing value shows
      await refresh();
      return toast.error("That value is already in the list. The list has been reloaded.");
    }
    if (error) return toast.error(errorText(error));
    setText("");
    await refresh();
  };

  const rename = async () => {
    if (!editing) return;
    const value = tidyValue(editing.value, attr);
    if (!value) return toast.error("Type the value.");
    if (value.length > 40) return toast.error("Keep the value to 40 letters.");
    const { error } = await createClient().from("shop_attribute_values").update({ value }).eq("id", editing.id);
    if (error?.code === "23505") { await refresh(); return toast.error("That value is already in the list. The list has been reloaded."); }
    if (error) return toast.error(errorText(error));
    setEditing(null);
    await refresh();
  };

  const remove = async (valueId: string) => {
    const { error } = await createClient().from("shop_attribute_values").delete().eq("id", valueId);
    if (error) return toast.error(errorText(error));
    await refresh();
  };

  const move = async (i: number, dir: -1 | 1) => {
    const supabase = createClient();
    const res = await Promise.all(reorder(values, i, dir).map((u) => supabase.from("shop_attribute_values").update({ sort: u.sort }).eq("id", u.id)));
    const err = res.find((r) => r.error)?.error;
    if (err) toast.error(errorText(err));
    await refresh();
  };

  const iconButton = "rounded-md p-2 text-muted-foreground hover:bg-black/5 hover:text-foreground disabled:opacity-30";
  return (
    <>
      <Link href="/admin/attributes" className={`${ghostButtonClass} mb-3 -ml-2.5`}>
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to attributes
      </Link>
      <PageHeader title={attr.label}
        subtitle={`Your preferred ${attr.label.toLowerCase()} values, suggested when adding a product. A new value typed on a product is added here when it is saved.`} />
      {attr.is_archived ? (
        <p className="mb-3 rounded-md border border-gold/40 bg-gold/10 p-2.5 text-sm">{attr.label} is archived, so it is not offered on new products. Restore it on the <Link className={linkClass} href="/admin/attributes">Attributes</Link> page.</p>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <input className={`${inputClass} max-w-md flex-1`} aria-label={`New ${attr.label} value`} placeholder="Type a value, or several with commas, and press Enter"
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
        <button className={goldButtonClass} disabled={busy || !text.trim()} onClick={() => void add()}><Plus className="h-4 w-4" /> Add</button>
      </div>
      <div className={tableWrap}>
        <table className="w-full text-left text-sm">
          <thead className={theadClass}><tr><th className="px-6 py-3">{attr.label}</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
          <tbody className="divide-y divide-border">
            {values.map((v, i) => (
              <tr key={v.id}>
                <td className="px-6 py-2.5">
                  {editing?.id === v.id ? (
                    <input className={`${inputClass} max-w-xs`} autoFocus aria-label="Value" maxLength={40} value={editing.value}
                      onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setEditing(null); }} />
                  ) : <span className="font-medium">{v.value}</span>}
                </td>
                <td className="px-6 py-2.5">
                  <div className="flex justify-end gap-1">
                    {editing?.id === v.id ? <>
                      <button className={iconButton} aria-label="Save" title="Save" onClick={() => void rename()}><Check className="h-4 w-4" /></button>
                      <button className={iconButton} aria-label="Cancel" title="Cancel" onClick={() => setEditing(null)}><X className="h-4 w-4" /></button>
                    </> : <>
                      <button className={iconButton} aria-label={`Move ${v.value} up`} title="Move up" disabled={i === 0} onClick={() => void move(i, -1)}><ArrowUp className="h-4 w-4" /></button>
                      <button className={iconButton} aria-label={`Move ${v.value} down`} title="Move down" disabled={i === values.length - 1} onClick={() => void move(i, 1)}><ArrowDown className="h-4 w-4" /></button>
                      <button className={iconButton} aria-label={`Rename ${v.value}`} title="Rename" onClick={() => setEditing({ id: v.id, value: v.value })}><Pencil className="h-4 w-4" /></button>
                      <button className={`${iconButton} hover:text-rust`} aria-label={`Remove ${v.value}`} title="Remove" onClick={() => void remove(v.id)}><Trash2 className="h-4 w-4" /></button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
            {values.length === 0 ? <tr><td colSpan={2} className="px-6 py-8 text-center text-muted-foreground">No values yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Renaming or removing a value here only changes the suggestions. Products already saved keep their values.</p>
    </>
  );
}
