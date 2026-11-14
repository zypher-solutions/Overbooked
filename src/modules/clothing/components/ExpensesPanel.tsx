"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { moneyError, reasonError, textLimitError } from "@/lib/validate";
import { DateInput } from "@/components/shop/DateInput";
import Papa from "papaparse";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { METHOD_LABELS, errorText, fmtDate, num, rupees, todayLocal } from "@/lib/shop/format";
import type { Method } from "@/lib/shop/types";
import { Field, Modal, dangerButtonClass, ghostButtonClass, goldButtonClass, inputClass } from "@/components/shop/ui";

// Money going out of the shop, so Finance can show profit. The owner and a branch manager add; only the owner
// corrects or deletes (with a reason, kept in the audit log). Staff do not see this panel.
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Shop rent", "Salaries", "Dry-cleaning and laundry", "Tailoring and alterations", "Repairs",
  "Electricity and internet", "Marketing", "Transport", "Other",
];
const PAGE = 200;

// method and paid_to: how it was paid and to whom (migration 043), so the daily cashbook can take cash expenses out of the drawer
interface Expense { id: string; branch_id: string; spent_on: string; category: string; amount: number; method: Method; paid_to: string | null; note: string | null }

export function ExpensesPanel({ from, to, branch, onChanged }: { from: string; to: string; branch: string; onChanged: () => void }) {
  const { tz, isOwner, myBranchId, activeBranches, branches } = useShop();
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [version, setVersion] = useState(0);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "";

  useEffect(() => {
    let live = true;
    (async () => {
      let q = createClient().from("expenses").select("id, branch_id, spent_on, category, amount, method, paid_to, note").lte("spent_on", to);
      if (from) q = q.gte("spent_on", from);
      if (branch) q = q.eq("branch_id", branch);
      const { data, error } = await q.order("spent_on", { ascending: false }).order("id").limit(PAGE + 1);
      if (!live) return;
      if (error) { toast.error("Could not load the expenses: " + error.message); setRows([]); return; }
      const list = (data ?? []).map((x) => ({ ...x, amount: Number(x.amount) })) as Expense[];
      setMore(list.length > PAGE);
      setRows(list.slice(0, PAGE));
    })();
    return () => { live = false; };
  }, [from, to, branch, version]);

  const categories = useMemo(() => {
    const used = (rows ?? []).map((r) => r.category);
    return Array.from(new Set([...DEFAULT_EXPENSE_CATEGORIES, ...used]));
  }, [rows]);
  const total = useMemo(() => Math.round((rows ?? []).reduce((s, r) => s + r.amount, 0) * 100) / 100, [rows]);
  const changed = () => { setVersion((v) => v + 1); onChanged(); };

  const exportCsv = () => {
    const list = (rows ?? []).map((r) => ({ date: r.spent_on, branch: branchName(r.branch_id), category: r.category, amount: r.amount, paid_by: METHOD_LABELS[r.method] ?? r.method, paid_to: r.paid_to ?? "", note: r.note ?? "" }));
    const blob = new Blob([Papa.unparse(list, { escapeFormulae: true })], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `expenses-${from || "start"}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="glass mt-4 rounded-xl p-4 sm:p-5" aria-label="Expenses">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide">Expenses</h2>
          <p className="mt-1 text-xs text-muted-foreground">Money going out: rent, salaries, dry-cleaning, tailoring. Profit on this page is earned minus these.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={ghostButtonClass} disabled={!rows?.length} onClick={exportCsv}><Download className="h-3.5 w-3.5" /> Expenses CSV</button>
          <button type="button" className={goldButtonClass} onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add expense</button>
        </div>
      </div>

      {rows === null ? <p className="mt-3 text-sm text-muted-foreground">Loading...</p> : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No expenses in these dates{branch ? ` for ${branchName(branch)}` : ""}. Add rent, salaries and other costs to see your profit.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Category</th>
              <th className="py-2 pr-3 font-medium">Branch</th><th className="py-2 pr-3 font-medium">Paid by</th><th className="py-2 pr-3 font-medium">Paid to</th><th className="py-2 pr-3 font-medium">Note</th>
              <th className="py-2 pr-3 text-right font-medium">Amount</th>{isOwner ? <th className="py-2" /> : null}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.spent_on)}</td>
                  <td className="py-2 pr-3">{r.category}</td>
                  <td className="py-2 pr-3">{branchName(r.branch_id)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{METHOD_LABELS[r.method] ?? r.method}</td>
                  <td className="py-2 pr-3">{r.paid_to}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{r.note}</td>
                  <td className="py-2 pr-3 text-right font-mono">{rupees(r.amount)}</td>
                  {isOwner ? (
                    <td className="py-2 text-right whitespace-nowrap">
                      <button type="button" aria-label="Correct expense" className="rounded p-1.5 text-muted-foreground hover:text-foreground" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></button>
                      <button type="button" aria-label="Delete expense" className="rounded p-1.5 text-muted-foreground hover:text-rust" onClick={() => setDeleting(r)}><Trash2 className="h-4 w-4" /></button>
                    </td>
                  ) : null}
                </tr>
              ))}
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2 pr-3" colSpan={6}>Total{more ? ` (latest ${PAGE} shown; narrow the dates for the rest)` : ""}</td>
                <td className="py-2 pr-3 text-right font-mono">{rupees(total)}</td>{isOwner ? <td /> : null}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <ExpenseDialog expense={editing === "new" ? null : editing} categories={categories} today={todayLocal(tz)}
          branchChoices={myBranchId ? activeBranches.filter((b) => b.id === myBranchId) : activeBranches}
          defaultBranch={myBranchId ?? (branch || activeBranches[0]?.id || "")}
          onClose={() => setEditing(null)} onDone={() => { setEditing(null); changed(); }} />
      ) : null}
      {deleting ? <DeleteDialog expense={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); changed(); }} /> : null}
    </section>
  );
}

function ExpenseDialog({ expense, categories, today, branchChoices, defaultBranch, onClose, onDone }: {
  expense: Expense | null; categories: string[]; today: string; branchChoices: { id: string; name: string }[];
  defaultBranch: string; onClose: () => void; onDone: () => void;
}) {
  const { isOwner } = useShop();
  const [date, setDate] = useState(expense?.spent_on ?? today);
  const [branchId, setBranchId] = useState(expense?.branch_id ?? defaultBranch);
  const [category, setCategory] = useState(expense?.category ?? "");
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [method, setMethod] = useState<Method | "">(expense?.method ?? "");
  const [paidTo, setPaidTo] = useState(expense?.paid_to ?? "");
  const [note, setNote] = useState(expense?.note ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const [tried, setTried] = useState(false);
  const errs = {
    date: !date ? "Choose the date." : date > today ? "The date cannot be in the future." : null,
    amount: moneyError(amount, { required: true, positive: true, max: 10_000_000 }),
    branch: branchId ? null : "Choose a branch.",
    category: !category.trim() ? "Choose or type a category." : category.trim().length < 2 ? "The category is too short." : null,
    method: method ? null : "Choose how it was paid.",
    paidTo: textLimitError(paidTo, "paid to", 80),
    note: textLimitError(note, "note", 200),
    reason: expense ? reasonError(reason, "reason for the correction") : null,
  };
  const bad = Object.values(errs).some(Boolean);
  const save = async () => {
    setTried(true);
    if (bad) return toast.error(Object.values(errs).find(Boolean)!);
    setBusy(true);
    try {
      const p = { branch_id: branchId, spent_on: date, category: category.trim(), amount: num(amount), method, paid_to: paidTo.trim() || null, note: note.trim() || null };
      if (expense) await call("update_expense", { p_expense_id: expense.id, p, p_reason: reason.trim() });
      else await call("add_expense", { p });
      toast.success(expense ? "Expense corrected" : "Expense added");
      onDone();
    } catch (e) {
      toast.error(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={expense ? "Correct expense" : "Add expense"}
      description={expense ? "The change is kept in the audit log with your reason." : "Money that went out of the shop."}
      footer={<>
        <button type="button" className={ghostButtonClass} onClick={onClose}>Cancel</button>
        <button type="button" className={goldButtonClass} disabled={busy || (tried && bad)} onClick={() => void save()}>{busy ? "Saving..." : expense ? "Save correction" : "Add expense"}</button>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" error={tried || !date ? errs.date ?? undefined : undefined}><DateInput value={date} max={today} onChange={(v) => setDate(v)} /></Field>
        <Field label="Amount (₹)" error={tried || amount.trim() ? errs.amount ?? undefined : undefined}><input inputMode="decimal" maxLength={10} className={inputClass} value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      {branchChoices.length > 1 || (expense && isOwner) ? (
        <Field label="Branch">
          <select className={inputClass} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branchChoices.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      ) : null}
      <Field label="Category" hint="Pick one or type your own" error={tried ? errs.category ?? undefined : undefined}>
        <input className={inputClass} list="expense-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Shop rent" maxLength={60} />
        <datalist id="expense-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Paid by" error={tried ? errs.method ?? undefined : undefined}>
          <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as Method | "")}>
            <option value="" disabled>Choose…</option>
            {Object.entries(METHOD_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </Field>
        <Field label="Paid to (optional)" error={errs.paidTo ?? undefined}><input className={inputClass} maxLength={90} value={paidTo} onChange={(e) => setPaidTo(e.target.value)} placeholder="e.g. Ravi Cleaners" /></Field>
      </div>
      <Field label="Note (optional)" error={errs.note ?? undefined}><input className={inputClass} maxLength={220} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. October rent, MG Road" /></Field>
      {expense ? <Field label="Why are you correcting it?" error={tried || reason.trim() ? errs.reason ?? undefined : undefined}><input className={inputClass} maxLength={320} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. typed the wrong amount" /></Field> : null}
    </Modal>
  );
}

function DeleteDialog({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const reasonErr = reasonError(reason, "reason for deleting it");
  const remove = async () => {
    setTried(true);
    if (reasonErr) return toast.error(reasonErr);
    setBusy(true);
    try {
      await call("delete_expense", { p_expense_id: expense.id, p_reason: reason.trim() });
      toast.success("Expense deleted");
      onDone();
    } catch (e) {
      toast.error(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Delete expense" description={`${expense.category} · ${rupees(expense.amount)} on ${fmtDate(expense.spent_on)}. It stays in the audit log.`}
      footer={<>
        <button type="button" className={ghostButtonClass} onClick={onClose}>Keep it</button>
        <button type="button" className={cn(dangerButtonClass)} disabled={busy || (tried && !!reasonErr)} onClick={() => void remove()}>{busy ? "Deleting..." : "Delete"}</button>
      </>}>
      <Field label="Why are you deleting it?" error={tried || reason.trim() ? reasonErr ?? undefined : undefined}><input className={inputClass} maxLength={320} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. entered twice" /></Field>
    </Modal>
  );
}
