"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pencil, Search } from "lucide-react";
import { toast } from "sonner";
import { useShop } from "@/lib/shop/ShopContext";
import { call } from "@/lib/shop/api";
import { errorText } from "@/lib/shop/format";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  Field, Modal, PageHeader, Panel, StatusBadge, ghostButtonClass, goldButtonClass, inputClass, monoInputClass,
} from "@/components/shop/ui";

// The shop's settings as one table (docs/SETTINGS_PAGE_PLAN.md). "All branches" edits the shop's values; a branch view
// edits that branch's own values, which win over the shop's (update_branch_settings, migration 038).
type Kind = "switch" | "number" | "money" | "select" | "time" | "text" | "line" | "note";
interface Row {
  key: string;
  section: string;
  label: string;
  hint: string;
  kind: Kind;
  fallback: string | number | boolean;
  /** may differ per branch (the database's _branch_setting_keys) */
  perBranch: boolean;
  options?: [string, string][];
  min?: number;
  max?: number;
  /** a number that may be left empty (saved as null: no limit) */
  optional?: boolean;
  /** a choice saved as a number */
  asNumber?: boolean;
  /** longest text (notes: 200 unless set) */
  maxLen?: number;
  /** a text pattern the database checks too, with its message */
  pattern?: [RegExp, string];
  /** upper-case what is typed */
  upper?: boolean;
  /** shown only when this is true for the shop and the row being edited */
  when?: (v: (key: string) => unknown) => boolean;
}

const LATE = "Late returns";
const PCT_HINT = "100 = one more day's rent per late day; 200 = double fare";

function rowsFor(o: { clothing: boolean; hasRoom: boolean; hasVehicle: boolean }): Row[] {
  const rows: Row[] = [
    { key: "gst_percent", section: "Receipts & tax", label: "GST included in prices (%)", kind: "number", min: 0, max: 28, fallback: 0, perBranch: false,
      hint: "With a GSTIN and a rate above 0, a returned rental gets a tax invoice with CGST and SGST" },
    { key: "sac_code", section: "Receipts & tax", label: "SAC code on tax invoices", kind: "text", fallback: "", perBranch: false,
      hint: "The service code your accountant gives you, 4 to 8 digits. Needed to issue a tax invoice" },
    { key: "receipt_note", section: "Receipts & tax", label: "Receipt note", kind: "note", fallback: "", perBranch: true,
      hint: "Printed at the bottom of receipts and invoices, at most 200 characters" },
    // the bill (migration 040)
    { key: "invoice_timing", section: "Receipts & tax", label: "When the tax invoice is issued", kind: "select", fallback: "after_return", perBranch: false,
      options: [["after_return", "After the return (final amounts)"], ["at_booking", "At booking (charges added later go on a supplementary bill)"]],
      hint: "Always by the Issue tax invoice button on the booking; printing never issues one. A change affects bookings not yet invoiced" },
    { key: "bill_terms", section: "Receipts & tax", label: "Terms on the bill", kind: "note", maxLen: 600, fallback: "", perBranch: false,
      hint: "One per line. The late-fee line is added from the late-return rules, so the bill and the return screen agree" },
    { key: "cancel_keeps_advance", section: "Receipts & tax", label: "Advance is kept when a booking is cancelled", kind: "switch", fallback: false, perBranch: false,
      hint: "Fills in the cancellation fee with what was paid, and prints the rule on the bill" },
    { key: "bank_name", section: "Receipts & tax", label: "Bank name (optional)", kind: "line", maxLen: 60, fallback: "", perBranch: false,
      hint: "Printed on the bill so customers can pay by transfer" },
    { key: "bank_holder", section: "Receipts & tax", label: "Account holder (optional)", kind: "line", maxLen: 80, fallback: "", perBranch: false, hint: "" },
    { key: "bank_last4", section: "Receipts & tax", label: "Last 4 digits of the account (optional)", kind: "text", maxLen: 4, fallback: "", perBranch: false,
      pattern: [/^([0-9]{4})?$/, "Enter only the last 4 digits."], hint: "Only the last 4 digits are kept; prints as XXXX1234. Never enter the full number" },
    { key: "bank_ifsc", section: "Receipts & tax", label: "IFSC (optional)", kind: "line", maxLen: 11, upper: true, fallback: "", perBranch: false,
      pattern: [/^([A-Z]{4}0[A-Z0-9]{6})?$/, "The IFSC is 11 characters, like SBIN0001234."], hint: "" },
  ];
  if (o.clothing) {
    const on = (v: (k: string) => unknown) => v("late_fee_on") !== false;
    rows.push(
      { key: "late_fee_on", section: LATE, label: "Charge late fees on clothes", kind: "switch", fallback: true, perBranch: true,
        hint: "Off: the return screen suggests no late fee" },
      { key: "late_fee_mode", section: LATE, label: "Late fee per day", kind: "select", fallback: "percent", perBranch: true, when: on,
        options: [["percent", "A percentage of the piece's daily price"], ["fixed", "A fixed amount per piece per day"]], hint: "How the fee for each late day is worked out" },
      { key: "late_fee_percent", section: LATE, label: "Percentage of the daily price", kind: "number", min: 0, max: 300, fallback: 100, perBranch: true,
        when: (v) => on(v) && v("late_fee_mode") !== "fixed", hint: PCT_HINT },
      { key: "late_fee_basis", section: LATE, label: "Daily price is", kind: "select", fallback: "catalogue", perBranch: true,
        when: (v) => on(v) && v("late_fee_mode") !== "fixed",
        options: [["catalogue", "The product's catalogue day rate"], ["agreed", "The price agreed on the booking"]], hint: "A negotiated deal counts with the agreed price" },
      { key: "late_fee_fixed", section: LATE, label: "Fixed amount per piece per day (₹)", kind: "money", min: 0, max: 10_000_000, fallback: 0, perBranch: true,
        when: (v) => on(v) && v("late_fee_mode") === "fixed", hint: "Charged for each piece, for each late day" },
      { key: "late_day_count", section: LATE, label: "Count late days as", kind: "select", fallback: "calendar", perBranch: true, when: on,
        options: [["calendar", "Calendar days after the return day"], ["blocks", "Each started 24 hours after the return time"]], hint: "" },
      { key: "late_cutoff_time", section: LATE, label: "Latest return time", kind: "time", fallback: "", perBranch: true,
        when: (v) => on(v) && v("late_day_count") !== "blocks", hint: "Returned after this time counts the return day too. Empty: the whole day is free" },
      { key: "late_cap", section: LATE, label: "Maximum late fee", kind: "select", fallback: "none", perBranch: true, when: on,
        options: [["none", "No maximum"], ["rent_percent", "A percentage of the piece's rent"], ["replacement", "The product's replacement value"]], hint: "" },
      { key: "late_cap_percent", section: LATE, label: "Maximum, % of the rent", kind: "number", min: 0, max: 300, fallback: 100, perBranch: true,
        when: (v) => on(v) && v("late_cap") === "rent_percent", hint: "" },
      { key: "late_clash_action", section: LATE, label: "When a late piece is needed for its next booking", kind: "select", fallback: "swap", perBranch: true,
        options: [["swap", "Offer to swap in another piece first"], ["hold", "Offer to hold the next hand over first"]], hint: "Staff still choose each time" },
      // migration 041
      { key: "auto_cleaning", section: "Cleaning & repairs", label: "Send every returned piece to cleaning", kind: "switch", fallback: true, perBranch: false,
        hint: "A return adds a cleaning job for each piece on Cleaning & repairs; a damaged piece always gets a repair job" },
    );
  } else {
    rows.push({ key: "grace_minutes", section: "Rules", label: "Grace time before late charges (minutes)", kind: "number", min: 0, max: 1440, fallback: 60,
      perBranch: true, hint: "For hourly and nightly rentals" });
    if (o.hasRoom) {
      rows.push(
        { key: "check_in_time", section: "Rules", label: "Usual check-in time", kind: "time", fallback: "14:00", perBranch: true, hint: "Filled in on a new booking" },
        { key: "check_out_time", section: "Rules", label: "Usual check-out time", kind: "time", fallback: "11:00", perBranch: true, hint: "Filled in on a new booking" },
      );
    }
    if (o.hasVehicle) {
      rows.push({ key: "require_licence", section: "Rules", label: "Driving licence required", kind: "switch", fallback: true, perBranch: false,
        hint: "A licence must be on record and checked before a vehicle goes out" });
    }
  }
  // who may do what (migration 039); every default is how the shop worked before, all checked in the database
  const STAFF = "Staff controls";
  const OM: [string, string][] = [["owner", "Only the owner"], ["owner_manager", "The owner and managers"]];
  rows.push(
    { key: "discount_limit_staff", section: STAFF, label: "Most discount staff may give (%)", kind: "number", min: 0, max: 100, optional: true, fallback: "",
      perBranch: false, hint: "Discount plus prices agreed below the list price, as a % of the price. Empty: no limit" },
    { key: "discount_limit_manager", section: STAFF, label: "Most discount a manager may give (%)", kind: "number", min: 0, max: 100, optional: true, fallback: "",
      perBranch: false, hint: "Above it the owner must give it. Empty: no limit" },
    { key: "void_payment_role", section: STAFF, label: "Who may void a wrong payment", kind: "select", fallback: "owner", perBranch: false, options: OM,
      hint: "A voided payment stays on the booking, struck through, with the reason" },
    { key: "waive_late_fee_role", section: STAFF, label: "Who may lower or remove the suggested late fee", kind: "select", fallback: "everyone", perBranch: false,
      options: [["everyone", "Everyone"], ...OM.slice().reverse()], hint: "At the return" },
    { key: "cancel_paid_role", section: STAFF, label: "Who may cancel a booking that has payments", kind: "select", fallback: "everyone", perBranch: false,
      options: [["everyone", "Everyone"], ["owner_manager", "The owner and managers"]], hint: "Cancelling gives the money back" },
    { key: "early_deposit_refund_role", section: STAFF, label: "Who may give a deposit back before the return", kind: "select", fallback: "owner", perBranch: false,
      options: OM, hint: "At or after the return anyone can" },
    { key: "backdate_return_hours", section: STAFF, label: "Back-dated returns need a manager after", kind: "select", fallback: 2, perBranch: false, asNumber: true,
      options: [["2", "2 hours"], ["6", "6 hours"], ["24", "24 hours"]], hint: "A return entered for an earlier time than this needs a manager or the owner" },
  );
  return rows;
}

function show(row: Row, value: unknown): string {
  if (row.kind === "switch") return value ? "On" : "Off";
  if (row.kind === "select") return row.options?.find(([k]) => k === String(value))?.[1] ?? String(value);
  if (value === "" || value === null || value === undefined) return row.kind === "time" ? "None" : row.optional ? "No limit" : "Not set";
  if (row.kind === "money") return `₹${Number(value).toLocaleString("en-IN")}`;
  if (row.key.endsWith("percent") || row.key.startsWith("discount_limit")) return `${value}%`;
  return String(value);
}

// the same limits the database checks (_settings_check, migration 038)
function problem(row: Row, raw: string): string | null {
  if ((row.kind === "number" || row.kind === "money") && !(row.optional && raw.trim() === "")) {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n) || n < (row.min ?? 0) || n > (row.max ?? Infinity)) return `${row.label}: ${row.min ?? 0} to ${row.max}.`;
    if (row.key === "grace_minutes" && !Number.isInteger(n)) return "Grace time is whole minutes.";
    if (row.kind === "money" && Math.round(n * 100) !== n * 100) return "Use rupees and paise.";
  }
  if (row.key === "sac_code" && raw.trim() && !/^\d{4,8}$/.test(raw.trim())) return "The SAC code is 4 to 8 digits.";
  if ((row.kind === "note" || row.kind === "line" || row.kind === "text") && raw.length > (row.maxLen ?? (row.kind === "note" ? 200 : 300))) return `At most ${row.maxLen ?? 200} characters.`;
  if (row.pattern && !row.pattern[0].test(raw.trim())) return row.pattern[1];
  if (row.kind === "time" && row.key !== "late_cutoff_time" && !raw) return "Enter a time.";
  return null;
}

export default function SettingsPage() {
  const { shop, branches, templates, isOwner, businessModule, refresh } = useShop();
  const [branchId, setBranchId] = useState("");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<{ row: Row; value: string | boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // the branch view stays chosen across the reload after a shop-wide save
  useEffect(() => {
    try { setBranchId(sessionStorage.getItem("settings-branch") ?? ""); } catch { /* ignore */ }
  }, []);
  const pickBranch = (id: string) => {
    setBranchId(id);
    try { sessionStorage.setItem("settings-branch", id); } catch { /* ignore */ }
  };

  const branch = branches.find((b) => b.id === branchId && b.is_active);
  const rows = useMemo(() => rowsFor({
    clothing: businessModule === "clothing",
    hasRoom: templates.some((t) => t.kind === "room"),
    hasVehicle: templates.some((t) => t.kind === "vehicle"),
  }), [businessModule, templates]);

  const own = (key: string) => (branch?.settings ?? {})[key];
  const shopValue = (row: Row) => shop.settings?.[row.key] ?? row.fallback;
  const value = (row: Row) => (branch && row.perBranch && own(row.key) !== undefined ? own(row.key) : shopValue(row));
  const read = (key: string) => { const r = rows.find((x) => x.key === key); return r ? value(r) : undefined; };

  if (!isOwner) return <Panel><p className="text-sm text-muted-foreground">Only the owner can change the shop&apos;s settings.</p></Panel>;

  const term = q.trim().toLowerCase();
  const visible = rows.filter((r) => (!r.when || r.when(read))
    && (!term || `${r.label} ${r.hint} ${r.section} ${show(r, value(r))}`.toLowerCase().includes(term)));
  const sections = [...new Set(visible.map((r) => r.section))];
  const onBranch = (r: Row) => !!branch && r.perBranch;

  const open = (row: Row) => {
    const v = value(row);
    setEdit({ row, value: row.kind === "switch" ? Boolean(v) : String(v ?? "") });
  };

  const save = async (clear = false) => {
    if (!edit) return;
    const { row } = edit;
    let v: string | number | boolean | null = edit.value;
    if (!clear && row.kind !== "switch") {
      const bad = problem(row, String(v));
      if (bad) return toast.error(bad);
      v = row.optional && String(v).trim() === "" ? null
        : row.kind === "number" || row.kind === "money" || row.asNumber ? Number(v) : String(v).trim();
    }
    setBusy(true);
    try {
      if (onBranch(row)) {
        await call("update_branch_settings", clear
          ? { p_branch_id: branch!.id, p_clear: [row.key] }
          : { p_branch_id: branch!.id, p_set: { [row.key]: v } });
        await refresh();
        toast.success(clear ? `${branch!.name} now uses the shop's value` : `Saved for ${branch!.name}`);
        setEdit(null);
        setBusy(false);
      } else {
        await call("update_my_shop", { p: { settings: { [row.key]: v } } });
        toast.success("Saved");
        window.location.reload(); // everyone's screens read the shop's rules on load
      }
    } catch (e) {
      toast.error(errorText(e));
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="How the shop works. Pick a branch to give it its own values." />
      <Panel>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Settings for" className="min-w-56 flex-1 sm:flex-none">
            <select className={inputClass} value={branch ? branch.id : ""} onChange={(e) => pickBranch(e.target.value)}>
              <option value="">All branches (shop default)</option>
              {branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input className={cn(inputClass, "pl-9")} placeholder="Search settings" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search settings" />
          </div>
        </div>
        {branch ? (
          <p className="mb-3 text-xs text-muted-foreground">
            Showing {branch.name}. A setting marked &quot;Shop default&quot; follows All branches; change it here to give {branch.name} its own value.
          </p>
        ) : null}

        <div role="table" aria-label="Settings" className="overflow-hidden rounded-lg border border-border">
          <div role="row" className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9rem_3.5rem] gap-3 bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
            <span role="columnheader">Setting</span><span role="columnheader">Value</span>
            <span role="columnheader">Applies to</span><span role="columnheader" className="text-right">Edit</span>
          </div>
          {sections.map((s) => (
            <div key={s} role="rowgroup">
              <div className="border-t border-border bg-surface px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gold">{s}</div>
              {visible.filter((r) => r.section === s).map((r) => (
                <div key={r.key} role="row"
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-border px-4 py-3 text-sm sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9rem_3.5rem] sm:items-center">
                  <div role="cell" className="min-w-0">
                    <p className="font-medium">{r.label}</p>
                    {r.hint ? <p className="text-xs text-muted-foreground">{r.hint}</p> : null}
                  </div>
                  <div role="cell" className="col-start-1 min-w-0 break-words sm:col-start-auto">{show(r, value(r))}</div>
                  <div role="cell" className="col-start-1 sm:col-start-auto">
                    <AppliesTo row={r} branchName={branch?.name} own={branch && r.perBranch ? own(r.key) !== undefined : false} />
                  </div>
                  <div role="cell" className="col-start-2 row-span-3 row-start-1 flex items-start justify-end sm:items-center sm:col-start-auto sm:row-span-1 sm:row-start-auto">
                    <button className={cn(ghostButtonClass, "min-h-11 px-3")} onClick={() => open(r)} aria-label={`Edit ${r.label}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {!visible.length ? <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">No setting matches &quot;{q}&quot;.</p> : null}
        </div>
      </Panel>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.row.label ?? ""}
        description={edit ? (onBranch(edit.row) ? `For ${branch!.name} only.` : branch && !edit.row.perBranch ? "This is set for the whole shop." : "For all branches, unless a branch has its own value.") : undefined}
        footer={<>
          {edit && onBranch(edit.row) && own(edit.row.key) !== undefined ? (
            <button className={ghostButtonClass} disabled={busy} onClick={() => save(true)}>Use shop default</button>
          ) : null}
          <button className={goldButtonClass} disabled={busy} onClick={() => save()}>{busy ? "Saving..." : "Save"}</button>
        </>}>
        {edit ? <Editor row={edit.row} value={edit.value} onChange={(value) => setEdit({ ...edit, value })} /> : null}
      </Modal>
    </>
  );
}

function AppliesTo({ row, branchName, own }: { row: Row; branchName?: string; own: boolean }): ReactNode {
  if (!branchName) return <span className="text-xs text-muted-foreground">All branches</span>;
  if (!row.perBranch) return <StatusBadge tone="muted">Whole shop</StatusBadge>;
  return own ? <StatusBadge tone="gold">{branchName} only</StatusBadge> : <span className="text-xs text-muted-foreground">Shop default</span>;
}

function Editor({ row, value, onChange }: { row: Row; value: string | boolean; onChange: (v: string | boolean) => void }) {
  if (row.kind === "switch") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={Boolean(value)} onCheckedChange={onChange} /> {value ? "On" : "Off"}
      </label>
    );
  }
  const v = String(value);
  return (
    <Field label={row.label} hint={row.hint || undefined}>
      {row.kind === "select" ? (
        <select className={inputClass} value={v} onChange={(e) => onChange(e.target.value)}>
          {row.options?.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      ) : row.kind === "note" ? (
        <textarea className={inputClass} rows={row.maxLen && row.maxLen > 200 ? 6 : 3} maxLength={row.maxLen ?? 200} value={v} onChange={(e) => onChange(e.target.value)} />
      ) : row.kind === "time" ? (
        <div className="flex gap-2">
          <input type="time" className={inputClass} value={v} onChange={(e) => onChange(e.target.value)} />
          {row.key === "late_cutoff_time" && v ? <button type="button" className={ghostButtonClass} onClick={() => onChange("")}>Clear</button> : null}
        </div>
      ) : row.kind === "line" ? (
        <input className={inputClass} maxLength={row.maxLen} value={v} onChange={(e) => onChange(row.upper ? e.target.value.toUpperCase() : e.target.value)} />
      ) : (
        <input className={monoInputClass} maxLength={row.maxLen} inputMode={row.kind === "text" ? "numeric" : "decimal"} value={v} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}
