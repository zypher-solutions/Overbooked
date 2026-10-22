import { netTotal } from './money';
import { SupabaseClient } from '@supabase/supabase-js';
import { daysBetween, todayISO } from './utils';

export interface AvailabilityParams {
  branchId: string;
  variationId: string;
  pickupDate: string; // YYYY-MM-DD
  returnDate: string; // YYYY-MM-DD
  bufferDays?: number;
  requestedQty?: number;
}

export interface AvailabilityResult {
  total_capacity: number;
  maintenance_quantity: number;
  usable_capacity: number;
  booked_quantity: number;
  currently_unavailable_quantity: number;
  available_quantity: number;
  can_book: boolean;
  blocked_start: string;
  blocked_end: string;
}

export interface CreateBookingParams {
  token?: string;
  customerId: string;
  branchId: string;
  bookingDate?: string;
  status?: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  notes?: string;
  createdBy?: string;
  total?: number;
  advance?: number;
  securityDeposit?: number;
  /** Negotiated discount in rupees; params.total must already be the NET total (items - discount). */
  discount?: number;
  advancePaymentMethod?: string;
  securityDepositPaymentMethod?: string;
  items: Array<{
    productId?: string;
    variationId: string;
    productName: string;
    sku: string;
    imageUrl?: string;
    qty: number;
    dailyRate: number;
    pickupDate: string;
    returnDate: string;
    bufferDays?: number;
    subtotal?: number;
    inventoryItemIds?: string[];
  }>;
}

let atomicMutexLock = Promise.resolve();

/**
 * Calculates calendar date strings (YYYY-MM-DD) inclusive from start to end date.
 * Operates strictly on calendar dates (IST / local) without timezone shifts.
 */
export function getDateRangeArray(startDateStr: string, endDateStr: string): string[] {
  const dates: string[] = [];
  const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);

  const current = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));

  while (current <= end) {
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, '0');
    const d = String(current.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Adds buffer days to a YYYY-MM-DD date string.
 */
export function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const resY = dt.getUTCFullYear();
  const resM = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const resD = String(dt.getUTCDate()).padStart(2, '0');
  return `${resY}-${resM}-${resD}`;
}

/**
 * Check date-scoped availability for a branch and variation.
 * Uses PostgreSQL RPC if available, or pure TypeScript database-backed logic with fallback.
 */
export async function checkAvailability(
  supabase: SupabaseClient,
  params: AvailabilityParams
): Promise<AvailabilityResult> {
  const {
    branchId,
    variationId,
    pickupDate,
    returnDate,
    bufferDays = 0,
    requestedQty = 1,
  } = params;

  if (pickupDate < todayISO()) {
    throw new Error('Pickup date cannot be in the past');
  }
  if (pickupDate > returnDate) {
    throw new Error('Pickup date cannot be after return date');
  }
  if (bufferDays < 0) {
    throw new Error('Buffer days cannot be negative');
  }

  // Try PostgreSQL RPC first - BYPASSED TO FORCE CORRECT TS IMPLEMENTATION
  /*
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('check_availability', {
      p_branch_id: branchId,
      p_variation_id: variationId,
      p_pickup_date: pickupDate,
      p_return_date: returnDate,
      p_buffer_days: bufferDays,
    });

    if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
      const row = rpcData[0];
      const availableCap = Number(row.available_capacity ?? 0);
      const totalCap = Number(row.total_capacity ?? 0);
      const maintQty = Number(row.unavailable_maintenance ?? 0);
      const bookedQty = Number(row.unavailable_booking ?? 0);
      return {
        total_capacity: totalCap,
        maintenance_quantity: maintQty,
        usable_capacity: Math.max(0, totalCap - maintQty),
        booked_quantity: bookedQty,
        currently_unavailable_quantity: totalCap - availableCap,
        available_quantity: availableCap,
        can_book: availableCap >= requestedQty,
        blocked_start: pickupDate,
        blocked_end: addDaysToDate(returnDate, bufferDays),
      };
    } else if (!rpcError && rpcData && typeof rpcData === 'object' && !Array.isArray(rpcData)) {
      return rpcData as AvailabilityResult;
    }
  } catch (e) {
    // Fall back to TS implementation
  }
  */

  const blockedStart = pickupDate;
  const blockedEnd = addDaysToDate(returnDate, bufferDays);

  // 1. Fetch total capacity and maintenance
  const { data: invItems, error: invErr } = await supabase
    .from('inventory_items')
    .select('id, status')
    .eq('variation_id', variationId)
    .eq('branch_id', branchId)
    .neq('status', 'lost');

  if (invErr) throw new Error('Failed to fetch inventory capacity: ' + invErr.message);

  const totalCapacity = invItems?.length || 0;
  const maintenanceQty = invItems?.filter((i) => i.status === 'maintenance').length || 0;
  const usableCapacity = Math.max(0, totalCapacity - maintenanceQty);

  // 2. Fetch available physical units for this date range
  const eligibleUnits = await getEligiblePhysicalUnits(supabase, {
    branchId,
    variationId,
    pickupDate,
    returnDate,
    bufferDays,
  });

  const availableQty = eligibleUnits.length;
  const consumed = usableCapacity - availableQty;

  return {
    total_capacity: totalCapacity,
    maintenance_quantity: maintenanceQty,
    usable_capacity: usableCapacity,
    booked_quantity: consumed, // Approximation since consumed covers both bookings and rentals
    currently_unavailable_quantity: consumed,
    available_quantity: availableQty,
    can_book: availableQty >= requestedQty,
    blocked_start: blockedStart,
    blocked_end: blockedEnd,
  };
}

export interface EligibleUnitParams {
  branchId: string;
  variationId: string;
  pickupDate: string; // YYYY-MM-DD
  returnDate: string; // YYYY-MM-DD
  bufferDays?: number;
}

/**
 * Fetch eligible physical inventory units for a variation and branch during requested date window.
 */
export async function getEligiblePhysicalUnits(
  supabase: SupabaseClient,
  params: EligibleUnitParams
): Promise<Array<{ id: string; itemSku: string; status: string }>> {
  const { branchId: rawBranchId, variationId, pickupDate, returnDate, bufferDays = 0 } = params;

  let branchId = rawBranchId;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawBranchId);
  if (!isUuid) {
    const { data: bData } = await supabase.from('branches').select('id').ilike('name', rawBranchId).maybeSingle();
    if (bData) branchId = bData.id;
  }

  // 1. Try RPC first - BYPASSED TO FORCE CORRECT TS IMPLEMENTATION
  /*
  try {
    const { data, error } = await supabase.rpc('get_eligible_physical_units', {
      p_branch_id: branchId,
      p_variation_id: variationId,
      p_pickup_date: pickupDate,
      p_return_date: returnDate,
      p_buffer_days: bufferDays,
    });
    if (!error && Array.isArray(data)) {
      return data.map((d: any) => ({
        id: d.id,
        itemSku: d.item_sku,
        status: d.status,
      }));
    }
  } catch (e) {
    // Fall back to TS
  }
  */

  const blockedStart = pickupDate;
  const blockedEnd = addDaysToDate(returnDate, bufferDays);

  // 2. Fetch physical units for variation & branch (excluding lost and maintenance)
  const { data: invItems, error: invErr } = await supabase
    .from('inventory_items')
    .select('id, item_sku, status, branch_id, variation_id')
    .eq('variation_id', variationId)
    .eq('branch_id', branchId)
    .not('status', 'in', '("lost","maintenance")');

  if (invErr || !invItems) {
    return [];
  }

  // 3. Fetch reserved inventory item IDs from active overlapping bookings via booking_item_inventory
  let reservedByBookings: string[] = [];
  try {
    const { data: biiData, error: biiErr } = await supabase
      .from('booking_item_inventory')
      .select('inventory_item_id, booking_items!inner(pickup_date, return_date, buffer_days, bookings!inner(branch_id, status))')
      .eq('booking_items.bookings.branch_id', branchId)
      .in('booking_items.bookings.status', ['confirmed', 'pending'])
      .lte('booking_items.pickup_date', blockedEnd);

    if (biiErr) {
      throw new Error('Failed to fetch overlapping booking inventory assignments: ' + biiErr.message);
    }
    
    if (biiData) {
      reservedByBookings = biiData
        .filter((row: any) => {
          const bi = row.booking_items;
          if (!bi) return false;
          const biEnd = addDaysToDate(bi.return_date, bi.buffer_days || 0);
          return bi.pickup_date <= blockedEnd && biEnd >= blockedStart;
        })
        .map((row: any) => row.inventory_item_id);
    }
  } catch (e) {
    // Ignore
  }

  // 4. Fetch reserved inventory item IDs from active overlapping rentals via rental_item_inventory
  let reservedByRentals: string[] = [];
  try {
    const { data: riiData } = await supabase
      .from('rental_item_inventory')
      .select('inventory_item_id, returned_at, rental_items!inner(rentals!inner(branch_id, rent_date, actual_pickup_at, due_date, buffer_days, status))')
      .eq('rental_items.rentals.branch_id', branchId)
      .eq('rental_items.rentals.status', 'out');

    if (riiData) {
      const todayStr = todayISO();
      reservedByRentals = riiData
        .filter((row: any) => {
          const r = row.rental_items?.rentals;
          if (!r) return false;
          const rStart = r.actual_pickup_at ? r.actual_pickup_at.split('T')[0] : r.rent_date;
          
          let rEnd;
          if (row.returned_at) {
            // Actually returned: Boundary is actual return date + buffer_days
            const actualReturnDate = row.returned_at.split('T')[0];
            rEnd = addDaysToDate(actualReturnDate, r.buffer_days || 0);
          } else {
            // Not returned yet: Boundary is due_date + buffer_days (or today + buffer_days if overdue)
            rEnd = addDaysToDate(r.due_date, r.buffer_days || 0);
            if (rEnd < todayStr) {
              rEnd = addDaysToDate(todayStr, r.buffer_days || 0);
            }
          }
          
          return rStart <= blockedEnd && rEnd >= blockedStart;
        })
        .map((row: any) => row.inventory_item_id);
    }
  } catch (e) {
    // Ignore error
  }

  const unavailableSet = new Set([...reservedByBookings, ...reservedByRentals]);

  return invItems
    .filter((item) => !unavailableSet.has(item.id))
    .map((item) => ({
      id: item.id,
      itemSku: item.item_sku,
      status: item.status,
    }))
    .sort((a, b) => a.itemSku.localeCompare(b.itemSku));
}

/**
 * Creates a booking atomically.
 * Uses PostgreSQL RPC `create_booking_atomic` if available, or validated TS fallback with advisory lock.
 */
export async function createBookingAtomic(
  supabase: SupabaseClient,
  params: CreateBookingParams
): Promise<{ success: boolean; bookingId: string; token?: string }> {
  // Acquire mutex lock to serialize execution
  let release: () => void;
  const currentLock = new Promise<void>((resolve) => { release = resolve; });
  const previousLock = atomicMutexLock;
  atomicMutexLock = atomicMutexLock.then(() => currentLock);
  await previousLock;

  try {
    const today = todayISO();
    for (const item of params.items) {
      if (item.pickupDate < today) {
        throw new Error("Pickup date cannot be in the past");
      }
      if (item.pickupDate > item.returnDate) {
        throw new Error("Pickup date cannot be after return date");
      }
    }

    // Calculate total if not explicitly provided
    const calculatedTotal = params.items.reduce((sum, item) => {
      const days = daysBetween(item.pickupDate, item.returnDate);
      return sum + (item.subtotal ?? item.qty * item.dailyRate * days);
    }, 0);

    const discount = params.discount ?? 0;
    const total = params.total ?? netTotal(calculatedTotal, discount);
    const advance = params.advance ?? 0;
    const securityDeposit = params.securityDeposit ?? 0;

    if (advance < 0) {
      throw new Error("Advance paid cannot be negative");
    }
    if (securityDeposit < 0) {
      throw new Error("Security deposit cannot be negative");
    }
    if (total < 0) {
      throw new Error("Total amount cannot be negative");
    }
    if (discount < 0) {
      throw new Error("Discount cannot be negative");
    }
    if (advance > total) {
      throw new Error("Advance paid cannot exceed total rental amount.");
    }
    if (advance > 0 && !params.advancePaymentMethod) {
      throw new Error("Advance payment method is required");
    }
    if (securityDeposit > 0 && !params.securityDepositPaymentMethod) {
      throw new Error("Security deposit payment method is required");
    }

    // Try RPC first for true DB transaction concurrency safety
      const payloadItems = params.items.map((item) => {
        const pickup = item.pickupDate;
        const ret = item.returnDate;
        const days = daysBetween(pickup, ret);
        const subtotal = item.subtotal ?? item.qty * item.dailyRate * days;

        return {
          product_id: item.productId || null,
          variation_id: item.variationId,
          product_name: item.productName,
          sku: item.sku,
          image_url: item.imageUrl || null,
          qty: item.qty,
          daily_rate: item.dailyRate,
          pickup_date: pickup,
          return_date: ret,
          buffer_days: item.bufferDays ?? 0,
          subtotal: subtotal,
          inventory_item_ids: item.inventoryItemIds || [],
        };
      });

      const callToken = params.token || null;
      const { data: rpcData, error: rpcError } = await supabase.rpc('create_booking_atomic', {
        p_token: callToken,
        p_customer_id: params.customerId,
        p_branch_id: params.branchId,
        p_booking_date: params.bookingDate || todayISO(),
        p_notes: params.notes || null,
        p_created_by: params.createdBy || null,
        p_total: total,
        p_advance: advance,
        p_security_deposit: securityDeposit,
        p_items: payloadItems,
        // only sent when used, so the app also works before qa/proposed-sql/005 is applied
        ...(discount > 0 ? { p_discount: discount } : {}),
      });

      if (rpcError) {
        throw new Error('Database RPC failed: ' + rpcError.message);
      }
      
      let bookingId;
      if (typeof rpcData === 'string' && rpcData.length === 36) {
          bookingId = rpcData; // raw UUID
      } else if (rpcData && rpcData.booking_id) {
          bookingId = rpcData.booking_id;
      } else if (typeof rpcData === 'string') {
          try { bookingId = JSON.parse(rpcData).booking_id; } catch(e) { /* not JSON: bookingId stays unset and the error below fires */ }
      }

      if (bookingId) {
        // Since create_booking_atomic doesn't accept the new payment method parameters natively, 
        // update the booking record with these details immediately after creation.
        if (params.advancePaymentMethod || params.securityDepositPaymentMethod) {
          const updatePayload: any = {};
          if (params.advancePaymentMethod) updatePayload.advance_payment_method = params.advancePaymentMethod;
          if (params.securityDepositPaymentMethod) updatePayload.security_deposit_payment_method = params.securityDepositPaymentMethod;
          
          const { error: methodError } = await supabase.from('bookings').update(updatePayload).eq('id', bookingId);
          if (methodError) {
            throw new Error('Booking was created but its payment method could not be saved: ' + methodError.message + '. Open the booking and check it before continuing.');
          }
        }

        let assignedToken: string | undefined;
        if (typeof rpcData === 'object' && rpcData?.token) {
          assignedToken = rpcData.token;
        } else {
          const { data: bRow } = await supabase
            .from('bookings')
            .select('token')
            .eq('id', bookingId)
            .maybeSingle();
          if (bRow?.token) {
            assignedToken = bRow.token;
          } else {
            try {
              const { data: rpcToken } = await supabase.rpc('get_booking_token', { p_booking_id: bookingId });
              if (rpcToken && typeof rpcToken === 'string') {
                assignedToken = rpcToken;
              }
            } catch (e) {
              // Ignore if RPC not yet deployed
            }
          }
        }

        return { success: true, bookingId: bookingId, token: assignedToken };
      }
      throw new Error('Database RPC did not return a booking ID');

    } catch (err: any) {
      throw new Error('Failed to create booking: ' + (err?.message || 'Unknown error'));
    } finally {
      release!();
    }
}

export function updateMockBookingStatus(bookingId: string, status: string) {
  // Mock removed
}

/**
 * Helper to delete bookings from both Supabase and mock store (for test cleanup).
 */
export async function deleteBookingForTest(supabase: SupabaseClient, bookingId: string) {
  // Mock removed

  // Remove from DB
  try {
    const { data: dbBiItems } = await supabase.from('booking_items').select('id').eq('booking_id', bookingId);
    if (dbBiItems && dbBiItems.length > 0) {
      const ids = dbBiItems.map((i: any) => i.id);
      await supabase.from('booking_item_inventory').delete().in('booking_item_id', ids);
    }
    await supabase.from('booking_items').delete().eq('booking_id', bookingId);
    await supabase.from('bookings').delete().eq('id', bookingId);
  } catch (e) {
    // Ignore if table doesn't exist
  }
}
