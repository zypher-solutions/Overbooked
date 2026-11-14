"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Plus, ScanLine, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { addDays, errorText, fmtDate, num, plural, rupees, todayLocal } from "@/lib/shop/format";
import { moneyError } from "@/lib/validate";
import { cn } from "@/lib/utils";
import { DateInput } from "@/components/shop/DateInput";
import { CameraScanner } from "@/components/overbooked/CameraScanner";
import {
  Field, ListSkeleton, Modal, PageHeader, Panel, StatusBadge, ghostButtonClass, goldButtonClass, inputClass, monoInputClass,
} from "@/components/shop/ui";

// Cleaning & repairs (migration 041): every piece that is away or due to go, as one work list grouped by the next step
// (send it, get it back, finish it), so nothing hides behind a tab. Finished jobs open at the bottom on request.
// A repair or alteration keeps the piece out of new bookings only until its due date; a cleaning job made by a return
// sits in the booking's cleaning days.
type JobType = "cleaning" | "alteration" | "repair" | "other";
type Status = "todo" | "away" | "back" | "done" | "cancelled";
interface Job {
  id: string; unit_id: string; branch_id: string; rental_id: string | null; type: JobType; status: Status; reason: string | null;
  vendor: string | null; due_on: string; sent_on: string | null; done_on: string | null; cost: number | null; outcome: string | null;
  units: { code: string; products: { name: string; image_url: string | null } | null } | null; rentals: { token: string } | null;
}
type OpenStatus = "todo" | "away" | "back";
const GROUPS: { status: OpenStatus; title: string; hint: string }[] = [
  { status: "todo", title: "Waiting to go", hint: "Send these to the cleaner or tailor." },
  { status: "away", title: "At the cleaner or tailor", hint: "Mark each one back when it comes in." },
  { status: "back", title: "Back in the shop", hint: "Check the piece, then finish the job so it can be booked again." },
];
const OPEN: Status[] = ["todo", "away", "back"];
const TYPE_LABEL: Record<JobType, string> = { cleaning: "Cleaning", alteration: "Alteration", repair: "Repair", other: "Other" };
const COLUMNS = "*, units!service_jobs_shop_unit_fkey(code, products!units_shop_product_fkey(name, image_url)), rentals!service_jobs_shop_rental_fkey(token)";
type Clash = { rental_id: string; token: string; start_at: string };
// one piece in the New job picker: staff tap the exact one (photo, product, variation and code)
interface Piece {
  id: string; code: string; status: string; branch_id: string;
  products: { name: string; image_url: string | null; category_id: string | null } | null; product_variations: { name: string } | null;
}
const PIECE = "id, code, status, branch_id, products!units_shop_product_fkey(name, image_url, category_id), product_variations!units_shop_variation_fkey(name)";
// the picker lists this many pieces before anything is typed; typing searches all of them
const FIRST_PIECES = 300;
type Form = { unit: Piece | null; q: string; category: string; type: JobType; reason: string; due: string };

export default function ServiceJobsPage() {
  return <Suspense fallback={<ListSkeleton />}><ServiceJobs /></Suspense>;
}

function ServiceJobs() {
  const { tz, canManage, activeBranches, categories } = useShop();
  const params = useSearchParams();
  const today = todayLocal(tz);
  const [q, setQ] = useState("");
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [showFinished, setShowFinished] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [firstPieces, setFirstPieces] = useState<Piece[] | null>(null);
  const [found, setFound] = useState<Piece[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [act, setAct] = useState<{ job: Job; action: "send" | "extend" | "done"; vendor: string; due: string; cost: string; unrepairable: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    // open jobs, and the last 200 closed ones
    const [open, closed] = await Promise.all([
      supabase.from("service_jobs").select(COLUMNS).in("status", OPEN).order("due_on"),
      supabase.from("service_jobs").select(COLUMNS).in("status", ["done", "cancelled"]).order("updated_at", { ascending: false }).limit(200),
    ]);
    if (open.error || closed.error) return toast.error(errorText(open.error ?? closed.error));
    setJobs([...((open.data ?? []) as unknown as Job[]), ...((closed.data ?? []) as unknown as Job[])]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const blankForm = (unit: Piece | null = null): Form => ({ unit, q: "", category: "", type: "cleaning", reason: "", due: addDays(today, 2) });

  // ?unit=<piece id> from Inventory search: its open job, or a new one for it
  const unitParam = params.get("unit");
  useEffect(() => {
    if (!unitParam || !jobs) return;
    const openJob = jobs.find((j) => j.unit_id === unitParam && OPEN.includes(j.status));
    if (openJob) { setQ(openJob.units?.code ?? ""); return; }
    void createClient().from("units").select(PIECE).eq("id", unitParam).maybeSingle().then(({ data }) =>
      setForm(blankForm((data as unknown as Piece) ?? null)));
  }, [unitParam, jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  // the picker opens with pieces already listed: those in maintenance first, then by product
  const picking = !!form && !form.unit;
  useEffect(() => {
    if (!picking || firstPieces) return;
    void createClient().from("units").select(PIECE).neq("status", "retired").order("code").limit(FIRST_PIECES)
      .then(({ data, error }) => {
        if (error) return void toast.error(errorText(error));
        setFirstPieces((data as unknown as Piece[]) ?? []);
      });
  }, [picking, firstPieces]);

  // typing searches every piece in the shop (code or product name), not only the first ones listed
  const pickQ = picking ? form.q.trim().replace(/[%_,()]/g, "") : "";
  useEffect(() => {
    setFound(null);
    if (!pickQ) return;
    let stale = false; // a slower answer for an older search must not replace the newer one
    const t = setTimeout(async () => {
      const supabase = createClient();
      const like = `%${pickQ}%`;
      const { data: products } = await supabase.from("products").select("id").ilike("name", like).limit(30);
      const ids = (products ?? []).map((p) => p.id);
      const { data, error } = await supabase.from("units").select(PIECE).neq("status", "retired")
        .or(ids.length ? `code.ilike.${like},product_id.in.(${ids.join(",")})` : `code.ilike.${like}`).order("code").limit(120);
      if (stale) return;
      if (error) return void toast.error(errorText(error));
      setFound((data as unknown as Piece[]) ?? []);
    }, 200);
    return () => { stale = true; clearTimeout(t); };
  }, [pickQ]);

  const openJobOf = useCallback((unitId: string) => (jobs ?? []).find((j) => j.unit_id === unitId && OPEN.includes(j.status)), [jobs]);
  const pickList = useMemo(() => {
    if (!form || form.unit) return null;
    const source = pickQ ? found : firstPieces;
    if (!source) return null;
    const term = pickQ.toLowerCase();
    const rank = (p: Piece) => (openJobOf(p.id) ? 2 : p.status === "maintenance" ? 0 : 1);
    return source
      .filter((p) => !form.category || p.products?.category_id === form.category)
      // the product name, variation and code all match, as people type them
      .filter((p) => !term || `${p.code} ${p.products?.name ?? ""} ${p.product_variations?.name ?? ""}`.toLowerCase().includes(term))
      .sort((a, b) => rank(a) - rank(b) || (a.products?.name ?? "").localeCompare(b.products?.name ?? "") || a.code.localeCompare(b.code));
  }, [form, pickQ, found, firstPieces, openJobOf]);
  const usedCategories = useMemo(() => {
    const ids = new Set((firstPieces ?? []).map((p) => p.products?.category_id));
    return categories.filter((c) => ids.has(c.id));
  }, [categories, firstPieces]);

  const term = q.trim().toLowerCase();
  const matches = (j: Job) => !term
    || `${j.units?.code} ${j.units?.products?.name ?? ""} ${j.reason ?? ""} ${j.vendor ?? ""} ${j.rentals?.token ?? ""} ${TYPE_LABEL[j.type]}`.toLowerCase().includes(term);
  const shown = (jobs ?? []).filter(matches);
  const openCount = (jobs ?? []).filter((j) => OPEN.includes(j.status)).length;
  const overdueCount = (jobs ?? []).filter((j) => (j.status === "todo" || j.status === "away") && j.due_on < today).length;
  const finished = shown.filter((j) => !OPEN.includes(j.status));
  const branchName = (id: string) => activeBranches.find((b) => b.id === id)?.name;

  const warnClashes = (clashes: Clash[] | undefined) => clashes?.forEach((c) =>
    toast.warning(`${c.token} needs this piece from ${fmtDate(c.start_at, tz)}. Swap the piece on that booking.`, { duration: 10000 }));

  const createJob = async () => {
    if (!form) return;
    if (!form.unit) return void toast.error("Choose the piece.");
    setBusy(true);
    try {
      const res = await call<{ clashes: Clash[] }>("create_service_job", { p_unit_id: form.unit.id, p_type: form.type, p_reason: form.reason, p_due_on: form.due });
      toast.success(`${form.unit.code} added to ${TYPE_LABEL[form.type].toLowerCase()}`);
      warnClashes(res.clashes);
      setForm(null);
      setFirstPieces(null);
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

  // a scanned tag picks that exact piece
  const onScan = async (text: string) => {
    setScanning(false);
    const code = text.trim().replace(/[%_]/g, "");
    if (!form || !code) return;
    const { data } = await createClient().from("units").select(PIECE).ilike("code", code).neq("status", "retired").maybeSingle();
    const piece = data as unknown as Piece | null;
    if (!piece) { setForm({ ...form, q: code }); return void toast.info(`No piece has the tag ${code}. Check the list below.`); }
    const busyJob = openJobOf(piece.id);
    if (busyJob) { setForm({ ...form, q: code }); return void toast.info(`${piece.code} is already in ${TYPE_LABEL[busyJob.type].toLowerCase()}.`); }
    setForm({ ...form, unit: piece, q: "" });
  };

  const jobRow = (j: Job) => {
    const overdue = (j.status === "todo" || j.status === "away") && j.due_on < today;
    const closed = j.status === "done" || j.status === "cancelled";
    return (
      <li key={j.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", overdue && "bg-rust/5")}>
        {j.units?.products?.image_url
          ? <img src={j.units.products.image_url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
          : <div className="h-11 w-11 shrink-0 rounded-lg bg-muted" />}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{j.units?.products?.name ?? "Piece"}</span>
            <span className="font-mono text-sm font-semibold text-gold">{j.units?.code ?? "—"}</span>
            <StatusBadge tone={j.type === "repair" ? "rust" : j.type === "alteration" ? "indigo" : "muted"}>{TYPE_LABEL[j.type]}</StatusBadge>
            {overdue ? <StatusBadge tone="rust">Overdue</StatusBadge> : null}
            {j.status === "done" && j.outcome === "unrepairable" ? <StatusBadge tone="rust">Cannot be repaired</StatusBadge> : null}
            {j.status === "cancelled" ? <StatusBadge tone="muted">Cancelled</StatusBadge> : null}
          </p>
          {j.reason ? <p className="mt-0.5 text-sm">{j.reason}</p> : null}
          <p className={cn("text-xs", overdue ? "font-semibold text-rust" : "text-muted-foreground")}>
            {closed ? `Closed ${fmtDate(j.done_on, tz)}` : `Due back ${fmtDate(j.due_on, tz)}`}
            {j.vendor ? ` · ${j.vendor}` : ""}
            {j.cost ? ` · cost ${rupees(j.cost)}` : ""}
            {activeBranches.length > 1 ? ` · ${branchName(j.branch_id) ?? ""}` : ""}
            {j.rental_id && j.rentals ? <> · from <Link className="underline" href={`/rentals/${j.rental_id}`}>{j.rentals.token}</Link></> : null}
          </p>
        </div>
        {!closed ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* the one next step is the dark button; the rest are quieter */}
            {j.status === "todo" ? <button className={goldButtonClass} disabled={busy}
              onClick={() => setAct({ job: j, action: "send", vendor: j.vendor ?? "", due: j.due_on < today ? today : j.due_on, cost: "", unrepairable: false })}>Send out</button> : null}
            {j.status === "away" ? <button className={goldButtonClass} disabled={busy} onClick={() => void run(j, "back")}>Mark back</button> : null}
            {j.status === "back" ? <button className={goldButtonClass} disabled={busy}
              onClick={() => setAct({ job: j, action: "done", vendor: "", due: "", cost: "", unrepairable: false })}>Finish</button> : null}
            {j.status === "todo" ? <button className={ghostButtonClass} disabled={busy}
              onClick={() => setAct({ job: j, action: "done", vendor: "", due: "", cost: "", unrepairable: false })}>Done in the shop</button> : null}
            {j.status !== "back" ? <button className={ghostButtonClass} disabled={busy}
              onClick={() => setAct({ job: j, action: "extend", vendor: "", due: j.due_on < today ? today : j.due_on, cost: "", unrepairable: false })}>Change date</button> : null}
            {canManage ? <button className="px-2 text-xs text-muted-foreground underline-offset-2 hover:text-rust hover:underline" disabled={busy}
              onClick={() => void run(j, "cancel")}>Cancel job</button> : null}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Cleaning & repairs"
        subtitle={jobs === null ? "Pieces at the cleaner or tailor, and pieces waiting to go."
          : openCount ? `${plural(openCount, "piece")} in work${overdueCount ? ` · ${overdueCount} overdue` : ""}` : "Nothing is being cleaned or repaired."}
        actions={<button className={goldButtonClass} onClick={() => setForm(blankForm())}>
          <Plus className="h-4 w-4" /> New job</button>} />

      {jobs !== null && jobs.length > 0 ? (
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputClass, "pl-9")} placeholder="Find a piece, product, cleaner or booking" aria-label="Find a job" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      ) : null}

      {jobs === null ? <ListSkeleton /> : openCount === 0 && !term ? (
        <Panel>
          <div className="mx-auto max-w-md py-8 text-center">
            <Sparkles className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold">All pieces are in the shop</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Returns that need cleaning appear here by themselves. Use New job for a stain, a repair or an alteration.
            </p>
          </div>
        </Panel>
      ) : (
        <div className="space-y-4">
          {GROUPS.map((g) => {
            const list = shown.filter((j) => j.status === g.status);
            if (!list.length) return null;
            return (
              <section key={g.status} aria-labelledby={`group-${g.status}`} className="glass overflow-hidden p-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
                  <h2 id={`group-${g.status}`} className="text-base font-semibold">{g.title} <span className="font-normal text-muted-foreground">({list.length})</span></h2>
                  <p className="text-xs text-muted-foreground">{g.hint}</p>
                </div>
                <ul className="divide-y divide-border">{list.map(jobRow)}</ul>
              </section>
            );
          })}
          {term && !shown.some((j) => OPEN.includes(j.status)) ? (
            <Panel><p className="py-4 text-center text-sm text-muted-foreground">No open job matches &quot;{q.trim()}&quot;.</p></Panel>
          ) : null}
        </div>
      )}

      {jobs !== null && jobs.some((j) => !OPEN.includes(j.status)) ? (
        <div className="mt-6">
          <button type="button" className={ghostButtonClass} aria-expanded={showFinished} onClick={() => setShowFinished((v) => !v)}>
            <ChevronDown className={cn("h-4 w-4 transition-transform", showFinished && "rotate-180")} aria-hidden="true" />
            {showFinished ? "Hide finished jobs" : "Show finished jobs"}
          </button>
          {showFinished ? (
            finished.length
              ? <ul className="glass mt-3 divide-y divide-border overflow-hidden p-0">{finished.map(jobRow)}</ul>
              : <p className="mt-3 text-sm text-muted-foreground">No finished job matches.</p>
          ) : null}
        </div>
      ) : null}

      <Modal open={form !== null} onClose={() => setForm(null)} title="New job"
        description="A repair, alteration or other job keeps the piece out of new bookings until its due date."
        footer={<button className={goldButtonClass} disabled={busy || !form?.unit} onClick={() => void createJob()}>{busy ? "Saving..." : "Add job"}</button>}>
        {form ? <>
          {form.unit ? (
            <Field label="Piece">
              <div className="flex items-center gap-3 rounded-xl border border-gold/60 bg-gold/5 p-2">
                <PieceRow p={form.unit} branch={activeBranches.length > 1 ? branchName(form.unit.branch_id) : undefined} />
                <button type="button" className={ghostButtonClass} onClick={() => setForm({ ...form, unit: null })}>Change</button>
              </div>
            </Field>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground">Piece · tap the one that needs work</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input className={cn(inputClass, "pl-9")} autoFocus placeholder="Product name or tag code" aria-label="Find the piece"
                    value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} />
                </div>
                <button type="button" className={ghostButtonClass} onClick={() => setScanning(true)} aria-label="Scan the tag with the camera">
                  <ScanLine className="h-4 w-4" /> <span className="hidden sm:inline">Scan</span>
                </button>
              </div>
              {usedCategories.length > 1 ? (
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
                  {[{ id: "", name: "All" }, ...usedCategories].map((c) => (
                    <button key={c.id || "all"} type="button" role="radio" aria-checked={form.category === c.id}
                      onClick={() => setForm({ ...form, category: c.id })}
                      className={cn("rounded-full border px-3 py-1 text-xs", form.category === c.id ? "border-gold/60 bg-gold/10 font-medium" : "border-border text-muted-foreground")}>
                      {c.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <ul className="max-h-72 space-y-1 overflow-y-auto pr-1" aria-label="Pieces">
                {pickList === null ? <li className="px-2 py-3 text-sm text-muted-foreground">Loading pieces...</li>
                  : !pickList.length ? <li className="px-2 py-3 text-sm text-muted-foreground">{form.q.trim() ? `No piece matches "${form.q.trim()}".` : "No pieces in this category."}</li>
                  : pickList.map((p) => {
                    const busyJob = openJobOf(p.id);
                    return (
                      <li key={p.id}>
                        <button type="button" disabled={!!busyJob} onClick={() => setForm({ ...form, unit: p, q: "" })}
                          className="flex w-full items-center gap-3 rounded-xl border border-border px-2 py-2 text-left hover:border-gold/60 hover:bg-gold/5 disabled:cursor-not-allowed disabled:opacity-50">
                          <PieceRow p={p} branch={activeBranches.length > 1 ? branchName(p.branch_id) : undefined}
                            note={busyJob ? `Already in ${TYPE_LABEL[busyJob.type].toLowerCase()}` : p.status === "maintenance" ? "In maintenance" : undefined} />
                        </button>
                      </li>
                    );
                  })}
              </ul>
              {!pickQ && firstPieces && firstPieces.length >= FIRST_PIECES ? (
                <p className="text-xs text-muted-foreground">Showing the first {FIRST_PIECES} pieces. Type to search all of them.</p>
              ) : null}
            </div>
          )}
          <Field label="Job">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Job">
              {(Object.keys(TYPE_LABEL) as JobType[]).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={form.type === t} onClick={() => setForm({ ...form, type: t })}
                  className={cn("min-h-9 rounded-full border px-3.5 py-1.5 text-xs", form.type === t ? "border-gold/60 bg-gold/10 font-medium text-foreground" : "border-border text-muted-foreground")}>
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="What needs doing (optional)">
            <input className={inputClass} maxLength={300} placeholder="e.g. Stain on the dupatta, hem 2 cm shorter" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          <Field label="Due back"><DateInput value={form.due} min={today} onChange={(due) => setForm({ ...form, due })} /></Field>
        </> : null}
      </Modal>

      <Modal open={act !== null} onClose={() => setAct(null)}
        title={act?.action === "send" ? `Send out ${act.job.units?.code ?? ""}` : act?.action === "extend" ? "Change the due date" : `Finish ${act?.job.units?.code ?? "the job"}`}
        footer={<button className={goldButtonClass} disabled={busy} onClick={confirmAct}>{busy ? "Saving..." : "Save"}</button>}>
        {act?.action === "send" ? (
          <Field label="Cleaner or tailor"><input className={inputClass} maxLength={80} autoFocus value={act.vendor} onChange={(e) => setAct({ ...act, vendor: e.target.value })} /></Field>
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

      {scanning ? <CameraScanner onClose={() => setScanning(false)} onScan={(text) => void onScan(text)} onError={() => { setScanning(false); toast.error("Could not open the camera. Type the code instead."); }} /> : null}
    </>
  );
}

// photo, product, variation and code, so two pieces of the same product can be told apart
function PieceRow({ p, branch, note }: { p: Piece; branch?: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {p.products?.image_url
        ? <img src={p.products.image_url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
        : <div className="h-11 w-11 shrink-0 rounded-lg bg-muted" />}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{p.products?.name ?? "Piece"}{p.product_variations?.name ? ` · ${p.product_variations.name}` : ""}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono font-semibold text-gold">{p.code}</span>{branch ? ` · ${branch}` : ""}{note ? ` · ${note}` : ""}
        </p>
      </div>
    </div>
  );
}
