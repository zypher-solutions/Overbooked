"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { confirmMasterReset } from "@/app/actions/zypher";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { ghostButtonClass } from "@/components/overbooked/primitives";
import { Panel, fmtWhen } from "./kit";

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
  return (
    <Panel title="Master password resets to check">
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
            <span>
              <Link href={`/zypher/shops/${r.shop_id}`} className="font-medium text-foreground hover:underline">{r.shop}</Link>
              <span className="block text-xs text-muted-foreground">
                {r.owner} · {r.owner_email} · shop phone {r.shop_phone ?? "not set"} · asked {fmtWhen(r.requested_at)}
              </span>
            </span>
            {r.confirmed_at
              ? <span className="text-xs text-muted-foreground">Confirmed; unlocks {fmtWhen(r.ready_at)}</span>
              : <button type="button" className={ghostButtonClass} onClick={() => setAsking(r)}>Confirmed by phone</button>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Call the shop&apos;s own number (not one given in a message) and check you are speaking to the owner before confirming.
      </p>
      <ConfirmDialog open={asking !== null} confirmLabel="Confirm"
        message={`You phoned ${asking?.shop ?? ""} and spoke to ${asking?.owner ?? "the owner"}, who asked for this reset? It unlocks in 24 hours and they are emailed.`}
        onConfirm={() => void confirm()} onCancel={() => setAsking(null)} />
    </Panel>
  );
}
