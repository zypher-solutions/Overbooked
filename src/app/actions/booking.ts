"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Server action to cancel a booking.
 * 
 * Enforces:
 * 1. Authenticated session verification via server cookies (does not trust client-supplied IDs).
 * 2. Active profile and role verification ('super_admin', 'owner', 'manager', 'staff').
 * 3. Branch authorization (managers and staff are strictly restricted to their assigned branch).
 * 4. Genuinely atomic execution exclusively via `cancel_booking_atomic` database RPC (single source of truth).
 *    No non-atomic or multi-step fallback paths are permitted.
 */
export async function cancelBookingAction(
  bookingId: string,
  cancellationFee: number = 0,
  refundPaymentMethod?: string,
  cancellationReason?: string
) {
  if (!bookingId) {
    throw new Error("Booking ID is required");
  }

  const cleanFee = Math.max(0, Number(cancellationFee) || 0);
  const cleanMethod = refundPaymentMethod ? refundPaymentMethod.trim() : null;
  const cleanReason = cancellationReason ? cancellationReason.trim() : null;

  // 1. Authenticate caller from session cookies
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    throw new Error("Unauthorized: Please log in to perform this action.");
  }

  // 2. Fetch verified caller profile to check role, branch, and active status
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id, role, branch_id, is_active")
    .eq("id", user.id)
    .single();

  if (profileErr || !profile) {
    throw new Error("Unauthorized: Caller employee profile not found.");
  }

  if (!profile.is_active) {
    throw new Error("Unauthorized: Your employee profile is inactive.");
  }

  const allowedRoles = ["super_admin", "owner", "manager", "staff"];
  if (!allowedRoles.includes(profile.role)) {
    throw new Error(`Unauthorized: Role '${profile.role}' cannot cancel bookings.`);
  }

  // 3. Verify target booking exists and enforce branch authorization
  const { data: booking, error: fetchErr } = await supabase
    .from("bookings")
    .select("id, branch_id, status")
    .eq("id", bookingId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error("Failed to fetch booking: " + fetchErr.message);
  }

  if (!booking) {
    throw new Error("Booking not found");
  }

  // Enforce branch isolation for branch-level managers and staff
  if (["manager", "staff"].includes(profile.role)) {
    if (!profile.branch_id || booking.branch_id !== profile.branch_id) {
      throw new Error("Unauthorized: Cannot cancel booking belonging to another branch");
    }
  }

  // 4. Atomic execution exclusively via cancel_booking_atomic database RPC.
  // The database function performs concurrency row locking (FOR UPDATE), idempotency check,
  // financial validations, atomic booking status/audit update, and inventory deletion in one transaction.
  const { data: rpcResult, error: rpcErr } = await supabase.rpc("cancel_booking_atomic", {
    p_booking_id: bookingId,
    p_cancellation_fee: cleanFee,
    p_refund_payment_method: cleanMethod,
    p_cancellation_reason: cleanReason,
  });

  if (rpcErr) {
    throw new Error(rpcErr.message);
  }

  return { success: true, ...rpcResult };
}
