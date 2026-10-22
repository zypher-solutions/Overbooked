import { useEffect, useState, useMemo, useRef } from "react";
import { MessageCircle, Trash2, CheckCircle2, Box, Calendar, User, AlertTriangle, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOverbooked } from "@/lib/overbooked/store";
import type { Booking, Rental } from "@/lib/overbooked/types";
import { daysBetween, inr, todayISO, fmtDate } from "@/lib/overbooked/utils";
import { addDaysToDate, getEligiblePhysicalUnits } from "@/lib/overbooked/availability";
import { createClient } from "@/lib/supabase/client";
import { Field, goldButtonClass, inputClass, monoInputClass } from "./primitives";
import { DateInput } from "./DateInput";
import { ConfirmDialog } from "./ConfirmDialog";
import Image from "next/image";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { loadRentalDraft, saveRentalDraft, clearRentalDraft } from "@/lib/overbooked/draftStorage";
import { netTotal, discountError } from "@/lib/overbooked/money";

export function RentalFormModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (rental: Rental) => void;
}) {
  const { cart, removeFromCart, updateCartItemQty, createBooking, branches: allBranches, locations, clearCart } = useOverbooked();
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const visibleBranches = useMemo(() => {
    if (profile?.role === "manager" || profile?.role === "staff") {
      const myBranch = locations.find(l => l.id === profile.branch_id)?.name;
      return myBranch ? [myBranch] : [];
    }
    return allBranches;
  }, [profile, locations, allBranches]);

  const [branch, setBranch] = useState("");

  useEffect(() => {
    if (visibleBranches.length > 0 && (!branch || !visibleBranches.includes(branch))) {
      setBranch(visibleBranches[0]);
    }
  }, [visibleBranches, branch]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [matchedCustomer, setMatchedCustomer] = useState<{ id: string; fullName: string; phone: string } | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [conflictChoice, setConflictChoice] = useState<"entered" | "existing" | null>(null);
  const [pickupDate, setPickupDate] = useState(todayISO());
  const [returnDate, setReturnDate] = useState("");
  const [bufferDays, setBufferDays] = useState(0);
  const [notes, setNotes] = useState("");
  
  const [advancePaid, setAdvancePaid] = useState<number | "">(0);
  const [advancePaymentMethod, setAdvancePaymentMethod] = useState<string>("");
  const [securityDeposit, setSecurityDeposit] = useState<number | "">(0);
  const [securityDepositPaymentMethod, setSecurityDepositPaymentMethod] = useState<string>("");
  const [discount, setDiscount] = useState<number | "">(0);

  // Selected physical units state: key `${cartIdx}_${unitIdx}` -> inventory_item_id
  const [selectedUnits, setSelectedUnits] = useState<Record<string, string>>({});
  const [eligibleUnitsMap, setEligibleUnitsMap] = useState<Record<number, Array<{ id: string; itemSku: string; status: string }>>>({});
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);

  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"Draft saved" | "">("");
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Restore draft or initialize defaults when modal opens
  useEffect(() => {
    if (!open) {
      setDraftLoaded(false);
      setDraftStatus("");
      return;
    }

    const saved = loadRentalDraft(profile?.id);
    if (saved) {
      if (saved.branch && visibleBranches.includes(saved.branch)) {
        setBranch(saved.branch);
      } else if (visibleBranches.length > 0 && (!branch || !visibleBranches.includes(branch))) {
        setBranch(visibleBranches[0]);
      }
      setCustomerName(saved.customerName || "");
      setCustomerPhone(saved.customerPhone || "");
      setPickupDate(saved.pickupDate || todayISO());
      setReturnDate(saved.returnDate || "");
      setBufferDays(typeof saved.bufferDays === "number" ? saved.bufferDays : 0);
      setAdvancePaid(saved.advancePaid !== undefined && saved.advancePaid !== null ? saved.advancePaid : 0);
      setAdvancePaymentMethod(saved.advancePaymentMethod || "");
      setSecurityDeposit(saved.securityDeposit !== undefined && saved.securityDeposit !== null ? saved.securityDeposit : 0);
      setSecurityDepositPaymentMethod(saved.securityDepositPaymentMethod || "");
      setDiscount(typeof saved.discount === "number" ? saved.discount : 0);
      setNotes(saved.notes || "");
      setSelectedUnits(saved.selectedUnits || {});
      setSelectedCustomerId(saved.selectedCustomerId || null);
      setConflictChoice(saved.conflictChoice || null);
      setDraftStatus("Draft saved");
    } else {
      setCustomerName("");
      setCustomerPhone("");
      setPickupDate(todayISO());
      setReturnDate("");
      setBufferDays(0);
      setAdvancePaid(0);
      setAdvancePaymentMethod("");
      setSecurityDeposit(0);
      setSecurityDepositPaymentMethod("");
      setDiscount(0);
      setNotes("");
      setSelectedUnits({});
      setSelectedCustomerId(null);
      setConflictChoice(null);
      setDraftStatus("");
      if (visibleBranches.length > 0 && (!branch || !visibleBranches.includes(branch))) {
        setBranch(visibleBranches[0]);
      }
    }
    setEligibleUnitsMap({});
    setErrors({});
    setConfirmedBooking(null);
    setDraftLoaded(true);
  }, [open, profile?.id]);

  // Debounced autosave to sessionStorage when in-progress form or cart changes
  useEffect(() => {
    if (!open || !draftLoaded || isSubmitting || confirmedBooking) return;
    if (cart.length === 0) return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      saveRentalDraft(
        {
          items: cart,
          branch,
          customerName,
          customerPhone,
          selectedCustomerId,
          conflictChoice,
          pickupDate,
          returnDate,
          bufferDays,
          advancePaid,
          advancePaymentMethod,
          securityDeposit,
          securityDepositPaymentMethod,
          discount,
          notes,
          selectedUnits,
          updatedAt: Date.now(),
        },
        profile?.id
      );
      setDraftStatus("Draft saved");
    }, 400);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    open,
    draftLoaded,
    cart,
    branch,
    customerName,
    customerPhone,
    selectedCustomerId,
    conflictChoice,
    pickupDate,
    returnDate,
    bufferDays,
    advancePaid,
    advancePaymentMethod,
    securityDeposit,
    securityDepositPaymentMethod,
    discount,
    notes,
    selectedUnits,
    profile?.id,
    isSubmitting,
    confirmedBooking,
  ]);

  // Lookup existing customer by phone number without auto-overwriting customer name
  useEffect(() => {
    const clean = customerPhone.replace(/[\s-]/g, "");
    if (clean.length === 10) {
      let isMounted = true;
      supabase
        .from('customers')
        .select('id, full_name, phone')
        .eq('phone', clean)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (isMounted) {
            if (data) {
              setMatchedCustomer({ id: data.id, fullName: data.full_name, phone: data.phone });
            } else {
              setMatchedCustomer(null);
              setSelectedCustomerId(null);
              setConflictChoice(null);
            }
          }
        });
      return () => {
        isMounted = false;
      };
    } else {
      setMatchedCustomer(null);
      setSelectedCustomerId(null);
      setConflictChoice(null);
    }
  }, [customerPhone, supabase]);

  // Fetch eligible physical inventory units whenever branch, dates, or cart changes
  useEffect(() => {
    if (
      !open ||
      !branch ||
      !pickupDate ||
      pickupDate < todayISO() ||
      !returnDate ||
      returnDate < pickupDate ||
      cart.length === 0
    ) {
      setEligibleUnitsMap({});
      return;
    }

    let isMounted = true;
    setLoadingUnits(true);

    const branchObj = branch; // Branch name or ID

    const fetchAllUnits = async () => {
      // Find branch ID if branch is a name or UUID
      let bId = branchObj;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchObj);
      if (isUuid) {
        const { data: bData } = await supabase.from('branches').select('id').eq('id', branchObj).maybeSingle();
        if (bData) bId = bData.id;
      } else {
        const { data: bData } = await supabase.from('branches').select('id').ilike('name', branchObj).maybeSingle();
        if (bData) bId = bData.id;
      }

      const newMap: Record<number, Array<{ id: string; itemSku: string; status: string }>> = {};

      for (let i = 0; i < cart.length; i++) {
        const item = cart[i];
        const units = await getEligiblePhysicalUnits(supabase, {
          branchId: bId,
          variationId: item.variationId || "",
          pickupDate,
          returnDate,
          bufferDays,
        });
        newMap[i] = units;
      }

      if (isMounted) {
        setEligibleUnitsMap(newMap);
        setLoadingUnits(false);

        // Validate physical-unit eligibility, purge stale keys, and invalidate conflicting assignments
        setSelectedUnits((prev) => {
          const cleaned: Record<string, string> = {};
          const usedIds = new Set<string>();

          cart.forEach((item, cIdx) => {
            const eligible = newMap[cIdx] || [];
            for (let uIdx = 0; uIdx < item.qty; uIdx++) {
              const key = `${cIdx}_${uIdx}`;
              const prevId = prev[key];

              if (prevId && eligible.some((u) => u.id === prevId) && !usedIds.has(prevId)) {
                // Previously assigned unit remains eligible: preserve it
                cleaned[key] = prevId;
                usedIds.add(prevId);
              } else if (!prevId) {
                // New slot: auto-assign first available unit
                const freeUnit = eligible.find((u) => !usedIds.has(u.id));
                if (freeUnit) {
                  cleaned[key] = freeUnit.id;
                  usedIds.add(freeUnit.id);
                }
              }
              // If prevId was set but is no longer eligible (conflict/branch change),
              // it is invalidated (not added to cleaned), requiring explicit re-selection.
            }
          });
          return cleaned;
        });
      }
    };

    fetchAllUnits();

    return () => {
      isMounted = false;
    };
  }, [open, branch, pickupDate, returnDate, bufferDays, cart, supabase]);

  // Calculations for Booking
  const bookingDays = pickupDate && returnDate && returnDate >= pickupDate ? daysBetween(pickupDate, returnDate) : 1;
  const bookingGross = cart.reduce((acc, item) => acc + (item.dailyRate * item.qty * bookingDays), 0);
  const discNum = typeof discount === 'number' ? discount : 0;
  // NET amount the customer owes: every figure below (advance limit, remaining, button) uses it
  const bookingTotal = netTotal(bookingGross, Math.max(0, discNum));
  const availableAgainDate = returnDate ? addDaysToDate(returnDate, bufferDays + 1) : "";

  const advNum = typeof advancePaid === 'number' ? advancePaid : 0;
  const depNum = typeof securityDeposit === 'number' ? securityDeposit : 0;
  const remainingAmount = Math.max(0, bookingTotal - advNum);

  const isEmpty = cart.length === 0 && !isSubmitting && !confirmedBooking;

  // Real-time date and product availability state
  const isDateRangeValid = Boolean(
    pickupDate &&
    pickupDate >= todayISO() &&
    returnDate &&
    returnDate >= pickupDate
  );
  const hasCheckedAvailability = isDateRangeValid && !loadingUnits && Object.keys(eligibleUnitsMap).length === cart.length;

  const unavailableItems = useMemo(() => {
    if (!hasCheckedAvailability) return [];
    return cart.filter((item, idx) => {
      const units = eligibleUnitsMap[idx] || [];
      return units.length < item.qty;
    });
  }, [cart, eligibleUnitsMap, hasCheckedAvailability]);

  const isAllAvailable = hasCheckedAvailability && unavailableItems.length === 0;

  // Track all selected unit IDs to prevent duplicate selections across dropdowns
  const allSelectedUnitIds = useMemo(() => {
    return new Set(Object.values(selectedUnits).filter(Boolean));
  }, [selectedUnits]);

  const handleUnitSelect = (cartIdx: number, unitIdx: number, invId: string) => {
    const key = `${cartIdx}_${unitIdx}`;
    setSelectedUnits((prev) => ({
      ...prev,
      [key]: invId,
    }));
  };

  const handlePickupDateChange = (newPickupDate: string) => {
    setPickupDate(newPickupDate);
    const today = todayISO();

    if (newPickupDate && newPickupDate < today) {
      setErrors((prev) => ({
        ...prev,
        pickupDate: "Pickup date cannot be in the past. It must be today or a future date.",
      }));
    } else {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.pickupDate;
        return next;
      });

      if (returnDate && returnDate < newPickupDate) {
        setErrors((prev) => ({
          ...prev,
          returnDate: "Return date cannot be before pickup date",
        }));
      }
    }
  };

  const handleReturnDateChange = (newReturnDate: string) => {
    setReturnDate(newReturnDate);
    const today = todayISO();

    if (newReturnDate && newReturnDate < today) {
      setErrors((prev) => ({
        ...prev,
        returnDate: "Return date cannot be in the past.",
      }));
    } else if (newReturnDate && pickupDate && newReturnDate < pickupDate) {
      setErrors((prev) => ({
        ...prev,
        returnDate: "Return date cannot be before pickup date",
      }));
    } else {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.returnDate;
        return next;
      });
    }
  };

  const submitBooking = async () => {
    const next: Record<string, string> = {};
    if (cart.length === 0) next.general = "Cart is empty";
    if (!branch) next.branch = "Please select a branch.";
    if (!pickupDate) {
      next.pickupDate = "Pickup date is required";
    } else if (pickupDate < todayISO()) {
      next.pickupDate = "Pickup date cannot be in the past. It must be today or a future date.";
    }

    if (!returnDate) {
      next.returnDate = "Return date is required";
    } else if (returnDate < pickupDate) {
      next.returnDate = "Return date cannot be before pickup date";
    } else if (returnDate < todayISO()) {
      next.returnDate = "Return date cannot be in the past";
    }

    if (unavailableItems.length > 0) {
      next.general = "Some items are not available on the selected dates. Please change dates or cart.";
    }
    if (!customerName.trim()) next.customerName = "Customer name is required";
    if (!customerPhone.trim()) {
      next.customerPhone = "Phone number is required";
    } else if (!/^(\+91)?\d{10}$/.test(customerPhone.replace(/[\s-]/g, ""))) {
      next.customerPhone = "Use a 10-digit Indian number";
    }

    if (advNum < 0) next.advancePaid = "Advance paid cannot be negative";
    if (depNum < 0) next.securityDeposit = "Security deposit cannot be negative";
    const discMsg = discountError(bookingGross, discNum);
    if (discMsg) next.discount = discMsg;
    if (advNum > bookingTotal) next.advancePaid = "Advance paid cannot exceed total rental amount.";
    if (advNum > 0 && !advancePaymentMethod) next.advancePaymentMethod = "Advance payment method is required";
    if (depNum > 0 && !securityDepositPaymentMethod) next.securityDepositPaymentMethod = "Security deposit payment method is required";

    // Validate explicit physical unit selection and eligibility for all cart items and units
    const usedUnitIds = new Set<string>();
    for (let cIdx = 0; cIdx < cart.length; cIdx++) {
      const item = cart[cIdx];
      const eligible = eligibleUnitsMap[cIdx] || [];
      for (let uIdx = 0; uIdx < item.qty; uIdx++) {
        const selectedId = selectedUnits[`${cIdx}_${uIdx}`];
        if (!selectedId) {
          next.general = `Please select an eligible physical unit for ${item.productName} (Unit ${uIdx + 1}).`;
          break;
        }
        if (!eligible.some((u) => u.id === selectedId)) {
          next.general = `The physical unit selected for ${item.productName} (Unit ${uIdx + 1}) is no longer available. Please select another unit.`;
          break;
        }
        if (usedUnitIds.has(selectedId)) {
          next.general = `Duplicate physical unit selected for ${item.productName}. Each unit slot must be unique.`;
          break;
        }
        usedUnitIds.add(selectedId);
      }
      if (next.general) break;
    }

    setErrors(next);
    if (Object.keys(next).length) return;

    setIsSubmitting(true);
    try {
      // Map cart items with their assigned physical unit IDs
      const itemsWithPhysicalUnits = cart.map((item, cIdx) => {
        const invIds: string[] = [];
        for (let uIdx = 0; uIdx < item.qty; uIdx++) {
          invIds.push(selectedUnits[`${cIdx}_${uIdx}`]);
        }
        return {
          ...item,
          inventoryItemIds: invIds,
        };
      });

      const booking = await createBooking({
        items: itemsWithPhysicalUnits,
        branch,
        customerId: selectedCustomerId || undefined,
        customerName: customerName.trim(),
        customerPhone: customerPhone.replace(/[\s-]/g, ""),
        pickupDate,
        returnDate,
        bufferDays,
        advancePaid: advNum,
        securityDeposit: depNum,
        discount: discNum,
        advancePaymentMethod: (advancePaymentMethod as any) || undefined,
        securityDepositPaymentMethod: (securityDepositPaymentMethod as any) || undefined,
        notes: notes.trim(),
      });
      clearRentalDraft(profile?.id);
      if (onCreated) {
        onCreated(booking as any);
      } else {
        setConfirmedBooking(booking);
      }
    } catch (e: any) {
      console.error(e);
      setErrors({ general: e.message || "Failed to create booking" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModalClose = () => {
    if (isSubmitting) return;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    if (cart.length > 0 && !confirmedBooking) {
      saveRentalDraft(
        {
          items: cart,
          branch,
          customerName,
          customerPhone,
          selectedCustomerId,
          conflictChoice,
          pickupDate,
          returnDate,
          bufferDays,
          advancePaid,
          advancePaymentMethod,
          securityDeposit,
          securityDepositPaymentMethod,
          discount,
          notes,
          selectedUnits,
          updatedAt: Date.now(),
        },
        profile?.id
      );
    }
    onClose();
  };

  const handleDiscardDraft = () => setConfirmDiscard(true);

  const doDiscardDraft = () => {
    setConfirmDiscard(false);
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    clearRentalDraft(profile?.id);
    clearCart();
    setCustomerName("");
    setCustomerPhone("");
    setPickupDate(todayISO());
    setReturnDate("");
    setBufferDays(0);
    setAdvancePaid(0);
    setAdvancePaymentMethod("");
    setSecurityDeposit(0);
    setSecurityDepositPaymentMethod("");
    setDiscount(0);
    setNotes("");
    setSelectedUnits({});
    setSelectedCustomerId(null);
    setConflictChoice(null);
    setDraftStatus("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleModalClose()}>
      <DialogContent className={`glass-strong ${isEmpty && !confirmedBooking ? "" : "max-h-[90vh] overflow-y-auto w-[calc(100vw-24px)] sm:w-full sm:max-w-2xl p-4 sm:p-6"}`}>
        {confirmedBooking ? (
          <div className="py-4 space-y-4 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald/20 text-emerald flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <DialogTitle className="font-display text-2xl font-semibold">Booking Confirmed!</DialogTitle>
            <div className="bg-white/[0.03] p-4 rounded-xl border border-border text-left space-y-2 text-sm">
              <p><span className="text-muted-foreground">Booking Token:</span> <strong className="font-mono text-gold">{confirmedBooking.token}</strong></p>
              <p><span className="text-muted-foreground">Customer:</span> {confirmedBooking.customerName} ({confirmedBooking.customerPhone})</p>
              <p><span className="text-muted-foreground">Branch:</span> {confirmedBooking.branchName || branch}</p>
              <p><span className="text-muted-foreground">Pickup Date:</span> {fmtDate(confirmedBooking.items[0]?.pickupDate)}</p>
              <p><span className="text-muted-foreground">Return Date:</span> {fmtDate(confirmedBooking.items[0]?.returnDate)}</p>
              <p><span className="text-muted-foreground">Maintenance Buffer:</span> {confirmedBooking.items[0]?.bufferDays} day(s)</p>
              <p><span className="text-muted-foreground">Total Charge:</span> <strong className="font-mono text-emerald">{inr(confirmedBooking.total)}</strong></p>
            </div>
            <button 
              className={goldButtonClass + " w-full"} 
              onClick={() => {
                if (onCreated && confirmedBooking) {
                  onCreated(confirmedBooking as any);
                } else {
                  handleModalClose();
                }
              }}
            >
              Done
            </button>
          </div>
        ) : isEmpty ? (
          <>
            <DialogHeader>
              <DialogTitle>Cart is Empty</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground text-sm py-4">Add items to the cart before booking.</p>
            <button className={goldButtonClass} onClick={handleModalClose}>Close</button>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className="font-display text-2xl font-semibold">
                  Create Booking
                </DialogTitle>
                {draftStatus && (
                  <span className="text-[11px] font-mono text-muted-foreground/80 bg-white/5 border border-border px-2.5 py-0.5 rounded-full">
                    {draftStatus}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Select rental dates first to check product availability.
              </p>
            </DialogHeader>

            {Object.keys(errors).length > 0 && (
              <div className="mb-4 rounded-md border border-rust/50 bg-rust/10 p-3 text-sm text-rust">
                {errors.general || "Please correct the highlighted errors before submitting."}
              </div>
            )}

            {/* Step 1: Rental Schedule & Branch (First!) */}
            <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/[0.02] p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-wider text-gold uppercase flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> 1. Rental Schedule & Branch
                </span>
                {isDateRangeValid && (
                  <span className="text-xs font-mono text-muted-foreground">
                    Duration: <strong className="text-foreground">{bookingDays} day(s)</strong>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Pickup Date" error={errors.pickupDate} hint="Walk-in customers use today's date">
                  <DateInput
                    min={todayISO()}
                    value={pickupDate}
                    onChange={handlePickupDateChange}
                  />
                </Field>

                <Field label="Return Date" error={errors.returnDate} hint={!returnDate ? "Required to check availability" : undefined}>
                  <DateInput
                    min={pickupDate && pickupDate >= todayISO() ? pickupDate : todayISO()}
                    value={returnDate}
                    onChange={handleReturnDateChange}
                  />
                </Field>

                <Field label="Select Branch" error={errors.branch}>
                  {visibleBranches.length === 1 ? (
                    <input className={inputClass} value={visibleBranches[0]} disabled />
                  ) : (
                    <select className={inputClass} value={branch} onChange={(e) => setBranch(e.target.value)}>
                      {visibleBranches.length === 0 ? <option value="">No active branches available</option> : null}
                      {visibleBranches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>

                <Field label="Maintenance Buffer (Days)" error={errors.bufferDays} hint="Post-return cleaning days">
                  <input
                    type="number"
                    min={0}
                    className={monoInputClass}
                    value={bufferDays === 0 ? "" : bufferDays}
                    onChange={(e) => setBufferDays(Number(e.target.value))}
                  />
                </Field>
              </div>

              {returnDate && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2 text-[11px] sm:text-xs pt-3 border-t border-border/40 font-mono text-muted-foreground">
                  <span>Duration: <strong className="text-foreground">{bookingDays} day(s)</strong></span>
                  <span>Buffer: <strong className="text-foreground">{bufferDays} day(s)</strong></span>
                  <span>Available: <strong className="text-emerald">{availableAgainDate ? fmtDate(availableAgainDate) : "-"}</strong></span>
                </div>
              )}
            </div>

            {/* Cart Items & Availability Verification */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-xs tracking-widest text-muted-foreground uppercase">
                  Cart Items ({cart.length})
                </h3>
                {isAllAvailable && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald bg-emerald/10 border border-emerald/30 px-2.5 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3.5 h-3.5" /> All Items In Stock
                  </span>
                )}
              </div>

              {/* Availability Feedback Banners */}
              {!returnDate ? (
                <div className="rounded-lg border border-border/60 bg-white/[0.02] p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gold shrink-0" />
                  <span>Please select a <strong>Return Date</strong> above to check real-time stock availability.</span>
                </div>
              ) : loadingUnits ? (
                <div className="rounded-lg border border-gold/40 bg-gold/5 p-3 text-xs text-gold flex items-center gap-2 animate-pulse">
                  <div className="w-3.5 h-3.5 border-2 border-gold border-t-transparent rounded-full animate-spin shrink-0" />
                  <span>Checking physical unit availability for {fmtDate(pickupDate)} → {fmtDate(returnDate)}...</span>
                </div>
              ) : unavailableItems.length > 0 ? (
                <div className="rounded-lg border border-rust/60 bg-rust/10 p-3.5 text-xs text-rust space-y-1.5">
                  <div className="font-semibold flex items-center gap-1.5 text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" /> Not Available for Selected Dates
                  </div>
                  <p className="text-muted-foreground">
                    The following item(s) do not have enough physical units available from <strong>{fmtDate(pickupDate)}</strong> to <strong>{fmtDate(returnDate)}</strong>:
                  </p>
                  <ul className="list-disc list-inside space-y-0.5 font-medium text-foreground">
                    {unavailableItems.map((item, idx) => (
                      <li key={idx}>
                        {item.productName} ({item.sku}) — needed: {item.qty}, available: {(eligibleUnitsMap[cart.indexOf(item)] || []).length}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Please adjust the rental dates above or choose another product before proceeding.
                  </p>
                </div>
              ) : null}

              {cart.map((item, cIdx) => {
                const eligibleUnits = eligibleUnitsMap[cIdx] || [];

                return (
                  <div key={cIdx} className="bg-white/[0.02] p-4 rounded-xl border border-border shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="relative w-16 h-16 sm:w-14 sm:h-14 rounded-md overflow-hidden bg-muted/50 shrink-0 border border-border/50">
                          <Image src={item.image} alt={item.productName} fill className="object-cover" />
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <p className="text-sm font-semibold text-foreground leading-tight mb-1 break-words">{item.productName}</p>
                          <p className="text-xs font-mono text-foreground/80 leading-tight mb-0.5 break-words">{item.sku}</p>
                          {item.variationName && <p className="text-[11px] leading-tight text-muted-foreground break-words">{item.variationName}</p>}
                        </div>
                        <button type="button" onClick={() => removeFromCart(cIdx)} className="sm:hidden p-2 -mr-2 hover:bg-rust/20 hover:text-rust rounded-md transition-colors cursor-pointer shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="flex items-center justify-between sm:justify-end sm:flex-col sm:items-end gap-1.5 shrink-0 mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-border/30">
                        <p className="text-sm font-mono leading-none">{inr(item.dailyRate)}/d</p>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center bg-muted/70 rounded border border-border">
                            <button type="button" onClick={() => updateCartItemQty(cIdx, item.qty - 1)} className="px-3 py-1.5 sm:px-2 sm:py-0.5 hover:bg-white/10 text-muted-foreground cursor-pointer transition-colors">-</button>
                            <span className="text-sm sm:text-[11px] font-mono w-8 sm:w-6 text-center">{item.qty}</span>
                            <button type="button" onClick={() => updateCartItemQty(cIdx, item.qty + 1)} className="px-3 py-1.5 sm:px-2 sm:py-0.5 hover:bg-white/10 text-muted-foreground cursor-pointer transition-colors">+</button>
                          </div>
                          <button type="button" onClick={() => removeFromCart(cIdx)} className="hidden sm:block p-2 ml-1 hover:bg-rust/20 hover:text-rust rounded-md transition-colors cursor-pointer shrink-0">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Mandatory Physical Unit Selectors for each quantity unit */}
                    {returnDate && pickupDate && (
                      <div className="mt-4 pt-4 border-t border-border/40 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                          <span className="text-[11px] font-bold text-gold uppercase tracking-wider flex items-center gap-1.5">
                            <Box className="w-3.5 h-3.5" /> Assign Physical Unit(s) (Mandatory)
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {eligibleUnits.length} Available for dates
                          </span>
                        </div>

                        {loadingUnits ? (
                          <div className="text-xs text-muted-foreground animate-pulse py-1">Loading physical units...</div>
                        ) : eligibleUnits.length === 0 ? (
                          <div className="text-xs text-rust font-medium bg-rust/10 p-2 rounded border border-rust/30">
                            No physical units available for {item.sku} on the requested dates. Please choose another date or variation.
                          </div>
                        ) : (
                          Array.from({ length: item.qty }).map((_, uIdx) => {
                            const unitKey = `${cIdx}_${uIdx}`;
                            const currentVal = selectedUnits[unitKey] || "";

                            return (
                              <div key={uIdx} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                                {item.qty > 1 && (
                                  <span className="text-[11px] sm:text-xs text-muted-foreground w-auto sm:w-14 font-mono font-medium">Unit {uIdx + 1}:</span>
                                )}
                                <select
                                  className={inputClass + " text-[11px] sm:text-xs font-mono py-2 sm:py-1.5 flex-1 w-full"}
                                  value={currentVal}
                                  onChange={(e) => handleUnitSelect(cIdx, uIdx, e.target.value)}
                                >
                                  <option value="">[ Select Physical Unit ]</option>
                                  {eligibleUnits.map((u) => {
                                    const isSelectedElsewhere = allSelectedUnitIds.has(u.id) && currentVal !== u.id;
                                    return (
                                      <option key={u.id} value={u.id} disabled={isSelectedElsewhere}>
                                        {u.itemSku} {isSelectedElsewhere ? "(Selected for another unit)" : ""}
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Step 2: Customer Information & Payment (Unlocked only when products are available) */}
            {!isAllAvailable ? (
              <div className="rounded-xl border border-dashed border-border/80 bg-white/[0.01] p-6 text-center space-y-2">
                <User className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
                <h4 className="font-semibold text-sm text-foreground">Customer & Payment Details</h4>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  {!returnDate
                    ? "Select pickup and return dates above to verify product availability before entering customer details."
                    : loadingUnits
                    ? "Checking stock availability across physical units..."
                    : "Some cart items are unavailable for the selected dates. Please adjust dates or cart items to unlock customer details."}
                </p>
              </div>
            ) : (
              <div className="space-y-5 rounded-xl border border-border bg-white/[0.02] p-5 shadow-sm animate-in fade-in slide-in-from-top-2">
                <h3 className="font-semibold text-xs tracking-widest text-gold uppercase flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> 2. Customer Information & Payment
                </h3>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Customer Name" error={errors.customerName}>
                    <input
                      className={inputClass}
                      placeholder="e.g. Arjun Kumar"
                      value={customerName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomerName(val);
                        if (selectedCustomerId && matchedCustomer && val.trim().toLowerCase() !== matchedCustomer.fullName.trim().toLowerCase()) {
                          setSelectedCustomerId(null);
                        }
                      }}
                    />
                  </Field>

                  <Field label="Customer Phone" error={errors.customerPhone} hint="Required · 10 digits">
                    <div className="relative">
                      <input
                        className={monoInputClass + " pr-9"}
                        placeholder="9847012345"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                      />
                      <MessageCircle className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-emerald" />
                    </div>
                  </Field>

                  {/* Non-blocking warning if phone matches an existing customer with a different name */}
                  {matchedCustomer && customerName.trim() && matchedCustomer.fullName.trim().toLowerCase() !== customerName.trim().toLowerCase() && (
                    <div className="sm:col-span-2 rounded-lg border border-amber-500/35 bg-amber-500/[0.08] dark:bg-amber-500/10 p-3.5 sm:p-4 text-xs space-y-3 shadow-sm">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <p className="font-semibold text-xs text-amber-950 dark:text-amber-200 leading-snug">
                            This phone number belongs to existing customer{" "}
                            <span className="font-bold underline decoration-amber-600/50 text-amber-950 dark:text-amber-100">
                              {matchedCustomer.fullName}
                            </span>.
                          </p>
                          <p className="text-amber-900/90 dark:text-amber-300/90 text-xs leading-relaxed">
                            Choose how to record the customer for this booking:
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5 pt-2.5 border-t border-amber-500/25 dark:border-amber-500/30">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCustomerId(null);
                            setConflictChoice("entered");
                          }}
                          className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${
                            conflictChoice === "entered"
                              ? "bg-gold text-primary-foreground ring-2 ring-gold ring-offset-2 ring-offset-background font-bold shadow-glow-gold hover:brightness-105"
                              : "bg-gold text-primary-foreground hover:brightness-110 active:scale-[0.99]"
                          }`}
                        >
                          {conflictChoice === "entered" && <Check className="w-3.5 h-3.5 shrink-0" />}
                          Continue with {customerName.trim()}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCustomerName(matchedCustomer.fullName);
                            setSelectedCustomerId(matchedCustomer.id);
                            setConflictChoice("existing");
                          }}
                          className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${
                            conflictChoice === "existing"
                              ? "border-gold bg-gold/15 text-foreground ring-2 ring-gold ring-offset-2 ring-offset-background font-bold shadow-sm"
                              : "border-border/80 dark:border-border bg-background hover:bg-muted text-foreground hover:border-gold/40"
                          }`}
                        >
                          {conflictChoice === "existing" && <Check className="w-3.5 h-3.5 shrink-0" />}
                          Use {matchedCustomer.fullName} instead
                        </button>
                      </div>
                      {conflictChoice === "entered" && (
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-400 pt-0.5">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          <span>
                            Independent customer profile will be preserved for <strong className="font-semibold">{customerName.trim()}</strong> without modifying {matchedCustomer.fullName}&apos;s saved profile.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Suggestion pill when phone matches an existing customer and name has not been entered yet */}
                  {matchedCustomer && !customerName.trim() && (
                    <div className="sm:col-span-2 rounded-lg border border-border/60 bg-white/[0.02] p-2.5 text-xs flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        Found existing customer: <strong className="text-foreground">{matchedCustomer.fullName}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerName(matchedCustomer.fullName);
                          setSelectedCustomerId(matchedCustomer.id);
                        }}
                        className="px-2.5 py-1 text-[11px] font-medium bg-gold/10 hover:bg-gold/20 text-gold rounded border border-gold/30 transition-colors cursor-pointer"
                      >
                        Use {matchedCustomer.fullName}
                      </button>
                    </div>
                  )}

                  {/* Indicator when profile is explicitly linked */}
                  {selectedCustomerId && matchedCustomer && customerName.trim().toLowerCase() === matchedCustomer.fullName.trim().toLowerCase() && (
                    <div className="sm:col-span-2 flex items-center gap-1.5 text-[11px] text-emerald font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Using saved profile: {matchedCustomer.fullName}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:col-span-2">
                    <Field label="Advance Paid (₹)" error={errors.advancePaid} hint="Amount collected upfront from customer">
                      <input
                        type="number"
                        min={0}
                        className={monoInputClass}
                        value={advancePaid === 0 ? "" : advancePaid}
                        onChange={(e) => setAdvancePaid(e.target.value === "" ? "" : Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Advance Payment Method" error={errors.advancePaymentMethod}>
                      <select
                        className={inputClass}
                        value={advancePaymentMethod}
                        onChange={(e) => setAdvancePaymentMethod(e.target.value)}
                      >
                        <option value="">[ Select ]</option>
                        <option value="cash">Cash</option>
                        <option value="upi">UPI</option>
                        <option value="card">Card</option>
                        <option value="bank_transfer">Bank Transfer</option>
                      </select>
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:col-span-2">
                    <Field label="Discount (₹)" error={errors.discount} hint="Negotiated reduction on the rental charge. Fixed at booking.">
                      <input
                        type="number"
                        min={0}
                        className={monoInputClass}
                        value={discount === 0 ? "" : discount}
                        onChange={(e) => setDiscount(e.target.value === "" ? "" : Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Security Deposit (₹)" error={errors.securityDeposit} hint="Tracked separately from rental charge">
                      <input
                        type="number"
                        min={0}
                        className={monoInputClass}
                        value={securityDeposit === 0 ? "" : securityDeposit}
                        onChange={(e) => setSecurityDeposit(e.target.value === "" ? "" : Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Deposit Payment Method" error={errors.securityDepositPaymentMethod}>
                      <select
                        className={inputClass}
                        value={securityDepositPaymentMethod}
                        onChange={(e) => setSecurityDepositPaymentMethod(e.target.value)}
                      >
                        <option value="">[ Select ]</option>
                        <option value="cash">Cash</option>
                        <option value="upi">UPI</option>
                        <option value="card">Card</option>
                        <option value="bank_transfer">Bank Transfer</option>
                      </select>
                    </Field>
                  </div>

                  {/* Payment Summary */}
                  <div className="sm:col-span-2 bg-white/[0.02] p-5 rounded-xl border border-border shadow-sm space-y-4">
                    <p className="font-bold text-gold uppercase tracking-widest text-[11px]">Payment Summary</p>
                    <div className="space-y-2 text-sm font-mono">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground font-sans">Rental Total{discNum > 0 ? ` (after ${inr(discNum)} discount)` : ""}</span>
                        <strong className="text-foreground">{inr(bookingTotal)}</strong>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground font-sans">Advance Paid</span>
                        <strong className="text-emerald">{inr(advNum)}</strong>
                      </div>
                      <div className="flex justify-between items-center border-t border-border/40 pt-3 mt-1">
                        <span className="text-foreground font-semibold font-sans">Remaining Amount</span>
                        <strong className="text-gold font-bold text-base">{inr(remainingAmount)}</strong>
                      </div>
                      <div className="flex justify-between items-center pt-2 text-xs">
                        <span className="text-muted-foreground font-sans">Security Deposit (Tracked Separately)</span>
                        <strong className="text-muted-foreground">{inr(depNum)}</strong>
                      </div>
                    </div>
                  </div>

                  <Field label="Notes" className="sm:col-span-2">
                    <textarea
                      rows={2}
                      className={inputClass}
                      placeholder="Anything staff should remember…"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </Field>
                </div>

                <button
                  className={goldButtonClass + " mt-4 w-full"}
                  onClick={submitBooking}
                  disabled={isSubmitting || cart.length === 0}
                >
                  {isSubmitting ? "Processing Booking..." : `Confirm Booking (${inr(bookingTotal)})`}
                </button>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={handleDiscardDraft}
                    disabled={isSubmitting}
                    className="flex-1 rounded-lg border border-rust/40 bg-rust/10 py-2.5 text-xs font-semibold text-rust hover:bg-rust/20 transition-colors cursor-pointer"
                  >
                    Discard Draft
                  </button>
                  <button
                    type="button"
                    onClick={handleModalClose}
                    disabled={isSubmitting}
                    className="flex-1 rounded-lg border border-border bg-white/[0.04] py-2.5 text-xs font-semibold text-muted-foreground hover:bg-white/[0.08] hover:text-foreground transition-colors cursor-pointer"
                  >
                    Close (Keep Draft)
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
      <ConfirmDialog
        open={confirmDiscard}
        message="Are you sure you want to discard this draft? All cart items and entered customer details will be permanently cleared."
        confirmLabel="Discard"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={doDiscardDraft}
      />
    </Dialog>
  );
}
