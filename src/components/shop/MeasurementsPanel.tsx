"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { errorText, fmtDate } from "@/lib/shop/format";
import type { Measurement } from "@/lib/shop/types";
import { Field, Modal, Panel, ghostButtonClass, goldButtonClass, inputClass } from "./ui";

// A customer's measurements (optional feature), with the fields bridal or groom wear asks for.
export function MeasurementsPanel({ customerId, compact = false }: { customerId: string; compact?: boolean }) {
  const { shop, templates, feature } = useShop();
  const [items, setItems] = useState<Measurement[] | null>(null);
  const [edit, setEdit] = useState<Partial<Measurement> | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = useMemo(() => Array.from(new Set(templates.flatMap((t) => t.measurement_fields ?? []))), [templates]);

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("customer_measurements").select("*").eq("customer_id", customerId).order("taken_at", { ascending: false });
    if (error) toast.error(errorText(error));
    setItems((data as Measurement[]) ?? []);
  }, [customerId]);
  useEffect(() => { if (feature("measurements")) void load(); }, [load, feature]);

  if (!feature("measurements")) return null;

  const save = async () => {
    if (!edit) return;
    const values = Object.fromEntries(Object.entries(edit.measurements ?? {}).filter(([, v]) => String(v).trim() !== ""));
    if (Object.keys(values).length === 0 && !edit.notes?.trim()) return toast.error("Enter at least one measurement.");
    setBusy(true);
    const row = { label: edit.label?.trim() || "Default", measurements: values, notes: edit.notes?.trim() || null };
    const supabase = createClient();
    const { error } = edit.id
      ? await supabase.from("customer_measurements").update(row).eq("id", edit.id)
      : await supabase.from("customer_measurements").insert({ ...row, shop_id: shop.id, customer_id: customerId });
    setBusy(false);
    if (error) return toast.error(errorText(error));
    toast.success("Measurements saved");
    setEdit(null);
    await load();
  };

  const shown = compact ? (items ?? []).slice(0, 1) : items ?? [];
  return (
    <Panel title="Measurements" actions={<button className={ghostButtonClass} onClick={() => setEdit({ label: "Default", measurements: {} })}><Plus className="h-4 w-4" /> Add</button>}>
      {items === null ? <p className="text-sm text-muted-foreground">Loading...</p> : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">None taken yet.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((m) => (
            <li key={m.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="font-medium">{m.label} <span className="text-xs font-normal text-muted-foreground">· {fmtDate(m.taken_at)}</span></span>
                <button className="text-xs text-gold hover:underline" onClick={() => setEdit(m)}>Edit</button>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
                {Object.entries(m.measurements).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-mono">{v}</dd></div>
                ))}
              </dl>
              {m.notes ? <p className="mt-1.5 text-xs text-muted-foreground">{m.notes}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? "Edit measurements" : "New measurements"} wide
        description="In inches, or as your tailor writes them."
        footer={<><button className={ghostButtonClass} onClick={() => setEdit(null)}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button></>}>
        {edit ? <>
          <Field label="Label" hint="e.g. Wedding outfit, Reception"><input className={inputClass} value={edit.label ?? ""} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from(new Set([...fields, ...Object.keys(edit.measurements ?? {})])).map((f) => (
              <Field key={f} label={f}>
                <input className={inputClass} value={edit.measurements?.[f] ?? ""}
                  onChange={(e) => setEdit({ ...edit, measurements: { ...(edit.measurements ?? {}), [f]: e.target.value } })} />
              </Field>
            ))}
          </div>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </> : null}
      </Modal>
    </Panel>
  );
}
