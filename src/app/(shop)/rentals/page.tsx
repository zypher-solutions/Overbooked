"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_LIST_COLUMNS } from "@/lib/shop/api";
import { errorText } from "@/lib/shop/format";
import { RentalList, type ListRental } from "@/components/shop/RentalList";
import { PageHeader, Panel, ghostButtonClass, goldButtonClass, inputClass } from "@/components/shop/ui";

const TABS = [
  { key: "upcoming", label: "Booked" },
  { key: "out", label: "Out now" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Returned" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const PAGE = 50;

export default function Rentals() {
  const { activeBranches, myBranchId } = useShop();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [branch, setBranch] = useState("");
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<ListRental[] | null>(null);
  const [more, setMore] = useState(false);

  const fetchPage = useCallback(async (from: number) => {
    const supabase = createClient();
    const now = new Date().toISOString();
    let q = supabase.from("rentals").select(RENTAL_LIST_COLUMNS);
    if (tab === "upcoming") q = q.eq("status", "reserved").order("start_at");
    if (tab === "out") q = q.eq("status", "active").order("end_at");
    if (tab === "overdue") q = q.or(`and(status.eq.active,end_at.lt.${now}),and(status.eq.reserved,start_at.lt.${now})`).order("end_at");
    if (tab === "completed") q = q.eq("status", "completed").order("actual_end_at", { ascending: false });
    if (tab === "cancelled") q = q.in("status", ["cancelled", "no_show"]).order("cancelled_at", { ascending: false });
    if (tab === "all") q = q.order("start_at", { ascending: false });
    if (branch) q = q.eq("branch_id", branch);
    if (term) {
      const like = `%${term.replace(/[%_,()*]/g, "")}%`;
      const { data: customers } = await supabase.from("customers").select("id").or(`full_name.ilike.${like},phone.ilike.${like}`).limit(200);
      const ids = (customers ?? []).map((c) => c.id);
      q = ids.length ? q.or(`token.ilike.${like},customer_id.in.(${ids.join(",")})`) : q.ilike("token", like);
    }
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) {
      toast.error("Could not load bookings: " + errorText(error));
      return [];
    }
    return (data as unknown as ListRental[]) ?? [];
  }, [tab, branch, term]);

  useEffect(() => {
    setRows(null);
    void fetchPage(0).then((page) => { setRows(page); setMore(page.length === PAGE); });
  }, [fetchPage]);

  const loadMore = async () => {
    const page = await fetchPage(rows?.length ?? 0);
    setRows([...(rows ?? []), ...page]);
    setMore(page.length === PAGE);
  };

  return (
    <>
      <PageHeader title="Bookings" actions={<Link href="/book" className={goldButtonClass}><CalendarPlus className="h-4 w-4" /> New booking</Link>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={cn("rounded-full border px-3 py-1 text-xs", tab === t.key ? "border-gold/60 bg-gold/10 font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>
        <form className="relative ml-auto w-full sm:w-64" onSubmit={(e) => { e.preventDefault(); setTerm(query.trim()); }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={inputClass + " pl-9"} placeholder="Name, phone or booking no." aria-label="Search bookings" value={query}
            onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setTerm(""); }} />
        </form>
        {!myBranchId && activeBranches.length > 1 ? (
          <select className={inputClass + " w-auto"} aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>
            {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : null}
      </div>
      <Panel>
        {rows === null ? <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>
          : <RentalList rentals={rows} empty={term ? "Nothing matches." : "No bookings here."} />}
      </Panel>
      {more ? <button className={ghostButtonClass + " mt-3"} onClick={loadMore}>Load more</button> : null}
    </>
  );
}
