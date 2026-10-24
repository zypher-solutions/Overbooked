"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { addDays, dayRange, errorText, fmtDate, todayLocal } from "@/lib/shop/format";
import type { Appointment } from "@/lib/shop/types";
import { APPOINTMENT_COLUMNS, AppointmentDialog, AppointmentList } from "@/components/shop/Appointments";
import { PageHeader, Panel, goldButtonClass } from "@/components/shop/ui";

// Fittings, trials, deliveries and collections for the next two weeks, day by day.
export default function Appointments() {
  const { tz, feature } = useShop();
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [adding, setAdding] = useState(false);
  const today = todayLocal(tz);

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("appointments").select(APPOINTMENT_COLUMNS)
      .gte("scheduled_at", dayRange(addDays(today, -1), tz).from).lt("scheduled_at", dayRange(addDays(today, 14), tz).to)
      .order("scheduled_at");
    if (error) toast.error(errorText(error));
    setItems((data as unknown as Appointment[]) ?? []);
  }, [today, tz]);
  useEffect(() => { void load(); }, [load]);

  if (!feature("appointments")) {
    return <Panel><p className="text-sm text-muted-foreground">Appointments are not switched on for this shop. Ask Zypher to switch them on.</p></Panel>;
  }

  const days = Array.from({ length: 16 }, (_, i) => addDays(today, i - 1));
  const onDay = (d: string) => (items ?? []).filter((a) => {
    const r = dayRange(d, tz);
    return a.scheduled_at >= r.from && a.scheduled_at < r.to;
  });

  return (
    <>
      <PageHeader title="Appointments" subtitle="Fittings, trials, deliveries and collections."
        actions={<button className={goldButtonClass} onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> New appointment</button>} />
      {items === null ? <p className="text-sm text-muted-foreground">Loading...</p> : (
        <div className="space-y-3">
          {days.filter((d) => onDay(d).length > 0 || d === today).map((d) => (
            <Panel key={d} title={d === today ? `Today, ${fmtDate(d)}` : d === addDays(today, 1) ? `Tomorrow, ${fmtDate(d)}` : d < today ? `Yesterday, ${fmtDate(d)}` : fmtDate(d)}>
              <AppointmentList items={onDay(d)} onChanged={load} onEdit={setEditing} />
            </Panel>
          ))}
        </div>
      )}
      <AppointmentDialog open={adding || editing !== null} appointment={editing}
        onClose={() => { setAdding(false); setEditing(null); }} onSaved={load} />
    </>
  );
}
