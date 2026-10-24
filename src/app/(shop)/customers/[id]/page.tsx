"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarPlus, ChevronLeft, ShieldOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_LIST_COLUMNS } from "@/lib/shop/api";
import { errorText, rupees } from "@/lib/shop/format";
import type { Customer } from "@/lib/shop/types";
import { CustomerForm, customerPayload, type CustomerDraft } from "@/components/shop/CustomerForm";
import { RentalList, type ListRental } from "@/components/shop/RentalList";
import { MeasurementsPanel } from "@/components/shop/MeasurementsPanel";
import {
  Field, Modal, PageHeader, Panel, StatusBadge, SummaryCard, dangerButtonClass, ghostButtonClass, goldButtonClass, inputClass,
} from "@/components/shop/ui";

const toDraft = (c: Customer): CustomerDraft => ({
  full_name: c.full_name, phone: c.phone, email: c.email ?? "", address: c.address ?? "", id_type: c.id_type ?? "",
  id_number: c.id_number ?? "", licence_number: c.licence_number ?? "", licence_expiry: c.licence_expiry ?? "", notes: c.notes ?? "",
});

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { canManage } = useShop();
  const [c, setC] = useState<Customer | null | undefined>(undefined);
  const [draft, setDraft] = useState<CustomerDraft | null>(null);
  const [rentals, setRentals] = useState<ListRental[]>([]);
  const [busy, setBusy] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    const [cr, rr] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).maybeSingle(),
      supabase.from("rentals").select(RENTAL_LIST_COLUMNS).eq("customer_id", id).order("start_at", { ascending: false }).limit(200),
    ]);
    if (cr.error) toast.error(errorText(cr.error));
    setC((cr.data as Customer) ?? null);
    if (cr.data) setDraft(toDraft(cr.data as Customer));
    setRentals((rr.data as unknown as ListRental[]) ?? []);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (c === undefined) return <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p>;
  if (c === null || !draft) return <Panel><p className="text-sm text-muted-foreground">Customer not found.</p></Panel>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(c));
  const live = rentals.filter((r) => r.status !== "cancelled" && r.status !== "no_show");
  const spent = live.reduce((s, r) => s + Number(r.paid), 0);
  const due = live.reduce((s, r) => s + Math.max(0, Number(r.total) - Number(r.paid)), 0);

  const save = async (patch?: Partial<Customer>) => {
    if (!patch && (!draft.full_name.trim() || !draft.phone.trim())) return toast.error("Name and phone are needed.");
    setBusy(true);
    const { error } = await createClient().from("customers").update(patch ?? customerPayload(draft)).eq("id", c.id);
    setBusy(false);
    if (error) return toast.error(errorText(error));
    toast.success("Saved");
    setBlocking(false);
    await load();
  };

  return (
    <>
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Customers</Link>
      <PageHeader title={c.full_name}
        subtitle={<span className="inline-flex items-center gap-2">{c.phone}{c.is_blocked ? <StatusBadge tone="rust">Blocked: {c.blocked_reason || "no reason"}</StatusBadge> : null}</span>}
        actions={<>
          {c.is_blocked ? null : (
            <Link href={`/book?customer=${c.id}`} className={goldButtonClass}><CalendarPlus className="h-4 w-4" /> New booking</Link>
          )}
          {canManage ? (c.is_blocked
            ? <button className={ghostButtonClass} disabled={busy} onClick={() => save({ is_blocked: false, blocked_reason: null })}><ShieldCheck className="h-4 w-4" /> Unblock</button>
            : <button className={dangerButtonClass} onClick={() => { setReason(""); setBlocking(true); }}><ShieldOff className="h-4 w-4" /> Block</button>) : null}
        </>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <SummaryCard label="Bookings" value={live.length} />
        <SummaryCard label="Paid in total" value={rupees(spent)} tone="emerald" />
        <SummaryCard label="Owes now" value={rupees(due)} tone={due > 0 ? "rust" : "default"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Details" actions={<button className={goldButtonClass} disabled={!dirty || busy} onClick={() => save()}>{busy ? "Saving..." : "Save"}</button>}>
          <CustomerForm value={draft} onChange={setDraft} />
        </Panel>
        <div className="space-y-4">
          <Panel title="Bookings">
            <RentalList rentals={rentals} empty="No bookings yet." />
          </Panel>
          <MeasurementsPanel customerId={c.id} />
        </div>
      </div>

      <Modal open={blocking} onClose={() => setBlocking(false)} title={`Block ${c.full_name}?`}
        description="New bookings for a blocked customer are refused, for example after unpaid dues or damage."
        footer={<><button className={ghostButtonClass} onClick={() => setBlocking(false)}>Cancel</button>
          <button className={dangerButtonClass} disabled={busy} onClick={() => save({ is_blocked: true, blocked_reason: reason.trim() || null })}>Block</button></>}>
        <Field label="Reason"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
