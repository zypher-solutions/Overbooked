"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { addDays, errorText, fmtDate, num, rupees, todayLocal } from "@/lib/shop/format";
import { moneyError } from "@/lib/validate";
import { cn } from "@/lib/utils";
import { DateInput } from "@/components/shop/DateInput";
import {
  Empty, Field, ListSkeleton, Modal, PageHeader, Panel, StatusBadge, ghostButtonClass, goldButtonClass, inputClass, monoInputClass,
} from "@/components/shop/ui";

// Cleaning & repairs (migration 041): every piece that is away or due to go, as a work queue. A repair or alteration keeps
// the piece out of new bookings only until its due date; a cleaning job made by a return sits in the booking's cleaning days.
type JobType = "cleaning" | "alteration" | "repair" | "other";
type Status = "todo" | "away" | "back" | "done" | "cancelled";
interface Job {
  id: string; unit_id: string; branch_id: string; rental_id: string | null; type: JobType; status: Status; reason: string | null;
  vendor: string | null; due_on: string; sent_on: string | null; done_on: string | null; cost: number | null; outcome: string | null;
  units: { code: string } | null; rentals: { token: string } | null;
}
type Tab = "todo" | "away" | "back" | "history";
const TABS: [Tab, string][] = [["todo", "To do"], ["away", "Away"], ["back", "Ready"], ["history", "History"]];
const TYPE_LABEL: Record<JobType, string> = { cleaning: "Cleaning", alteration: "Alteration", repair: "Repair", other: "Other" };
const COLUMNS = "*, units!service_jobs_shop_unit_fkey(code), rentals!service_jobs_shop_rental_fkey(token)";
type Clash = { rental_id: string; token: string; start_at: string };

export default function ServiceJobsPage() {
  return <Suspense fallback={<ListSkeleton />}><ServiceJobs /></Suspense>;
}

function ServiceJobs() {
  const { tz, canManage, activeBranches } = useShop();
  const params = useSearchParams();
  const today = todayLocal(tz);
  const [tab, setTab] = useState<Tab>("todo");
  const [type, setType] = useState<JobType | "">("");
  const [q, setQ] = useState("");
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [form, setForm] = useState<{ code: string; unitId: string | null; type: JobType; reason: string; due: string } | null>(null);
  const [act, setAct] = useState<{ job: Job; action: "send" | "extend" | "done"; vendor: string; due: string; cost: string; unrepairable: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    // open jobs, and the last 200 closed ones
    const [open, closed] = await Promise.all([
      supabase.from("service_jobs").select(COLUMNS).in("status", ["todo", "away", "back"]).order("due_on"),
      supabase.from("service_jobs").select(COLUMNS).in("status", ["done", "cancelled"]).order("updated_at", { ascending: false }).limit(200),
    ]);
    if (open.error || closed.error) return toast.error(errorText(open.error ?? closed.error));
    setJobs([...((open.data ?? []) as unknown as Job[]), ...((closed.data ?? []) as unknown as Job[])]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // ?unit=<piece id> from Inventory search: its open job, or a new one for it
  const unitParam = params.get("unit");
  useEffect(() => {
    if (!unitParam || !jobs) return;
    const openJob = jobs.find((j) => j.unit_id === unitParam && ["todo", "away", "back"].includes(j.status));
    if (openJob) { setTab(openJob.status as Tab); setQ(openJob.units?.code ?? ""); return; }
    void createClient().from("units").select("code").eq("id", unitParam).maybeSingle().then(({ data }) =>
      setForm({ code: data?.code ?? "", unitId: unitParam, type: "cleaning", reason: "", due: addDays(today, 2) }));
  }, [unitParam, jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  const term = q.trim().toLowerCase();
  const shown = useMemo(() => (jobs ?? []).filter((j) => (tab === "history" ? ["done", "cancelled"].includes(j.status) : j.status === tab)
    && (!type || j.type === type)
    && (!term || `${j.units?.code} ${j.reason ?? ""} ${j.vendor ?? ""} ${j.rentals?.token ?? ""}`.toLowerCase().includes(term))), [jobs, tab, type, term]);
  const count = (t: Tab) => (jobs ?? []).filter((j) => j.status === t).length;
  const branchName = (id: string) => activeBranches.find((b) => b.id === id)?.name;

  const warnClashes = (clashes: Clash[] | undefined) => clashes?.forEach((c) =>
    toast.warning(`${c.token} needs this piece from ${fmtDate(c.start_at, tz)}. Swap the piece on that booking.`, { duration: 10000 }));

  const createJob = async () => {
    if (!form) return;
    setBusy(true);
    try {
      let unitId = form.unitId;
      if (!unitId) {
        const { data } = await createClient().from("units").select("id").ilike("code", form.code.trim()).maybeSingle();
        if (!data) throw new Error(`No piece with code ${form.code.trim()}.`);
        unitId = data.id;
      }
      const res = await call<{ clashes: Clash[] }>("create_service_job", { p_unit_id: unitId, p_type: form.type, p_reason: form.reason, p_due_on: form.due });
      toast.success("Job added");
      warnClashes(res.clashes);
      setForm(null);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async (job: Job, action: string, p: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const res = await call<{ clashes: Clash[] }>("update_service_job", { p_job_id: job.id, p_action: action, p });
      warnClashes(res.clashes);
      setAct(null);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmAct = () => {
    if (!act) return;
    if (act.action === "done") {
      const bad = act.cost.trim() ? moneyError(act.cost, { label: "cost", max: 10_000_000 }) : null;
      if (bad) return void toast.error(bad);
      return void run(act.job, "done", { outcome: act.unrepairable ? "unrepairable" : "ok", cost: act.cost.trim() ? num(act.cost) : null });
    }
    if (!act.due) return void toast.error("Choose when it is due back.");
    void run(act.job, act.action, { due_on: act.due, ...(act.action === "send" ? { vendor: act.vendor } : {}) });
  };

  return (
    <>
      <PageHeader title="Cleaning & repairs" subtitle="Pieces at the cleaner or the tailor, and pieces waiting to go."
        actions={<button className={goldButtonClass} onClick={() => setForm({ code: "", unitId: null, type: "cleaning", reason: "", due: addDays(today, 2) })}>
          <Plus className="h-4 w-4" /> New job</button>} />
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("rounded-full border px-3 py-1 text-xs", tab === k ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}>
            {label}{k !== "history" && jobs ? ` (${count(k)})` : ""}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputClass, "pl-9")} placeholder="Piece code, vendor, booking" aria-label="Search jobs" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={cn(inputClass, "w-auto")} aria-label="Job type" value={type} onChange={(e) => setType(e.target.value as JobType | "")}>
          <option value="">All jobs</option>
          {(Object.keys(TYPE_LABEL) as JobType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      </div>

      {jobs === null ? <ListSkeleton /> : !shown.length ? <Panel><Empty>Nothing here.</Empty></Panel> : (
        <ul className="space-y-2">
          {shown.map((j) => {
            const overdue = ["todo", "away"].includes(j.status) && j.due_on < today;
            return (
              <li key={j.id} className="rounded-2xl border border-border bg-surface px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold text-gold">{j.units?.code ?? "—"}</span>
                      <StatusBadge tone={j.type === "repair" ? "rust" : j.type === "alteration" ? "indigo" : "muted"}>{TYPE_LABEL[j.type]}</StatusBadge>
                      {j.status === "done" && j.outcome === "unrepairable" ? <StatusBadge tone="rust">Cannot be repaired</StatusBadge> : null}
                      {j.status === "cancelled" ? <StatusBadge tone="muted">Cancelled</StatusBadge> : null}
                    </p>
                    <p className="mt-0.5 text-sm">{j.reason ?? ""}</p>
                    <p className={cn("text-xs", overdue ? "font-semibold text-rust" : "text-muted-foreground")}>
                      {j.status === "done" || j.status === "cancelled" ? `Closed ${fmtDate(j.done_on, tz)}` : `Due ${fmtDate(j.due_on, tz)}${overdue ? " (overdue)" : ""}`}
                      {j.vendor ? ` · ${j.vendor}` : ""}
                      {j.cost ? ` · cost ${rupees(j.cost)}` : ""}
                      {activeBranches.length > 1 ? ` · ${branchName(j.branch_id) ?? ""}` : ""}
                      {j.rental_id && j.rentals ? <> · <Link className="underline" href={`/rentals/${j.rental_id}`}>{j.rentals.token}</Link></> : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {j.status === "todo" ? <button className={goldButtonClass} disabled={busy}
                      onClick={() => setAct({ job: j, action: "send", vendor: j.vendor ?? "", due: j.due_on, cost: "", unrepairable: false })}>Send out</button> : null}
                    {j.status === "away" ? <button className={goldButtonClass} disabled={busy} onClick={() => void run(j, "back")}>Mark back</button> : null}
                    {j.status === "back" || j.status === "todo" ? <button className={j.status === "back" ? goldButtonClass : ghostButtonClass} disabled={busy}
                      onClick={() => setAct({ job: j, action: "done", vendor: "", due: "", cost: "", unrepairable: false })}>Done</button> : null}
                    {["todo", "away"].includes(j.status) ? <button className={ghostButtonClass} disabled={busy}
                      onClick={() => setAct({ job: j, action: "extend", vendor: "", due: j.due_on < today ? today : j.due_on, cost: "", unrepairable: false })}>Change due date</button> : null}
                    {canManage && ["todo", "away", "back"].includes(j.status) ? <button className={ghostButtonClass} disabled={busy} onClick={() => void run(j, "cancel")}>Cancel</button> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={form !== null} onClose={() => setForm(null)} title="New job"
        description="A repair, alteration or other job keeps the piece out of new bookings until its due date."
        footer={<button className={goldButtonClass} disabled={busy} onClick={() => void createJob()}>{busy ? "Saving..." : "Add job"}</button>}>
        {form ? <>
          <Field label="Piece code">
            <input className={monoInputClass} value={form.code} readOnly={!!form.unitId} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="Job">
            <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as JobType })}>
              {(Object.keys(TYPE_LABEL) as JobType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="What needs doing"><input className={inputClass} maxLength={300} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          <Field label="Due back"><DateInput value={form.due} min={today} onChange={(due) => setForm({ ...form, due })} /></Field>
        </> : null}
      </Modal>

      <Modal open={act !== null} onClose={() => setAct(null)}
        title={act?.action === "send" ? "Send out" : act?.action === "extend" ? "Change the due date" : "Finish the job"}
        footer={<button className={goldButtonClass} disabled={busy} onClick={confirmAct}>{busy ? "Saving..." : "Save"}</button>}>
        {act?.action === "send" ? (
          <Field label="Cleaner or tailor"><input className={inputClass} maxLength={80} value={act.vendor} onChange={(e) => setAct({ ...act, vendor: e.target.value })} /></Field>
        ) : null}
        {act && act.action !== "done" ? (
          <Field label="Due back"><DateInput value={act.due} min={today} onChange={(due) => setAct({ ...act, due })} /></Field>
        ) : null}
        {act?.action === "done" ? (canManage ? <>
          <Field label="Cost to the shop (₹, optional)" hint="Added to Finance > Expenses">
            <input className={monoInputClass} inputMode="decimal" value={act.cost} onChange={(e) => setAct({ ...act, cost: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={act.unrepairable} onChange={(e) => setAct({ ...act, unrepairable: e.target.checked })} />
            It cannot be repaired (the piece is retired)
          </label>
        </> : <p className="text-sm text-muted-foreground">The piece becomes available again. A manager or the owner can enter the cost.</p>) : null}
      </Modal>
    </>
  );
}
