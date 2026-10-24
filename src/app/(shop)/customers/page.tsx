"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { errorText, fmtDate } from "@/lib/shop/format";
import type { Customer } from "@/lib/shop/types";
import { CustomerForm, customerPayload } from "@/components/shop/CustomerForm";
import { emptyCustomer } from "@/components/shop/CustomerPicker";
import { Modal, PageHeader, StatusBadge, ghostButtonClass, goldButtonClass, inputClass, linkClass, tableWrap, theadClass } from "@/components/shop/ui";

const PAGE = 50;

export default function Customers() {
  const router = useRouter();
  const { shop } = useShop();
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [more, setMore] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ ...emptyCustomer, notes: "" });
  const [busy, setBusy] = useState(false);

  const fetchPage = useCallback(async (from: number) => {
    let q = createClient().from("customers").select("*").order("created_at", { ascending: false }).range(from, from + PAGE - 1);
    if (term) {
      const like = `%${term.replace(/[%_,()*]/g, "")}%`;
      q = q.or(`full_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`);
    }
    const { data, error } = await q;
    if (error) toast.error("Could not load customers: " + errorText(error));
    return (data as Customer[]) ?? [];
  }, [term]);

  useEffect(() => {
    setRows(null);
    void fetchPage(0).then((p) => { setRows(p); setMore(p.length === PAGE); });
  }, [fetchPage]);

  const create = async () => {
    if (!draft.full_name.trim() || !draft.phone.trim()) return toast.error("Enter a name and phone.");
    setBusy(true);
    const { data, error } = await createClient().from("customers").insert({ shop_id: shop.id, ...customerPayload(draft) }).select("id").single();
    setBusy(false);
    if (error) return toast.error(errorText(error));
    toast.success("Customer added");
    router.push(`/customers/${data.id}`);
  };

  return (
    <>
      <PageHeader title="Customers" actions={<button className={goldButtonClass} onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> New customer</button>} />
      <form className="relative mb-4 w-full sm:w-80" onSubmit={(e) => { e.preventDefault(); setTerm(query.trim()); }}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input className={inputClass + " pl-9"} placeholder="Name, phone or email" aria-label="Search customers" value={query}
          onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setTerm(""); }} />
      </form>
      <div className={tableWrap}>
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className={theadClass}><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">ID</th><th className="px-4 py-3">Since</th></tr></thead>
          <tbody className="divide-y divide-border">
            {rows === null ? <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
              : rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No customers{term ? " match" : " yet"}.</td></tr>
              : rows.map((c) => (
                <tr key={c.id} className="hover:bg-black/[0.02]">
                  <td className="px-4 py-2.5">
                    <Link href={`/customers/${c.id}`} className={linkClass}>{c.full_name}</Link>
                    {c.is_blocked ? <StatusBadge tone="rust" className="ml-2">Blocked</StatusBadge> : null}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{c.phone}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.licence_number ? "Licence on file" : c.id_number ? "ID on file" : "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {more ? <button className={ghostButtonClass + " mt-3"} onClick={async () => { const p = await fetchPage(rows?.length ?? 0); setRows([...(rows ?? []), ...p]); setMore(p.length === PAGE); }}>Load more</button> : null}

      <Modal open={adding} onClose={() => setAdding(false)} title="New customer" wide
        footer={<><button className={ghostButtonClass} onClick={() => setAdding(false)}>Cancel</button><button className={goldButtonClass} disabled={busy} onClick={create}>{busy ? "Saving..." : "Add customer"}</button></>}>
        <CustomerForm value={draft} onChange={setDraft} />
      </Modal>
    </>
  );
}
