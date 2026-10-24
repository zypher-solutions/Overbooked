"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call, RENTAL_LIST_COLUMNS } from "@/lib/shop/api";
import { addDays, dayRange, errorText, fmtDateTime, todayLocal } from "@/lib/shop/format";
import { quickMessage, waLink, type QuickKind } from "@/lib/shop/whatsapp";
import type { ListRental } from "./RentalList";
import { Panel, StatusBadge } from "./ui";

interface Due { kind: QuickKind; rental: ListRental }

const LABEL: Record<QuickKind, string> = { pickup_reminder: "Starts tomorrow", return_reminder: "Due back today", overdue: "Overdue" };

// Who to remind today, one tap each; a reminder once sent drops off the list (overdue ones come back daily).
export function RemindersPanel() {
  const { shop, tz, branches } = useShop();
  const [due, setDue] = useState<Due[] | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const today = todayLocal(tz);
    const tomorrow = dayRange(addDays(today, 1), tz);
    const todayRange = dayRange(today, tz);
    const now = new Date().toISOString();
    const [p, r, o] = await Promise.all([
      supabase.from("rentals").select(RENTAL_LIST_COLUMNS).eq("status", "reserved").gte("start_at", tomorrow.from).lt("start_at", tomorrow.to),
      supabase.from("rentals").select(RENTAL_LIST_COLUMNS).eq("status", "active").gte("end_at", now).lt("end_at", todayRange.to),
      supabase.from("rentals").select(RENTAL_LIST_COLUMNS).eq("status", "active").lt("end_at", now),
    ]);
    const err = p.error ?? r.error ?? o.error;
    if (err) { toast.error(errorText(err)); return; }
    const list: Due[] = [
      ...((p.data as unknown as ListRental[]) ?? []).map((rental) => ({ kind: "pickup_reminder" as const, rental })),
      ...((r.data as unknown as ListRental[]) ?? []).map((rental) => ({ kind: "return_reminder" as const, rental })),
      ...((o.data as unknown as ListRental[]) ?? []).map((rental) => ({ kind: "overdue" as const, rental })),
    ];
    const ids = list.map((d) => d.rental.id);
    const { data: sent } = ids.length
      ? await supabase.from("rental_reminders").select("rental_id, kind, sent_at").in("rental_id", ids)
      : { data: [] as { rental_id: string; kind: string; sent_at: string }[] };
    const done = (d: Due) => (sent ?? []).some((s) => s.rental_id === d.rental.id && s.kind === d.kind
      && (d.kind !== "overdue" || s.sent_at >= todayRange.from));
    setDue(list.filter((d) => !done(d)));
  }, [tz]);
  useEffect(() => { void load(); }, [load]);

  const send = async (d: Due) => {
    const branch = branches.find((b) => b.id === d.rental.branch_id);
    const text = quickMessage(d.kind, d.rental, { shopName: shop.name, tz, phone: branch?.phone ?? shop.phone });
    window.open(waLink(d.rental.customers?.phone ?? "", text), "_blank", "noopener");
    try {
      await call("mark_reminder_sent", { p_rental_id: d.rental.id, p_kind: d.kind });
      setDue((x) => (x ?? []).filter((y) => y !== d));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  if (!due || due.length === 0) return null;
  return (
    <Panel title={`Reminders to send (${due.length})`} className="mb-5">
      <ul className="divide-y divide-border">
        {due.map((d) => (
          <li key={d.kind + d.rental.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <div className="min-w-0">
              <Link href={`/rentals/${d.rental.id}`} className="font-medium hover:text-gold">{d.rental.customers?.full_name}</Link>
              <span className="ml-2 font-mono text-xs text-gold">{d.rental.token}</span>
              <p className="text-xs text-muted-foreground">
                {d.kind === "pickup_reminder" ? `From ${fmtDateTime(d.rental.start_at, tz)}` : `Due ${fmtDateTime(d.rental.end_at, tz)}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge tone={d.kind === "overdue" ? "rust" : "gold"}>{LABEL[d.kind]}</StatusBadge>
              <button onClick={() => void send(d)} className="inline-flex items-center gap-1.5 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-1.5 text-xs font-medium text-emerald hover:bg-emerald/15">
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </button>
              <button aria-label="Mark as reminded without sending" title="Already reminded"
                onClick={async () => { try { await call("mark_reminder_sent", { p_rental_id: d.rental.id, p_kind: d.kind }); setDue((x) => (x ?? []).filter((y) => y !== d)); } catch (e) { toast.error(errorText(e)); } }}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-black/5"><Check className="h-4 w-4" /></button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
