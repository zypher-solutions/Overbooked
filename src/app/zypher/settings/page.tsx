"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Field, goldButtonClass, ghostButtonClass, inputClass, monoInputClass } from "@/components/overbooked/primitives";
import { PageHeader, Panel } from "@/components/zypher/kit";

interface Settings {
  company_name: string; address: string | null; gstin: string | null; phone: string | null; email: string | null;
  bank_details: string | null; auto_pause_after_days: number | null;
}

// Zypher's details on receipts, where shops pay, and the automatic pause rule.
export default function ZypherSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [pause, setPause] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void createClient().from("platform_settings").select("*").maybeSingle().then(({ data }) => {
      const row = data as Settings | null;
      setS(row);
      setPause(row?.auto_pause_after_days == null ? "" : String(row.auto_pause_after_days));
    });
  }, []);

  if (!s) return <p className="text-sm text-muted-foreground">Loading...</p>;
  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch });

  const save = async () => {
    if (!s.company_name.trim()) return toast.error("Enter the company name.");
    if (pause !== "" && !(Number.isInteger(Number(pause)) && Number(pause) >= 0)) return toast.error("Days must be a whole number.");
    setBusy(true);
    const { error } = await createClient().from("platform_settings").update({
      company_name: s.company_name.trim(), address: s.address?.trim() || null, gstin: s.gstin?.trim().toUpperCase() || null,
      phone: s.phone?.trim() || null, email: s.email?.trim() || null, bank_details: s.bank_details?.trim() || null,
      auto_pause_after_days: pause === "" ? null : Number(pause), updated_at: new Date().toISOString(),
    }).eq("id", 1);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  };

  const runPause = async () => {
    const { data, error } = await createClient().rpc("pause_overdue_shops");
    if (error) return toast.error(error.message);
    toast.success(data ? `${data} shop(s) paused` : "No shop is past the limit");
  };

  return (
    <>
      <PageHeader title="Settings" actions={<button className={goldButtonClass} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Zypher's details (on receipts)">
          <div className="grid gap-3">
            <Field label="Company name"><input className={inputClass} value={s.company_name} onChange={(e) => set({ company_name: e.target.value })} /></Field>
            <Field label="Address"><textarea className={inputClass} rows={3} value={s.address ?? ""} onChange={(e) => set({ address: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone"><input className={inputClass} value={s.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} /></Field>
              <Field label="Email"><input className={inputClass} value={s.email ?? ""} onChange={(e) => set({ email: e.target.value })} /></Field>
            </div>
            <Field label="GSTIN (optional)"><input className={monoInputClass} value={s.gstin ?? ""} onChange={(e) => set({ gstin: e.target.value })} /></Field>
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel title="Where shops pay">
            <Field label="Bank and UPI details" hint="Shown to shop owners in their settings and in WhatsApp reminders">
              <textarea className={inputClass} rows={4} placeholder={"Account: ...\nIFSC: ...\nUPI: ..."} value={s.bank_details ?? ""} onChange={(e) => set({ bank_details: e.target.value })} />
            </Field>
          </Panel>
          <Panel title="Automatic pause">
            <Field label="Pause a shop this many days after its paid-until date" hint="Empty = never pause automatically. Checked every night at 1 am; owners see a reminder from 7 days before.">
              <input className={monoInputClass} inputMode="numeric" value={pause} onChange={(e) => setPause(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <button className={ghostButtonClass + " mt-3"} onClick={runPause}>Check now</button>
          </Panel>
        </div>
      </div>
    </>
  );
}
