"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge, ghostButtonClass, inputClass } from "@/components/overbooked/primitives";
import { PageHeader, fmtWhen, tableWrap, theadClass } from "@/components/zypher/kit";

interface AuditRow {
  id: number;
  shop_id: string | null;
  performed_at: string;
  performed_by: string | null;
  via: "app" | "sql";
  action: string;
  table_name: string;
  record_id: string | null;
  reason: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

const PAGE = 100;
const TABLE_LABELS: Record<string, string> = {
  rentals: "Rental", rental_lines: "Rental line", payments: "Payment", rental_charges: "Charge", products: "Product",
  customers: "Customer", units: "Unit", branches: "Branch",
};

// Every deletion and every owner or Zypher correction, with its reason.
export default function AuditLog() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [shopId, setShopId] = useState("");
  const [shops, setShops] = useState<{ id: string; name: string }[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<number | null>(null);

  const fetchPage = useCallback(async (from: number, shop: string) => {
    let q = createClient().from("audit_log").select("*").order("performed_at", { ascending: false }).range(from, from + PAGE - 1);
    if (shop) q = q.eq("shop_id", shop);
    const { data, error } = await q;
    if (error) {
      toast.error("Could not load the audit log: " + error.message);
      return [];
    }
    return (data as AuditRow[]) ?? [];
  }, []);

  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.from("shops").select("id, name").order("name"),
      supabase.from("profiles").select("id, full_name"),
    ]).then(([s, p]) => {
      setShops((s.data as { id: string; name: string }[]) ?? []);
      setNames(Object.fromEntries(((p.data as { id: string; full_name: string }[]) ?? []).map((x) => [x.id, x.full_name])));
    });
  }, []);

  useEffect(() => {
    setRows(null);
    void fetchPage(0, shopId).then((page) => { setRows(page); setMore(page.length === PAGE); });
  }, [shopId, fetchPage]);

  const loadMore = async () => {
    const page = await fetchPage(rows?.length ?? 0, shopId);
    setRows([...(rows ?? []), ...page]);
    setMore(page.length === PAGE);
  };

  const shopName = (id: string | null) => (id ? shops.find((s) => s.id === id)?.name ?? "—" : "Platform");

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every deletion and every correction, newest first."
        actions={
          <select className={inputClass + " w-auto"} aria-label="Shop" value={shopId} onChange={(e) => setShopId(e.target.value)}>
            <option value="">All shops</option>
            {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        } />
      <div className={tableWrap}>
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className={theadClass}>
            <tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Shop</th><th className="px-4 py-3">What</th>
              <th className="px-4 py-3">By</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows === null ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Nothing recorded yet.</td></tr>
            ) : rows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td className="whitespace-nowrap px-4 py-2.5">{fmtWhen(r.performed_at)}</td>
                  <td className="px-4 py-2.5">{shopName(r.shop_id)}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge tone={r.action === "delete" ? "rust" : "gold"}>{r.action === "delete" ? "Deleted" : "Changed"}</StatusBadge>{" "}
                    {TABLE_LABELS[r.table_name] ?? r.table_name}
                  </td>
                  <td className="px-4 py-2.5">{r.performed_by ? names[r.performed_by] ?? "Unknown" : r.via === "sql" ? "Database" : "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.reason ?? ""}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button className="text-xs text-gold hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      {open === r.id ? "Hide" : "Details"}
                    </button>
                  </td>
                </tr>
                {open === r.id ? (
                  <tr>
                    <td colSpan={6} className="bg-muted/40 px-4 py-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <Json label="Before" value={r.old_data} />
                        <Json label="After" value={r.new_data} />
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {more ? <button className={ghostButtonClass + " mt-3"} onClick={loadMore}>Load more</button> : null}
    </>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
        {value ? JSON.stringify(value, null, 2) : "—"}
      </pre>
    </div>
  );
}
