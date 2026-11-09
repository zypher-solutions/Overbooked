"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Lock } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { errorText } from "@/lib/shop/format";
import { PageHeader, Panel, goldButtonClass } from "@/components/shop/ui";
import { skuKeys, variationSkuPart } from "../sku";

// Admin > SKU: what a system-made SKU is built from. The category's base SKU and the product number always come first
// (BR-001: they keep every product's SKU unique, and the database checks that shape, migration 013), and each piece gets
// its number last (BR-001-M-1). In between, the shop picks which attributes go in and in what order (shop_attributes.sku_position).
// Saved SKUs never change: printed tags stay right.
export default function SkuFormat() {
  const { attributes, categories, canManage, refresh } = useShop();
  const live = attributes.filter((a) => !a.is_archived);
  const [order, setOrder] = useState<{ key: string; on: boolean }[]>([]);
  const [busy, setBusy] = useState(false);

  // the saved format: attributes in the SKU in their order, then the ones left out
  const savedKey = live.map((a) => `${a.id}:${a.sku_position}`).join("|");
  useEffect(() => {
    const inSku = skuKeys(live);
    setOrder([...inSku.map((key) => ({ key, on: true })), ...live.filter((a) => !inSku.includes(a.key)).map((a) => ({ key: a.key, on: false }))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Only owners and managers can change the SKU format.</p></Panel>;

  const label = (key: string) => live.find((a) => a.key === key)?.label ?? key;
  const prefix = categories.find((c) => c.sku_prefix)?.sku_prefix ?? "BR";
  const example = Object.fromEntries(live.map((a) => [a.key, a.shop_attribute_values[0]?.value ?? a.label]));
  const draft = order.map((o, k) => ({ key: o.key, sku_position: o.on ? k + 1 : null }));
  const part = variationSkuPart(example, draft);
  const sample = `${prefix}-001${part ? "-" + part : ""}-1`;

  const move = (i: number, dir: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setOrder(next);
  };

  const save = async () => {
    setBusy(true);
    const supabase = createClient();
    const res = await Promise.all(live.map((a) => {
      const pos = draft.find((d) => d.key === a.key)?.sku_position ?? null;
      return pos === a.sku_position ? null : supabase.from("shop_attributes").update({ sku_position: pos }).eq("id", a.id);
    }).filter(Boolean));
    setBusy(false);
    const err = res.find((r) => r?.error)?.error;
    if (err) return toast.error(errorText(err));
    toast.success("Saved. New SKUs follow this format.");
    await refresh();
  };

  return (
    <>
      <PageHeader title="SKU" subtitle="How the system makes SKUs for new products. Staff can still type their own SKU on any product."
        actions={<button className={goldButtonClass} disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : "Save"}</button>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel title="Parts, in order">
          <ol className="space-y-2">
            <li className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <span><strong>Category base SKU</strong> and <strong>product number</strong> <span className="text-muted-foreground">({prefix}-001)</span></span>
              <Lock className="h-4 w-4 text-muted-foreground" aria-label="Always first" />
            </li>
            {order.map((o, i) => (
              <li key={o.key} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={o.on} onChange={(e) => setOrder(order.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} />
                  <span className={o.on ? "font-medium" : "text-muted-foreground"}>{label(o.key)}</span>
                </label>
                <span className="flex gap-1">
                  <button className="rounded-md p-1.5 text-muted-foreground hover:bg-black/5 disabled:opacity-30" aria-label={`Move ${label(o.key)} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></button>
                  <button className="rounded-md p-1.5 text-muted-foreground hover:bg-black/5 disabled:opacity-30" aria-label={`Move ${label(o.key)} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></button>
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <span><strong>Piece number</strong> <span className="text-muted-foreground">(1, 2, 3... one per physical piece)</span></span>
              <Lock className="h-4 w-4 text-muted-foreground" aria-label="Always last" />
            </li>
          </ol>
          {order.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No attributes yet. Add them on the Attributes page.</p> : null}
        </Panel>
        <Panel title="Example">
          <p className="break-all font-mono text-lg font-semibold">{sample}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {[`${prefix}-001`, ...order.filter((o) => o.on).map((o) => label(o.key)), "piece"].join(" · ")}
          </p>
          <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
            <li>Only new SKUs follow a change. Saved SKUs and printed tags stay as they are.</li>
            <li>Leave out an attribute only if your products never differ by it alone: two variations of one product cannot share a SKU, and the product form asks you to change one.</li>
            <li>An attribute typed on a single product (not in your list) is added at the end.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
