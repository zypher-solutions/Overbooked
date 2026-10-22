import { useEffect, useMemo, useState } from "react";
import { Search, Calendar, Filter, User, MapPin, Tag, ArrowUpDown } from "lucide-react";
import { useOverbooked } from "@/lib/overbooked/store";
import type { Booking } from "@/lib/overbooked/types";
import { daysBetween, inr, todayISO, fmtDate } from "@/lib/overbooked/utils";
import { addDaysToDate } from "@/lib/overbooked/availability";
import { inputClass, BookingStatusBadge } from "../primitives";
import { DateInput } from "../DateInput";
import { BookingDetailModal } from "../BookingDetailModal";
import { TableSkeleton } from "../Skeleton";
import { useAuth } from "@/lib/overbooked/AuthContext";

export function Bookings({ onNavigate }: { onNavigate?: (page: any) => void }) {
  const { bookings, fetchBookings, branches, locations, isLoading, loadError } = useOverbooked();
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "tomorrow" | "custom">("all");
  const [customDate, setCustomDate] = useState<string>("");
  
  const defaultBranch = (profile?.role === "manager" || profile?.role === "staff") && myBranchName ? myBranchName : "all";
  const [branchFilter, setBranchFilter] = useState<string>(defaultBranch);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    if ((profile?.role === "manager" || profile?.role === "staff") && myBranchName) {
      setBranchFilter(myBranchName);
    }
  }, [profile, myBranchName]);

  useEffect(() => {
    setIsRefreshing(true);
    fetchBookings().finally(() => setIsRefreshing(false));
  }, [fetchBookings]);

  const todayStr = todayISO();
  const tomorrowStr = useMemo(() => addDaysToDate(todayStr, 1), [todayStr]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    
    return bookings.filter((b) => {
      // 1. Status Filter
      if (statusFilter !== "all" && b.status !== statusFilter) {
        return false;
      }

      // 2. Branch Filter
      if (branchFilter !== "all" && b.branchName !== branchFilter && b.branchId !== branchFilter) {
        return false;
      }

      // 3. Pickup Date Filter (derived from booking_items.pickup_date)
      const items = b.items || [];
      const itemPickups = items.map((i) => i.pickupDate);
      
      if (dateFilter === "today") {
        if (!itemPickups.includes(todayStr)) return false;
      } else if (dateFilter === "tomorrow") {
        if (!itemPickups.includes(tomorrowStr)) return false;
      } else if (dateFilter === "custom" && customDate) {
        if (!itemPickups.includes(customDate)) return false;
      }

      // 4. Text Search (Customer Name, Phone, Token, SKU)
      if (q) {
        const nameMatch = b.customerName?.toLowerCase().includes(q);
        const phoneMatch = b.customerPhone?.toLowerCase().includes(q);
        const tokenMatch = b.token?.toLowerCase().includes(q);
        const skuMatch = items.some((i) => i.sku?.toLowerCase().includes(q) || i.productName?.toLowerCase().includes(q));

        if (!nameMatch && !phoneMatch && !tokenMatch && !skuMatch) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      // Primary sort: pickup_date ASC (Upcoming pickups first)
      const pickupA = a.items?.[0]?.pickupDate || a.bookingDate || '9999-99-99';
      const pickupB = b.items?.[0]?.pickupDate || b.bookingDate || '9999-99-99';
      
      if (pickupA !== pickupB) {
        return pickupA.localeCompare(pickupB);
      }
      // Secondary sort: bookingDate / createdAt DESC
      const createdA = a.createdAt || a.bookingDate || '';
      const createdB = b.createdAt || b.bookingDate || '';
      return createdB.localeCompare(createdA);
    });
  }, [bookings, query, statusFilter, dateFilter, customDate, branchFilter, todayStr, tomorrowStr]);

  if (isLoading || isRefreshing) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-48 rounded-md bg-white/[0.02] animate-pulse" />
        <div className="flex gap-4">
          <div className="h-10 flex-1 rounded-md bg-white/[0.02] animate-pulse" />
          <div className="h-10 w-32 rounded-md bg-white/[0.02] animate-pulse" />
        </div>
        <TableSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Title & Count */}
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold">Bookings Management</h1>
        <p className="text-sm text-muted-foreground">
          {filtered.length} booking{filtered.length !== 1 ? "s" : ""} found · Sorted by upcoming pickup date
        </p>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-white/[0.02] p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Search Input */}
          <div className="relative lg:col-span-2">
            <input
              type="text"
              placeholder="Search customer, phone, token (BK-...), SKU..."
              className={inputClass + " pl-9 w-full"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
          </div>

          {/* Status Filter */}
          <select
            className={inputClass}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
          </select>

          {/* Pickup Date Filter */}
          <select
            className={inputClass}
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
          >
            <option value="all">All Pickup Dates</option>
            <option value="today">Pickups Today ({todayStr})</option>
            <option value="tomorrow">Pickups Tomorrow ({tomorrowStr})</option>
            <option value="custom">Custom Date</option>
          </select>

          {/* Branch Filter */}
          <select
            className={inputClass}
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            {visibleBranches.length !== 1 && <option value="all">All Branches</option>}
            {visibleBranches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        {/* Custom Date Picker (if dateFilter === 'custom') */}
        {dateFilter === "custom" && (
          <div className="flex items-center gap-2 pt-1 sm:w-64">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Filter Date:</span>
            <DateInput
              className="text-xs h-9"
              value={customDate}
              onChange={(v) => setCustomDate(v)}
            />
          </div>
        )}
      </div>

      {/* Bookings List Cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-white/[0.01] p-12 text-center space-y-2">
          <Calendar className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
          <h3 className="font-semibold text-lg">No bookings found</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {loadError
              ? "Bookings could not be loaded. Use Retry above."
              : query || statusFilter !== "all" || dateFilter !== "all"
                ? "No bookings match your current search and filter criteria."
                : "No customer bookings have been created yet."}
          </p>
        </div>
      ) : (() => {
        const currentBookings = filtered.filter(b => b.status !== "completed");
        const completedBookings = filtered.filter(b => b.status === "completed");

        const renderBookingCard = (booking: Booking) => {
          const items = booking.items || [];
          const firstItem = items[0];
          const hasCommonDates = items.length > 0 && items.every(
            (i) => i.pickupDate === firstItem.pickupDate && i.returnDate === firstItem.returnDate && i.bufferDays === firstItem.bufferDays
          );

          const pickup = firstItem?.pickupDate || booking.bookingDate;
          const ret = firstItem?.returnDate || "-";
          const buffer = firstItem?.bufferDays || 0;
          const availableAgain = firstItem?.returnDate ? addDaysToDate(firstItem.returnDate, buffer + 1) : "-";
          const totalQty = items.reduce((a, b) => a + b.qty, 0);
          const totalAmount = items.reduce((a, b) => a + b.subtotal, 0);

          const isUpcomingToday = pickup === todayStr && booking.status !== "completed";

          return (
            <div
              key={booking.id}
              onClick={() => setSelectedBooking(booking)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  setSelectedBooking(booking);
                }
              }}
              className={`group cursor-pointer rounded-xl border transition-all duration-200 p-4 space-y-3 bg-white/[0.02] hover:bg-white/[0.04] ${
                isUpcomingToday ? "border-gold/50 shadow-md shadow-gold/5" : "border-border"
              }`}
            >
              {/* Header Row: Token, Status, Branch */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-semibold text-gold text-lg">{booking.token}</span>
                  <BookingStatusBadge status={booking.status} />
                  {isUpcomingToday && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider bg-gold/20 text-gold px-2 py-0.5 rounded border border-gold/30">
                      PICKUP TODAY
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                  <MapPin className="w-3.5 h-3.5 text-gold shrink-0" />
                  <span>{booking.branchName || booking.branchId}</span>
                </div>
              </div>

              {/* Content Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                {/* Customer Info */}
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider block">Customer</span>
                  <p className="font-semibold text-foreground text-sm truncate">{booking.customerName || "Walk-in Customer"}</p>
                  <p className="font-mono text-emerald">{booking.customerPhone}</p>
                </div>

                {/* Operational Pickup / Give Date (PROMINENT) */}
                <div className="space-y-0.5 p-2 rounded-lg border border-border">
                  <span className="text-[10px] uppercase font-semibold text-gold tracking-wider block flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Pickup / Give Date
                  </span>
                  <p className="font-mono text-sm font-semibold text-gold">{fmtDate(pickup)}</p>
                  <p className="text-[10px] text-muted-foreground">Return: {fmtDate(ret)}</p>
                </div>

                {/* Schedule Details */}
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider block">Schedule</span>
                  <p className="font-mono text-muted-foreground">Buffer: <strong className="text-foreground">{buffer} day(s)</strong></p>
                  <p className="font-mono text-muted-foreground">Available: <strong className="text-emerald">{fmtDate(availableAgain)}</strong></p>
                </div>

                {/* Items & Total */}
                <div className="space-y-0.5 sm:text-right">
                  {booking.status === "cancelled" ? (
                    <>
                      <span className="text-[10px] uppercase font-semibold text-rust tracking-wider block">Cancelled</span>
                      <p className="font-mono text-sm font-semibold text-muted-foreground line-through">{inr(booking.total || totalAmount)}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        Fee: <strong className="text-foreground">{inr(booking.cancellationFee || 0)}</strong> · Rem: <strong className="text-emerald">₹0</strong>
                      </p>
                      {(booking.advanceRefund || 0) > 0 && (
                        <p className="font-mono text-[10px] text-muted-foreground">
                          Adv Ref: <strong className="text-emerald">{inr(booking.advanceRefund || 0)}</strong>
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider block">Payment Summary</span>
                      <p className="font-mono text-sm font-semibold text-emerald">{inr(booking.total || totalAmount)}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">Adv: <strong className="text-emerald">{inr(booking.advance || 0)}</strong> · Rem: <strong className="text-gold">{inr(Math.max(0, (booking.total || totalAmount) - (booking.advance || 0)))}</strong></p>
                      <p className="font-mono text-[10px] text-muted-foreground">Dep: {inr(booking.securityDeposit || 0)}</p>
                    </>
                  )}
                </div>
                {/* Assigned Units */}
                <div className="space-y-0.5 col-span-1 sm:col-span-2 lg:col-span-4 border-t border-white/[0.05] pt-2 mt-2">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider block">Assigned Physical Units</span>
                  <div className="flex flex-col gap-1 mt-1">
                    {items.map((item, idx) => (
                      <div key={item.id || idx} className="text-xs text-muted-foreground flex items-baseline gap-2">
                        <span className="font-semibold text-foreground">{item.productName || item.sku}</span>
                        <span className="font-mono text-emerald">
                          {item.assignedUnitSkus?.length ? item.assignedUnitSkus.join(', ') : 'No units assigned'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        };

        return (
          <div className="space-y-8">
            {currentBookings.length > 0 ? (
              <div className="grid gap-4">
                {currentBookings.map(renderBookingCard)}
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-white/[0.01] p-12 text-center space-y-2">
                <Calendar className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
                <h3 className="font-semibold text-lg">No active bookings</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  There are no current bookings matching your criteria.
                </p>
              </div>
            )}

            {completedBookings.length > 0 && (
              <div className="mt-8 pt-6 border-t border-border/50">
                <button
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="flex items-center justify-between w-full group py-2"
                >
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-lg text-muted-foreground group-hover:text-foreground transition-colors">
                      Completed Bookings
                    </h3>
                    <span className="bg-white/[0.05] text-muted-foreground text-xs font-mono px-2 py-1 rounded-md">
                      {completedBookings.length} completed
                    </span>
                  </div>
                  <div className="text-muted-foreground group-hover:text-foreground transition-colors text-sm font-medium flex items-center gap-1">
                    {showCompleted ? "Hide" : "Show"} <ArrowUpDown className="w-4 h-4 opacity-50" />
                  </div>
                </button>
                
                {showCompleted && (
                  <div className="grid gap-4 mt-6 animate-in slide-in-from-top-2 fade-in duration-200">
                    {completedBookings.map(renderBookingCard)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Booking Detail Modal */}
      <BookingDetailModal
        booking={selectedBooking}
        onClose={() => setSelectedBooking(null)}
        onCancelled={() => {
          setSelectedBooking(null);
          fetchBookings();
        }}
        onPickupSuccess={() => {
          if (onNavigate) {
            onNavigate("rentals"); // 'rentals' maps to All Rentals dashboard
          }
        }}
      />
    </div>
  );
}
