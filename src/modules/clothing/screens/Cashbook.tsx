"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, FileSpreadsheet, Wallet } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { METHOD_LABELS, PAYMENT_LABELS, addDays, dayRange, errorText, fmtDate, fmtDateTime, num, rupees, todayLocal } from "@/lib/shop/format";
import { moneyError } from "@/lib/validate";
import { DateInput } from "@/components/shop/DateInput";
import { Field, ListSkeleton, Modal, PageHeader, Panel, ghostButtonClass, goldButtonClass, inputClass, monoInputClass, tableWrap, theadClass } from "@/components/shop/ui";
import { downloadSheet } from "../sheet";
import { Figure, FinanceTabs, RangeBar, pageAll, r2, type Range } from "../components/FinanceBits";

// Daily cashbook: for each payment method, each day's opening balance, money in (rent, deposits), money out (refunds,
// deposits given back, expenses) and closing balance. Summed in the database (finance_cashbook, migration 043).
// Cash starts from the drawer count a branch records (Opening cash); UPI, card and bank start at zero.
type Method = "cash" | "upi" | "card" | "bank_transfer";
const METHODS: Method[] = ["cash", "upi", "card", "bank_transfer"];
interface DayRow { day: string; method: Method; rent_in: number; deposit_in: number; refund_out: number; deposit_out: number; expense_out: number }
interface Book { opening: Record<Method, number>; days: DayRow[]; cash_counts: { day: string; amount: number; book: number }[] }
interface Line { key: string; at: string; what: string; who: string; amount: number }
interface Row { day: string; opening: number; counted: number | null; rent_in: number; deposit_in: number; refund_out: number; deposit_out: number; expense_out: number; closing: number }
// a balance can fall below zero (more paid out than the book knows came in), so the sign goes before the ₹
const money = (n: number) => (n < 0 ? `−${rupees(-n)}` : rupees(n));

export default function Cashbook() {
  const { tz, canManage, isOwner, myBranchId, branches } = useShop();
  const today = todayLocal(tz);
  const [range, setRange] = useState<Range>({ from: today.slice(0, 8) + "01", to: today, branch: myBranchId ?? "" });
  const [method, setMethod] = useState<Method>("cash");
  const [book, setBook] = useState<Book | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, Line[] | null>>({});
  const [setting, setSetting] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    setBook(null);
    setFailed(null);
    setOpen(null);
    setLines({});
    if (!range.from) return;
    void createClient().rpc("finance_cashbook" as never, { p_from: range.from, p_to: range.to, p_branch_id: range.branch || null } as never)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) { setFailed(errorText(error)); return; }
        const b = data as unknown as Book;
        setBook({
          opening: Object.fromEntries(METHODS.map((m) => [m, Number(b.opening?.[m] ?? 0)])) as Record<Method, number>,
          days: (b.days ?? []).map((d) => ({ ...d, rent_in: Number(d.rent_in), deposit_in: Number(d.deposit_in), refund_out: Number(d.refund_out), deposit_out: Number(d.deposit_out), expense_out: Number(d.expense_out) })),
          cash_counts: (b.cash_counts ?? []).map((c) => ({ day: c.day, amount: Number(c.amount), book: Number(c.book) })),
        });
      });
    return () => { live = false; };
  }, [range, version]);

  // the day rows of one method, each opening where the day before closed (a drawer count restarts the cash)
  const rowsFor = useCallback((m: Method): Row[] => {
    if (!book) return [];
    let running = book.opening[m];
    const out: Row[] = [];
    const active = new Set([...book.days.filter((d) => d.method === m).map((d) => d.day), ...(m === "cash" ? book.cash_counts.map((c) => c.day) : [])]);
    for (const day of [...active].sort()) {
      const counts = m === "cash" ? book.cash_counts.filter((c) => c.day === day) : [];
      for (const c of counts) running = r2(running + c.amount - c.book);
      const d = book.days.find((x) => x.day === day && x.method === m);
      const row: Row = {
        day, opening: running, counted: counts.length ? r2(counts.reduce((s, c) => s + c.amount, 0)) : null,
        rent_in: d?.rent_in ?? 0, deposit_in: d?.deposit_in ?? 0, refund_out: d?.refund_out ?? 0, deposit_out: d?.deposit_out ?? 0, expense_out: d?.expense_out ?? 0,
        closing: 0,
      };
      running = r2(running + row.rent_in + row.deposit_in - row.refund_out - row.deposit_out - row.expense_out);
      row.closing = running;
      out.push(row);
    }
    return out;
  }, [book]);

  const rows = useMemo(() => rowsFor(method), [rowsFor, method]);
  const closingOf = (m: Method) => { const r = rowsFor(m); return r.length ? r[r.length - 1].closing : book?.opening[m] ?? 0; };
  const sum = (k: keyof Row) => r2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
  const moneyIn = r2(sum("rent_in") + sum("deposit_in"));
  const moneyOut = r2(sum("refund_out") + sum("deposit_out") + sum("expense_out"));
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "";

  // the entries behind one day, loaded when the day is opened
  const openDay = async (day: string) => {
    if (open === day) return setOpen(null);
    setOpen(day);
    if (lines[day] !== undefined) return;
    setLines((l) => ({ ...l, [day]: null }));
    try {
      const supabase = createClient();
      const { from, to } = dayRange(day, tz);
      const pays = await pageAll<{ id: string; kind: string; amount: number; paid_at: string; rentals: { token: string; branch_id: string; customers: { full_name: string } | null } | null }>((a, b) => {
        let q = supabase.from("payments").select("id, kind, amount, paid_at, rentals!payments_shop_rental_fkey!inner(token, branch_id, customers!rentals_shop_customer_fkey(full_name))")
          .eq("method", method).gte("paid_at", from).lt("paid_at", to).neq("kind", "deposit_applied");
        if (range.branch) q = q.eq("rentals.branch_id", range.branch);
        return q.order("paid_at").range(a, b);
      });
      let eq = supabase.from("expenses").select("id, category, amount, paid_to, note, created_at").eq("spent_on", day).eq("method", method);
      if (range.branch) eq = eq.eq("branch_id", range.branch);
      const { data: exps, error } = await eq.order("created_at");
      if (error) throw error;
      const out = new Set(["refund", "deposit_refund"]);
      const list: Line[] = [
        ...pays.map((p) => ({ key: p.id, at: p.paid_at, what: `${PAYMENT_LABELS[p.kind] ?? p.kind} · ${p.rentals?.token ?? ""}`,
          who: p.rentals?.customers?.full_name ?? "", amount: out.has(p.kind) ? -Number(p.amount) : Number(p.amount) })),
        ...((exps ?? []) as { id: string; category: string; amount: number; paid_to: string | null; note: string | null; created_at: string }[])
          .map((e) => ({ key: e.id, at: e.created_at, what: `Expense · ${e.category}`, who: [e.paid_to, e.note].filter(Boolean).join(" · "), amount: -Number(e.amount) })),
      ];
      setLines((l) => ({ ...l, [day]: list }));
    } catch (e) {
      toast.error(errorText(e));
      setLines((l) => { const n = { ...l }; delete n[day]; return n; });
    }
  };

  const exportRows = async () => {
    try {
      await downloadSheet(`cashbook-${METHOD_LABELS[method].toLowerCase().replace(" ", "-")}-${range.from}-to-${range.to}.xlsx`,
        ["Date", "Opening", "Drawer count", "Rent received", "Deposits received", "Refunds", "Deposits returned", "Expenses", "Closing"],
        rows.map((r) => [r.day, r.opening, r.counted ?? "", r.rent_in, r.deposit_in, r.refund_out, r.deposit_out, r.expense_out, r.closing]),
        METHOD_LABELS[method]);
    } catch (e) { toast.error(errorText(e)); }
  };

  if (!canManage) return <Panel><p className="text-sm text-muted-foreground">Only owners and managers can see finance reports.</p></Panel>;
  return (
    <>
      <PageHeader title="Finance" subtitle="Money in and out each day, and what should be in the drawer and the bank." />
      <FinanceTabs />
      <RangeBar value={range} onChange={(r) => setRange({ ...r, from: r.from || addDays(r.to, -30) })} today={today}>
        {isOwner ? <button type="button" className={ghostButtonClass} onClick={() => setSetting(true)}><Wallet className="h-4 w-4" /> Opening cash</button> : null}
        <button type="button" className={ghostButtonClass} disabled={!rows.length} onClick={() => void exportRows()}><FileSpreadsheet className="h-4 w-4" /> Excel</button>
      </RangeBar>

      {failed ? <Panel><p role="alert" className="text-sm text-rust">The cashbook could not be loaded. {failed}</p></Panel> : null}

      {/* each account's balance at the end of the dates; the chosen one opens below */}
      <div role="tablist" aria-label="Account" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METHODS.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={method === m} onClick={() => { setMethod(m); setOpen(null); setLines({}); }}
            className={cn("glass p-4 text-left transition-colors", method === m ? "ring-2 ring-gold" : "hover:border-gold/35")}>
            <span className="block text-xs font-medium text-muted-foreground">{METHOD_LABELS[m]} · closing</span>
            <span className={cn("mt-1 block text-xl font-semibold tabular-nums", book && closingOf(m) < 0 && "text-rust")}>{book ? money(closingOf(m)) : "…"}</span>
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Figure label={`${METHOD_LABELS[method]} at the start`} value={book ? money(book.opening[method]) : "…"} hint={fmtDate(range.from)} />
        <Figure label="Money in" value={book ? rupees(moneyIn) : "…"} hint="Rent and deposits received" tone="emerald" />
        <Figure label="Money out" value={book ? rupees(moneyOut) : "…"} hint="Refunds, deposits returned, expenses" tone={moneyOut > 0 ? "rust" : undefined} />
        <Figure label={`${METHOD_LABELS[method]} at the end`} value={book ? money(closingOf(method)) : "…"} hint={fmtDate(range.to)} tone={book && closingOf(method) < 0 ? "rust" : "gold"} />
      </div>
      {method === "cash" && book && rows.some((r) => r.closing < 0) ? (
        <p role="note" className="mb-3 rounded-lg border border-rust/30 bg-rust/5 px-3 py-2 text-sm">
          The cash goes below zero: more cash was paid out than the records show coming in.
          {isOwner ? " Count the drawer and set the Opening cash, so the cashbook starts from what was really there." : " Ask the owner to set the Opening cash from a drawer count."}
        </p>
      ) : method === "cash" ? (
        <p className="mb-3 text-xs text-muted-foreground">Cash starts from the drawer count set under Opening cash. Security deposits are counted because they are in the drawer, but they are not income.</p>
      ) : null}

      {!book && !failed ? <ListSkeleton /> : book && !rows.length ? (
        <Panel><p className="py-6 text-center text-sm text-muted-foreground">No {METHOD_LABELS[method]} money moved in these dates.</p></Panel>
      ) : book ? (
        <div className={tableWrap}>
          <table className="w-full min-w-[900px] text-sm">
            <thead className={theadClass}>
              <tr className="text-left">
                <th className="px-4 py-3">Date</th><th className="px-4 py-3 text-right">Opening</th><th className="px-4 py-3 text-right">Rent in</th>
                <th className="px-4 py-3 text-right">Deposits in</th><th className="px-4 py-3 text-right">Refunds</th><th className="px-4 py-3 text-right">Deposits returned</th>
                <th className="px-4 py-3 text-right">Expenses</th><th className="px-4 py-3 text-right">Closing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <Fragment key={r.day}>
                  <tr className="cursor-pointer hover:bg-accent/40" onClick={() => void openDay(r.day)}>
                    <td className="px-4 py-2.5">
                      <button type="button" aria-expanded={open === r.day} className="inline-flex items-center gap-1.5 font-medium" onClick={(e) => { e.stopPropagation(); void openDay(r.day); }}>
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open === r.day && "rotate-180")} aria-hidden="true" />
                        {fmtDate(r.day)}
                      </button>
                      {r.counted !== null ? <span className="block text-xs text-gold">Drawer counted: {rupees(r.counted)}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{money(r.opening)}</td>
                    <Cell n={r.rent_in} /><Cell n={r.deposit_in} /><Cell n={r.refund_out} out /><Cell n={r.deposit_out} out /><Cell n={r.expense_out} out />
                    <td className={cn("px-4 py-2.5 text-right font-mono font-semibold", r.closing < 0 && "text-rust")}>{money(r.closing)}</td>
                  </tr>
                  {open === r.day ? (
                    <tr className="bg-muted/30">
                      <td colSpan={8} className="px-4 py-3">
                        {lines[r.day] == null ? <p className="text-sm text-muted-foreground">Loading the entries…</p> : !lines[r.day]!.length ? (
                          <p className="text-sm text-muted-foreground">Only the drawer count on this day.</p>
                        ) : (
                          <ul className="divide-y divide-border/70">
                            {lines[r.day]!.map((l) => (
                              <li key={l.key} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                                <span className="min-w-0"><span className="font-medium">{l.what}</span>{l.who ? <span className="text-muted-foreground"> · {l.who}</span> : null}
                                  <span className="ml-2 text-xs text-muted-foreground">{fmtDateTime(l.at, tz).split(",").pop()}</span></span>
                                <span className={cn("font-mono", l.amount < 0 ? "text-rust" : "text-emerald")}>{l.amount < 0 ? "−" : "+"}{rupees(Math.abs(l.amount))}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-4 py-2.5">Total</td><td />
                <Cell n={sum("rent_in")} /><Cell n={sum("deposit_in")} /><Cell n={sum("refund_out")} out /><Cell n={sum("deposit_out")} out /><Cell n={sum("expense_out")} out />
                <td className="px-4 py-2.5 text-right font-mono">{money(closingOf(method))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
      {book ? <p className="mt-2 text-xs text-muted-foreground">Days with no {METHOD_LABELS[method]} movement are left out. Tap a day to see its entries.</p> : null}

      {setting ? <OpeningCashDialog defaultBranch={range.branch} branchName={branchName} today={today}
        onClose={() => setSetting(false)} onDone={() => { setSetting(false); setVersion((v) => v + 1); }} /> : null}
    </>
  );
}

function Cell({ n, out = false }: { n: number; out?: boolean }) {
  return <td className={cn("px-4 py-2.5 text-right font-mono", !n ? "text-muted-foreground/60" : out ? "text-rust" : "")}>{n ? `${out ? "−" : ""}${rupees(n)}` : "—"}</td>;
}

// the owner records the cash counted in a branch's drawer at the start of a day
function OpeningCashDialog({ defaultBranch, branchName, today, onClose, onDone }: {
  defaultBranch: string; branchName: (id: string) => string; today: string; onClose: () => void; onDone: () => void;
}) {
  const { activeBranches } = useShop();
  const [branchId, setBranchId] = useState(defaultBranch || activeBranches[0]?.id || "");
  const [current, setCurrent] = useState<{ amount: number | null; on: string | null } | undefined>(undefined);
  const [amount, setAmount] = useState("");
  const [on, setOn] = useState(today);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCurrent(undefined);
    if (!branchId) return;
    void createClient().from("branches").select("opening_cash, opening_cash_on").eq("id", branchId).maybeSingle().then(({ data }) => {
      const row = data as { opening_cash: number | null; opening_cash_on: string | null } | null;
      setCurrent({ amount: row?.opening_cash == null ? null : Number(row.opening_cash), on: row?.opening_cash_on ?? null });
    });
  }, [branchId]);

  const bad = moneyError(amount, { label: "cash counted", required: true, max: 100_000_000 }) ?? (!on ? "Choose the day it was counted." : null);
  const save = async (clear = false) => {
    if (!clear && bad) return void toast.error(bad);
    setBusy(true);
    try {
      await call("set_opening_cash", { p_branch_id: branchId, p_amount: clear ? null : num(amount), p_on: clear ? null : on });
      toast.success(clear ? "Opening cash cleared" : `Opening cash for ${branchName(branchId)} saved`);
      onDone();
    } catch (e) {
      toast.error(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Opening cash"
      description="Count the cash in the drawer at the start of a day. From that day the cashbook starts the cash at this amount."
      footer={<>
        {current?.amount != null ? <button type="button" className={ghostButtonClass} disabled={busy} onClick={() => void save(true)}>Clear</button> : null}
        <button type="button" className={goldButtonClass} disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : "Save"}</button>
      </>}>
      {activeBranches.length > 1 ? (
        <Field label="Branch">
          <select className={inputClass} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {current === undefined ? "Loading…" : current.amount == null ? "No opening cash set yet: the cash starts at ₹0 from the first payment."
          : `Now: ${rupees(current.amount)} counted on ${fmtDate(current.on)}.`}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cash counted (₹)" error={amount.trim() ? moneyError(amount, { label: "cash counted", max: 100_000_000 }) ?? undefined : undefined}>
          <input className={monoInputClass} inputMode="decimal" maxLength={12} placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Counted at the start of"><DateInput value={on} max={today} onChange={setOn} /></Field>
      </div>
    </Modal>
  );
}
