import { useMemo, useState, useRef, useEffect } from "react";
import { Download, MessageCircle, Filter, ArrowUpDown, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useOverbooked } from "@/lib/overbooked/store";
import type { Booking, PaymentStatus, Rental, RentalItem } from "@/lib/overbooked/types";
import { balanceOf, daysBetween, fmtDate, inr, isOverdue, shiftISO, todayISO, waLink, waReminder } from "@/lib/overbooked/utils";
import {
  PaymentBadge,
  RentalStatusBadge,
  SummaryCard,
  TokenBadge,
  ghostButtonClass,
  goldButtonClass,
  inputClass,
  StatusBadge,
} from "../primitives";
import { DateInput } from "../DateInput";
import { ReturnRentalModal } from "../ReturnRentalModal";
import { RecordPaymentModal } from "../RecordPaymentModal";
import { RentalSummaryModal } from "../RentalSummaryModal";
import { BookingDetailModal } from "../BookingDetailModal";
import { TableSkeleton, SummaryCardsSkeleton } from "../Skeleton";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { generateLedgerPDF } from "@/lib/overbooked/pdf";

const monthStart = () => {
  // India calendar month: a local-midnight toISOString() lands on the previous day's UTC date
  return todayISO().slice(0, 8) + "01";
};

interface Filters {
  from: string;
  to: string;
  branch: string;
  status: string;
  payment: string;
}

type SortKey = "rentDate" | "dueDate" | "customerName" | "token" | "total";

export function Dashboard({ onEdit }: { onEdit: (r: Rental) => void }) {
  const { rentals, bookings, branches, locations, isLoading, fetchInitialData } = useOverbooked();
  const { profile } = useAuth();
  
  const myBranchName = useMemo(() => {
    return locations.find(l => l.id === profile?.branch_id)?.name || null;
  }, [profile, locations]);

  const visibleBranches = useMemo(() => {
    if (profile?.role === "manager" || profile?.role === "staff") {
      return myBranchName ? [myBranchName] : [];
    }
    return branches;
  }, [profile, myBranchName, branches]);
  const [activeTab, setActiveTab] = useState<"rental" | "ledger">("rental");
  const [showFilters, setShowFilters] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("rentDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [returnRentalId, setReturnRentalId] = useState<string | null>(null);
  const [viewRental, setViewRental] = useState<Rental | null>(null);
  const [paymentFor, setPaymentFor] = useState<Rental | null>(null);
  const [viewBooking, setViewBooking] = useState<Booking | null>(null);

  const currentViewRental = useMemo(() => {
    if (!viewRental) return null;
    return rentals.find((r) => r.id === viewRental.id) || viewRental;
  }, [rentals, viewRental]);

  useEffect(() => {
    fetchInitialData({ silent: true });
  }, [fetchInitialData, activeTab]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchInitialData({ silent: true });
      toast.success("Dashboard data refreshed");
    } catch {
      toast.error("Failed to refresh data");
    } finally {
      setIsRefreshing(false);
    }
  };

  const defaultBranch = (profile?.role === "manager" || profile?.role === "staff") && myBranchName ? myBranchName : "all";

  const initial: Filters = {
    from: "",
    to: "",
    branch: defaultBranch,
    status: "all",
    payment: "all",
  };
  
  const [draft, setDraft] = useState<Filters>(initial);
  const [applied, setApplied] = useState<Filters>(initial);

  // Sync draft/applied if myBranchName resolves after initial render
  useEffect(() => {
    if ((profile?.role === "manager" || profile?.role === "staff") && myBranchName) {
      setDraft(prev => ({ ...prev, branch: myBranchName }));
      setApplied(prev => ({ ...prev, branch: myBranchName }));
    }
  }, [profile, myBranchName]);

  // If user explicitly filters by returned status, auto-expand completed section
  useEffect(() => {
    if (applied.status === "returned") {
      setShowCompleted(true);
    }
  }, [applied.status]);

  // Map confirmed, pending & cancelled bookings as unified ledger records
  // Once picked up, a booking becomes 'completed' and is tracked as an active RN rental in `rentals`.
  const activeBookingsAsRentals = useMemo((): Rental[] => {
    return (bookings || [])
      .filter((b) => b.status === "confirmed" || b.status === "pending" || b.status === "cancelled")
      .map((b) => {
        const firstItem = b.items?.[0];
        const rentDate = firstItem?.pickupDate || b.bookingDate || todayISO();
        const dueDate = firstItem?.returnDate || shiftISO(1);
        const advance = b.advance || 0;
        const total = b.total || 0;
        const isCancelled = b.status === "cancelled";
        const paymentStatus: PaymentStatus =
          isCancelled
            ? "paid"
            : advance >= total && total > 0
            ? "paid"
            : advance > 0
            ? "partial"
            : "unpaid";

        const mappedItems: RentalItem[] = (b.items || []).map((bi) => ({
          id: bi.id,
          productId: bi.productId || "",
          productName: bi.productName,
          variationId: bi.variationId,
          sku: bi.sku,
          image: bi.imageUrl || "https://placehold.co/800x800/1c1c1c/888888/png?text=No+Image",
          qty: bi.qty,
          dailyRate: bi.dailyRate,
          assignedUnits: bi.assignedUnits,
          inventoryItemIds: bi.inventoryItemIds,
          assignedUnitSkus: bi.assignedUnitSkus,
        }));

        return {
          id: b.id,
          token: b.token,
          items: mappedItems,
          branch: b.branchName || "",
          customerName: b.customerName || "Unknown",
          customerPhone: b.customerPhone || "",
          rentDate,
          dueDate,
          total,
          advance,
          securityDeposit: b.securityDeposit || 0,
          paymentStatus,
          status: b.status as any,
          notes: b.notes || "",
          isBooking: true,
          bookingRef: b,
          cancellationFee: b.cancellationFee || 0,
          advanceRefund: b.advanceRefund || 0,
          securityDepositRefund: b.securityDepositRefund || 0,
          refundPaymentMethod: b.refundPaymentMethod,
          cancellationReason: b.cancellationReason,
          cancelledAt: b.cancelledAt,
          cancelledBy: b.cancelledBy,
        };
      });
  }, [bookings]);

  const sourceRecords = useMemo(() => {
    if (activeTab === "rental") return rentals;
    return [...rentals, ...activeBookingsAsRentals];
  }, [activeTab, rentals, activeBookingsAsRentals]);

  const rows = useMemo(() => {
    let filtered = sourceRecords;
    
    filtered = filtered.filter((r) => {
      if (applied.from && r.rentDate < applied.from) return false;
      if (applied.to && r.rentDate > applied.to) return false;
      if (applied.branch !== "all" && r.branch !== applied.branch) return false;
      if (applied.payment !== "all" && r.paymentStatus !== applied.payment) return false;
      return true;
    });

    if (applied.status !== "all") {
      filtered = filtered.filter(r => r.status === applied.status);
    }

    return filtered.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
         return sortOrder === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
         return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
  }, [sourceRecords, applied, sortKey, sortOrder]);

  const activeRows = useMemo(() => {
    if (activeTab !== "rental") return rows;
    return rows.filter((r) => r.status !== "returned");
  }, [rows, activeTab]);

  const completedRows = useMemo(() => {
    if (activeTab !== "rental") return [];
    return rows.filter((r) => r.status === "returned");
  }, [rows, activeTab]);

  const active = rentals.filter((r) => r.status === "out");
  const overdue = active.filter(isOverdue);
  const dueToday = active.filter(r => r.dueDate === todayISO());

  const revenue = rows.reduce((a, r) => {
    if (r.status === "cancelled") {
      return a + (r.cancellationFee ?? r.bookingRef?.cancellationFee ?? 0);
    }
    return a + (r.total || 0);
  }, 0);

  const collected = rows.reduce((a, r) => {
    if (r.status === "cancelled") {
      return a + (r.cancellationFee ?? r.bookingRef?.cancellationFee ?? 0);
    }
    return a + (r.advance || 0);
  }, 0);

  const pending = rows.reduce((a, r) => a + balanceOf(r), 0);

  const renderRentalRow = (r: Rental) => {
    const late = isOverdue(r);
    const daysLeft = Math.ceil(
      (new Date(r.dueDate).getTime() - Date.now()) / 86400000
    );
    const isCompleted = r.status === "returned";
    return (
      <tr
        key={r.id}
        className={"transition-colors duration-200 cursor-pointer hover:bg-white/[0.04] " + (late && !isCompleted ? "overdue-row" : "row-zebra")}
        onClick={() => setViewRental(r)}
      >
        <td className="px-3 py-2.5"><TokenBadge token={r.token} /></td>
        <td className="px-3 py-2.5">
          <p className="whitespace-nowrap font-medium">{r.customerName}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{r.customerPhone || "—"}</p>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <img src={r.items?.[0]?.image || "https://placehold.co/64x64/1c1c1c/888888/png?text=No+Image"} alt="Item" width={32} height={32} loading="lazy"
              className="h-8 w-8 rounded-md border border-border object-cover" />
            <div className="min-w-0">
              <p className="font-medium whitespace-nowrap">{r.items?.length === 1 ? r.items[0].productName : `${r.items?.length || 0} items`}</p>
              {r.items?.length === 1 ? (
                r.items[0].assignedUnitSkus && r.items[0].assignedUnitSkus.length > 0 ? (
                  <p className="font-mono text-[11px] text-foreground truncate max-w-[200px]">
                    {r.items[0].assignedUnitSkus.join(", ")}
                  </p>
                ) : (
                  <p className="font-mono text-[11px] text-muted-foreground truncate max-w-[200px]">{r.items[0].sku}</p>
                )
              ) : (
                <p className="font-mono text-[11px] text-muted-foreground">Multiple SKUs</p>
              )}
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{r.branch}</td>
        <td className="px-3 py-2.5 text-center font-mono text-sm font-semibold">{r.items?.reduce((s,i) => s + i.qty, 0) || 0}</td>
        <td className="px-3 py-2.5 whitespace-nowrap text-xs">
          <div className="font-medium">{fmtDate(r.dueDate)}</div>
          {isCompleted ? (
            <div className="text-muted-foreground">
              {r.returnedOn ? `Returned ${fmtDate(r.returnedOn.slice(0, 10))}` : "Returned"}
            </div>
          ) : late ? (
            <StatusBadge tone="rust" className="mt-0.5">OVERDUE</StatusBadge>
          ) : (
            <div className="text-muted-foreground">
              {daysLeft > 0 ? `${daysLeft}d left` : "Due today"}
            </div>
          )}
        </td>
        <td className="px-3 py-2.5">
          <RentalStatusBadge status={r.status} />
        </td>
        <td className="px-3 py-2.5">
          <div className="relative flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {r.status === "out" && (
              <>
                <button className={ghostButtonClass + " border-indigo/40 text-indigo"} onClick={(e) => { e.stopPropagation(); onEdit(r); }}>Edit</button>
                <button className={ghostButtonClass} onClick={(e) => { e.stopPropagation(); setReturnRentalId(r.id); }}>Return</button>
              </>
            )}
            <a href={waLink(r.customerPhone, waReminder(r))} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
              aria-label="WhatsApp reminder"
              className="rounded-md border border-emerald/40 bg-emerald/10 p-1.5 text-emerald transition-colors duration-200 hover:bg-emerald/20">
              <MessageCircle className="h-3.5 w-3.5" />
            </a>
          </div>
        </td>
      </tr>
    );
  };

  const renderRentalCard = (r: Rental) => {
    const isCompleted = r.status === "returned";
    const late = isOverdue(r);
    const daysLeft = Math.ceil(
      (new Date(r.dueDate).getTime() - Date.now()) / 86400000
    );
    return (
      <div
        key={r.id}
        onClick={() => setViewRental(r)}
        className={`glass rounded-xl p-4 cursor-pointer hover:bg-white/[0.04] transition-colors border ${late && !isCompleted ? "border-rust/50 shadow-md shadow-rust/5" : "border-border"}`}
      >
        <div className="flex justify-between items-start mb-3">
          <TokenBadge token={r.token} />
          <RentalStatusBadge status={r.status} />
        </div>
        <div className="space-y-1 mb-4">
          <p className="font-semibold">{r.customerName}</p>
          <p className="font-mono text-xs text-emerald">{r.customerPhone}</p>
        </div>
        <div className="bg-muted/70 rounded-lg p-3 mb-4 flex items-center gap-3">
          <img src={r.items?.[0]?.image || "https://placehold.co/64x64/1c1c1c/888888/png?text=No+Image"} alt="Item" width={40} height={40} loading="lazy"
            className="h-10 w-10 rounded-md border border-border object-cover" />
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{r.items?.length === 1 ? r.items[0].productName : `${r.items?.length || 0} items`}</p>
            {r.items?.length === 1 && r.items[0].assignedUnitSkus && r.items[0].assignedUnitSkus.length > 0 ? (
              <p className="font-mono text-[10px] text-foreground truncate">{r.items[0].assignedUnitSkus.join(", ")}</p>
            ) : null}
            <p className="font-mono text-[10px] text-muted-foreground">{r.items?.reduce((s,i) => s + i.qty, 0) || 0} qty · {r.branch}</p>
          </div>
        </div>
        <div className="flex items-end justify-between border-t border-border/50 pt-3">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground font-semibold">Due Date</p>
            <p className="text-sm font-medium">{fmtDate(r.dueDate)}</p>
            {isCompleted ? (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {r.returnedOn ? `Returned ${fmtDate(r.returnedOn.slice(0, 10))}` : "Returned"}
              </p>
            ) : late ? (
              <p className="text-[10px] text-rust font-bold mt-0.5">OVERDUE</p>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-0.5">{daysLeft > 0 ? `${daysLeft}d left` : "Due today"}</p>
            )}
          </div>
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            {r.status === "out" && (
              <>
                <button className={ghostButtonClass + " px-3 text-indigo border-indigo/40"} onClick={(e) => { e.stopPropagation(); onEdit(r); }}>Edit</button>
                <button className={goldButtonClass + " px-3"} onClick={(e) => { e.stopPropagation(); setReturnRentalId(r.id); }}>Return</button>
              </>
            )}
            <a href={waLink(r.customerPhone, waReminder(r))} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
              aria-label="WhatsApp reminder"
              className="rounded-md border border-emerald/40 bg-emerald/10 p-2 text-emerald transition-colors hover:bg-emerald/20 flex items-center justify-center">
              <MessageCircle className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <header>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold">Dashboard</h1>
        <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-border">
          <button
            onClick={() => setActiveTab("rental")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === "rental" ? "border-b-2 border-gold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Rental Dashboard
          </button>
          {(profile?.role === "super_admin" || profile?.role === "owner" || profile?.role === "manager") && (
            <button
              onClick={() => setActiveTab("ledger")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === "ledger" ? "border-b-2 border-gold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Financial Ledger
            </button>
          )}
        </div>
      </header>

      {isLoading ? (
        <SummaryCardsSkeleton count={activeTab === "rental" ? 2 : 4} />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {activeTab === "rental" ? (
            <>
              <SummaryCard label="Items Currently Out" value={active.reduce((a, r) => a + (r.items?.reduce((sa, i) => sa + i.qty, 0) || 0), 0)} />
              <SummaryCard label="Overdue Items" value={overdue.length} tone="rust" />
            </>
          ) : (
            <>
              <SummaryCard label="Total Revenue" value={inr(revenue)} tone="gold" />
              <SummaryCard label="Collected" value={inr(collected)} tone="emerald" />
              <SummaryCard label="Pending Balance" value={inr(pending)} tone={pending > 0 ? "rust" : "emerald"} />
              <SummaryCard label="Record Count" value={rows.length} />
            </>
          )}
        </div>
      )}

      {!isLoading && activeTab === "rental" && (
        <div className="mt-8 glass rounded-xl p-4 sm:p-6">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Daily Alerts Action Center
          </h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Items that need your attention today. Click the WhatsApp icon to send a standardized reminder.
          </p>
          
          {overdue.length === 0 && dueToday.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <p className="text-sm font-medium text-foreground">All clear</p>
              <p className="text-xs text-muted-foreground mt-1">No rentals are due today or overdue.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {overdue.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium tracking-wide uppercase text-foreground">Overdue ({overdue.length})</h4>
                <div className="flex flex-col gap-2">
                  {overdue.map(r => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 border border-border">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{r.customerName}</span>
                        <span className="text-xs text-muted-foreground">{r.items?.length === 1 ? r.items[0].productName : `${r.items?.length || 0} items`} (Due: {fmtDate(r.dueDate)})</span>
                      </div>
                      <a href={waLink(r.customerPhone, waReminder(r))} target="_blank" rel="noreferrer" aria-label="WhatsApp reminder" className="rounded-md bg-emerald/10 p-2 text-emerald transition-colors hover:bg-emerald/20 border border-emerald/20">
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {dueToday.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium tracking-wide uppercase text-foreground">Due Today ({dueToday.length})</h4>
                <div className="flex flex-col gap-2">
                  {dueToday.map(r => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 border border-border">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{r.customerName}</span>
                        <span className="text-xs text-muted-foreground">{r.items?.length === 1 ? r.items[0].productName : `${r.items?.length || 0} items`} (Due Today)</span>
                      </div>
                      <a href={waLink(r.customerPhone, waReminder(r))} target="_blank" rel="noreferrer" aria-label="WhatsApp reminder" className="rounded-md bg-emerald/10 p-2 text-emerald transition-colors hover:bg-emerald/20 border border-emerald/20">
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">
            {activeTab === "rental" ? "Active Rentals" : "Ledger Records"}
          </h2>
          {activeTab === "rental" && (
            <span className="bg-white/[0.05] text-muted-foreground text-xs font-mono px-2 py-1 rounded-md">
              {activeRows.length} active
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
          <select
            className={inputClass + " w-36 py-1.5"}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="rentDate">Sort by Date</option>
            <option value="dueDate">Sort by Due Date</option>
            <option value="customerName">Sort by Name</option>
            <option value="token">Sort by Token</option>
            <option value="total">Sort by Amount</option>
          </select>
          <button 
            className={ghostButtonClass + " px-2 py-1.5"} 
            onClick={() => setSortOrder(o => o === "asc" ? "desc" : "asc")}
            title="Toggle Sort Order"
          >
            <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          </button>
          <button
            className={ghostButtonClass + " py-1.5 px-3"}
            disabled={isRefreshing}
            onClick={handleRefresh}
            title="Sync Latest Data"
          >
            <RefreshCw className={"h-4 w-4 mr-2" + (isRefreshing ? " animate-spin text-gold" : "")} />
            {isRefreshing ? "Syncing…" : "Refresh"}
          </button>
          <button
            className={ghostButtonClass + " py-1.5"}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-2" /> Filter
          </button>
          {activeTab === "ledger" && (
            <button
              className={ghostButtonClass + " py-1.5 px-3"}
              disabled={pdfLoading}
              onClick={async () => {
                setPdfLoading(true);
                try {
                  await generateLedgerPDF(rows, applied);
                } finally {
                  setPdfLoading(false);
                }
              }}
            >
              <Download className={"h-4 w-4 mr-2" + (pdfLoading ? " animate-spin" : "")} />
              {pdfLoading ? "Generating…" : "Export PDF"}
            </button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="glass mt-4 flex flex-wrap items-end gap-3 p-3 animate-in fade-in slide-in-from-top-2">
          <label className="text-xs text-muted-foreground">
            <span className="mb-1 block">From</span>
            <DateInput
              className="w-36 text-xs h-9"
              value={draft.from}
              onChange={(v) => setDraft({ ...draft, from: v })}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            <span className="mb-1 block">To</span>
            <DateInput
              className="w-36 text-xs h-9"
              value={draft.to}
              onChange={(v) => setDraft({ ...draft, to: v })}
            />
          </label>
          <select
            className={inputClass + " w-36"}
            value={draft.branch}
            onChange={(e) => setDraft({ ...draft, branch: e.target.value })}
          >
            {visibleBranches.length !== 1 && <option value="all">All branches</option>}
            {visibleBranches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select
            className={inputClass + " w-36"}
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            <option value="all">All status</option>
            <option value="confirmed">Booked (Awaiting Pickup)</option>
            <option value="out">Active Rentals (Out)</option>
            <option value="returned">Returned</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            className={inputClass + " w-32"}
            value={draft.payment}
            onChange={(e) => setDraft({ ...draft, payment: e.target.value })}
          >
            <option value="all">All payments</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid</option>
          </select>
          <button className={goldButtonClass} onClick={() => setApplied(draft)}>
            Apply
          </button>
        </div>
      )}

      {/* DESKTOP VIEW (Tables) */}
      <div className="glass mt-6 overflow-x-auto hidden 2xl:block">
        {isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={8} columns={8} />
          </div>
        ) : activeTab === "rental" ? (
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
              <tr className="text-left text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
                {["Token", "Customer", "Item", "Branch", "Qty", "Due Date", "Status", "Actions"].map((h) => (
                  <th key={h} className="px-3 py-3 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeRows.map(renderRentalRow)}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
              <tr className="text-left text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
                {["Token", "Customer", "Item", "Period", "Total", "Advance", "Balance", "Payment", "Status"].map((h) => (
                  <th key={h} className="px-3 py-3 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const bal = balanceOf(r);
                const days = daysBetween(r.rentDate, r.dueDate);
                return (
                  <tr
                    key={r.id}
                    className={"transition-colors duration-200 hover:bg-white/[0.04] row-zebra cursor-pointer"}
                    onClick={() => {
                      if (r.isBooking && r.bookingRef) {
                        setViewBooking(r.bookingRef);
                      } else {
                        setViewRental(r);
                      }
                    }}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <TokenBadge token={r.token} />
                        {r.isBooking && (
                          <span className="text-[10px] uppercase font-semibold text-gold bg-gold/10 border border-gold/30 px-1.5 py-0.5 rounded">
                            Booked
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="whitespace-nowrap font-medium">{r.customerName}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{r.customerPhone || "—"}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium whitespace-nowrap">{r.items?.length === 1 ? r.items[0].productName : `${r.items?.length || 0} items`}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{r.items?.length === 1 ? r.items[0].sku : "Multiple SKUs"}</p>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                      <div>{fmtDate(r.rentDate)} → {fmtDate(r.dueDate)}</div>
                      <div className="text-muted-foreground">{days} day{days !== 1 ? "s" : ""} · {inr(r.items?.reduce((acc, item) => acc + item.dailyRate * item.qty, 0) || 0)}/day</div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-sm font-semibold whitespace-nowrap">
                      {r.status === "cancelled" ? (
                        <div>
                          <span>{inr(r.cancellationFee ?? r.bookingRef?.cancellationFee ?? 0)}</span>
                          <span className="text-[10px] text-muted-foreground block line-through">
                            Orig: {inr(r.total || 0)}
                          </span>
                        </div>
                      ) : (
                        inr(r.total || 0)
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-sm text-emerald whitespace-nowrap">
                      {r.status === "cancelled" ? (
                        <div>
                          <span>{inr(r.advance || 0)}</span>
                          {(r.advanceRefund ?? r.bookingRef?.advanceRefund ?? 0) > 0 && (
                            <span className="text-[10px] text-rust block">
                              Ref: -{inr(r.advanceRefund ?? r.bookingRef?.advanceRefund ?? 0)}
                            </span>
                          )}
                        </div>
                      ) : (
                        inr(r.advance || 0)
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-sm whitespace-nowrap">
                      <span className={bal > 0 ? "text-rust font-semibold" : "text-emerald font-medium"}>
                        {r.status === "cancelled" ? "₹0 (Closed)" : inr(bal)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {r.status === "cancelled" ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-white/5 border border-border px-2 py-0.5 rounded">
                          Settled
                        </span>
                      ) : r.isBooking ? (
                        <PaymentBadge status={r.paymentStatus} />
                      ) : (
                        <div className="flex items-center gap-2">
                          <PaymentBadge status={r.paymentStatus} />
                          {bal > 0 && (
                            <button
                              type="button"
                              className="rounded-sm border border-gold/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold transition-colors hover:bg-gold/10"
                              onClick={() => setPaymentFor(r)}
                            >
                              Record payment
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5"><RentalStatusBadge status={r.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!isLoading && (activeTab === "rental" ? activeRows.length === 0 : rows.length === 0) ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {activeTab === "rental" ? "No active rentals found." : "No records found."}
          </p>
        ) : null}
      </div>

      {/* MOBILE/TABLET VIEW (Cards) */}
      <div className="2xl:hidden mt-6 space-y-8">
        {isLoading ? (
          <div className="glass p-4 rounded-xl">
            <TableSkeleton rows={4} columns={1} />
          </div>
        ) : activeTab === "rental" ? (
          activeRows.length === 0 ? (
            <div className="glass px-4 py-10 text-center text-sm text-muted-foreground rounded-xl">
              No active rentals found.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {activeRows.map(renderRentalCard)}
            </div>
          )
        ) : rows.length === 0 ? (
          <div className="glass px-4 py-10 text-center text-sm text-muted-foreground rounded-xl">
            No records found.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {rows.map((r) => {
              const bal = balanceOf(r);
              const days = daysBetween(r.rentDate, r.dueDate);
              return (
                <div
                  key={r.id}
                  onClick={() => {
                    if (r.isBooking && r.bookingRef) {
                      setViewBooking(r.bookingRef);
                    } else {
                      setViewRental(r);
                    }
                  }}
                  className="glass rounded-xl p-4 cursor-pointer hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex flex-wrap gap-2 justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      <TokenBadge token={r.token} />
                      {r.isBooking && (
                        <span className="text-[9px] uppercase font-semibold text-gold bg-gold/10 border border-gold/30 px-1.5 py-0.5 rounded">
                          Booked
                        </span>
                      )}
                    </div>
                    <RentalStatusBadge status={r.status} />
                  </div>
                  <div className="space-y-1 mb-4">
                    <p className="font-semibold">{r.customerName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{r.items?.length === 1 ? r.items[0].productName : `${r.items?.length || 0} items`}</p>
                  </div>
                  <div className="bg-muted/70 rounded-lg p-3 mb-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground font-semibold">Period</p>
                      <p className="font-medium mt-0.5">{fmtDate(r.rentDate)}</p>
                      <p className="font-medium">{fmtDate(r.dueDate)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-muted-foreground font-semibold">Total</p>
                      <p className="font-mono font-semibold text-sm mt-0.5">{inr(r.total || 0)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 pt-1 border-t border-border/50">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground font-semibold">Payment</span>
                      <div onClick={(e) => e.stopPropagation()}>
                        {r.isBooking ? (
                          <PaymentBadge status={r.paymentStatus} />
                        ) : (
                          <div className="flex items-center gap-2">
                          <PaymentBadge status={r.paymentStatus} />
                          {bal > 0 && (
                            <button
                              type="button"
                              className="rounded-sm border border-gold/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold transition-colors hover:bg-gold/10"
                              onClick={() => setPaymentFor(r)}
                            >
                              Record payment
                            </button>
                          )}
                        </div>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground font-semibold">Balance</span>
                      <span className={`font-mono text-sm ${bal > 0 ? "text-rust font-semibold" : "text-emerald font-medium"}`}>{inr(bal)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION B: COMPLETED RENTALS */}
      {activeTab === "rental" && !isLoading && (
        <div className="mt-8 pt-6 border-t border-border/50">
          <button
            type="button"
            onClick={() => setShowCompleted(!showCompleted)}
            className="flex items-center justify-between w-full group py-2"
          >
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-lg text-muted-foreground group-hover:text-foreground transition-colors">
                Completed Rentals
              </h3>
              <span className="bg-white/[0.05] text-muted-foreground text-xs font-mono px-2 py-1 rounded-md">
                {completedRows.length} completed
              </span>
            </div>
            <div className="text-muted-foreground group-hover:text-foreground transition-colors text-sm font-medium flex items-center gap-1">
              {showCompleted ? "Hide" : "Show"} <ArrowUpDown className="w-4 h-4 opacity-50" />
            </div>
          </button>

          {showCompleted && (
            <div className="mt-4 animate-in slide-in-from-top-2 fade-in duration-200">
              {completedRows.length === 0 ? (
                <div className="glass px-4 py-8 text-center text-sm text-muted-foreground rounded-xl">
                  No completed rentals found.
                </div>
              ) : (
                <>
                  {/* DESKTOP VIEW: Completed Rentals Table */}
                  <div className="glass overflow-x-auto hidden 2xl:block">
                    <table className="w-full min-w-[1000px] text-sm">
                      <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
                        <tr className="text-left text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
                          {["Token", "Customer", "Item", "Branch", "Qty", "Due Date", "Status", "Actions"].map((h) => (
                            <th key={h} className="px-3 py-3 font-medium whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {completedRows.map(renderRentalRow)}
                      </tbody>
                    </table>
                  </div>

                  {/* MOBILE/TABLET VIEW: Completed Rentals Cards */}
                  <div className="2xl:hidden grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {completedRows.map(renderRentalCard)}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <RecordPaymentModal
        open={!!paymentFor}
        rental={paymentFor ? rentals.find((x) => x.id === paymentFor.id) || paymentFor : null}
        onClose={() => setPaymentFor(null)}
      />
      <ReturnRentalModal
        open={!!returnRentalId}
        rental={rentals.find((r) => r.id === returnRentalId) || null}
        onClose={() => setReturnRentalId(null)}
      />

      <RentalSummaryModal
        open={!!currentViewRental}
        rental={currentViewRental}
        onClose={() => setViewRental(null)}
      />

      <BookingDetailModal
        booking={viewBooking}
        onClose={() => setViewBooking(null)}
        onPickupSuccess={() => {
          fetchInitialData({ silent: true });
        }}
        onCancelled={() => {
          fetchInitialData({ silent: true });
        }}
      />
    </div>
  );
}
