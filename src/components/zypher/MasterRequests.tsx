"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { confirmMasterReset } from "@/app/actions/zypher";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { Phone, ShieldAlert } from "lucide-react";
import { goldButtonClass } from "@/components/overbooked/primitives";
import { fmtWhen } from "./kit";

type Req = {
  id: string; shop_id: string; shop: string; shop_phone: string | null; owner: string; owner_email: string;
  requested_at: string; confirmed_at: string | null; ready_at: string | null;
};

// Owners who lost both the master password and its recovery codes (migration 051). Zypher phones the shop's number,
// confirms it is the owner, then presses Confirm: a 24-hour wait starts and the owner gets an alert email.
// Shown only while a request is open.
export function MasterRequests() {
  const [rows, setRows] = useState<Req[]>([]);
  const [asking, setAsking] = useState<Req | null>(null);
  const load = useCallback(async () => {
    const { data } = await createClient().rpc("zypher_master_requests");
    setRows((data ?? []) as Req[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const confirm = async () => {
    const r = asking;
    setAsking(null);
    if (!r) return;
    try {
      const { emailed, error } = await confirmMasterReset(r.id);
      if (emailed) toast.success(`Confirmed. ${r.owner} was emailed; it unlocks in 24 hours.`);
      else toast.warning(`Confirmed, but the alert email failed (${error}). Tell ${r.owner} by phone that it unlocks in 24 hours.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not confirm.");
    }
  };

  if (!rows.length) return null;
  const waiting = rows.filter((r) => !r.confirmed_at).length;
  return (
    <section id="resets" role={waiting ? "alert" : undefined}
      className={"rounded-2xl border-2 p-4 shadow-sm " + (waiting ? "border-rust bg-rust/10" : "border-border bg-white")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ShieldAlert className={"h-5 w-5 " + (waiting ? "text-rust" : "text-muted-foreground")} aria-hidden="true" />
        <h2 className="text-base font-semibold text-foreground">Master password resets</h2>
        {waiting ? <span className="rounded-full bg-rust px-2.5 py-0.5 text-xs font-semibold text-white">Action needed: {waiting}</span> : null}
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white px-3 py-2.5 text-sm">
            <span>
              <Link href={`/zypher/shops/${r.shop_id}`} className="font-medium text-foreground hover:underline">{r.shop}</Link>
              <span className="block text-xs text-muted-foreground">
                {r.owner} · {r.owner_email} · asked {fmtWhen(r.requested_at)}
              </span>
              <a href={r.shop_phone ? `tel:${r.shop_phone}` : undefined} className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                <Phone className="h-3.5 w-3.5" aria-hidden="true" /> {r.shop_phone ?? "Shop phone not set"}
              </a>
            </span>
            {r.confirmed_at
              ? <span className="text-xs text-muted-foreground">Confirmed; unlocks {fmtWhen(r.ready_at)}</span>
              : <button type="button" className={goldButtonClass} onClick={() => setAsking(r)}>Confirmed by phone</button>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Call the shop&apos;s own number shown here (not one given in a message) and check you are speaking to the owner before confirming.
      </p>
      <ConfirmDialog open={asking !== null} confirmLabel="Confirm"
        message={`You phoned ${asking?.shop ?? ""} and spoke to ${asking?.owner ?? "the owner"}, who asked for this reset? It unlocks in 24 hours and they are emailed.`}
        onConfirm={() => void confirm()} onCancel={() => setAsking(null)} />
    </section>
  );
}
