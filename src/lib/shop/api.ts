"use client";

import { createClient } from "@/lib/supabase/client";
import { errorText } from "./format";
import type { Charge, Check, Customer, Payment, Rental, RentalAddOn, RentalLine, Reservation } from "./types";

// Calls a database function; throws an Error with the database's own message (written for people).
export async function call<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) throw new Error(errorText(error));
  return data as T;
}

// what lists show for each rental
export const RENTAL_LIST_COLUMNS =
  "id, token, status, start_at, end_at, actual_start_at, actual_end_at, total, paid, branch_id, created_at, " +
  "customers!rentals_shop_customer_fkey(id, full_name, phone), rental_lines(description, qty, kind)";

export interface RentalDetail extends Rental {
  customers: Customer;
  rental_lines: RentalLine[];
  unit_reservations: Reservation[];
  rental_add_ons: RentalAddOn[];
  rental_charges: Charge[];
  rental_checks: Check[];
  payments: Payment[];
}

export async function loadRental(id: string): Promise<RentalDetail | null> {
  const supabase = createClient();
  const [r, p] = await Promise.all([
    supabase.from("rentals").select(
      "*, customers!rentals_shop_customer_fkey(*), rental_lines(*), rental_add_ons(*), rental_charges(*), rental_checks(*), " +
      "unit_reservations(*, units!unit_reservations_shop_unit_fkey(id, code, odometer, status, status_reason, variation_id))",
    ).eq("id", id).maybeSingle(),
    // staff cannot read money records; they get an empty list
    supabase.from("payments").select("*").eq("rental_id", id).order("paid_at"),
  ]);
  if (r.error) throw new Error(errorText(r.error));
  if (!r.data) return null;
  const rental = r.data as unknown as RentalDetail;
  rental.payments = (p.data as Payment[]) ?? [];
  rental.rental_charges.sort((a, b) => a.created_at.localeCompare(b.created_at));
  rental.rental_lines.sort((a, b) => a.description.localeCompare(b.description));
  return rental;
}

// signed links for private handover photos (valid one hour)
export async function photoUrls(paths: string[]) {
  if (paths.length === 0) return {} as Record<string, string>;
  const { data } = await createClient().storage.from("rental_photos").createSignedUrls(paths, 3600);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl])) as Record<string, string>;
}

// uploads handover photos into the shop's private folder; returns their paths
export async function uploadPhotos(shopId: string, rentalId: string, unitId: string, phase: "pickup" | "return", files: File[]) {
  const supabase = createClient();
  const paths: string[] = [];
  for (const [i, file] of files.entries()) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${shopId}/${rentalId}/${unitId}-${phase}-${Date.now()}-${i}.${ext}`;
    const { error } = await supabase.storage.from("rental_photos").upload(path, file, { contentType: file.type || "image/jpeg" });
    if (error) throw new Error("Could not upload a photo: " + error.message);
    paths.push(path);
  }
  return paths;
}

export const money = (r: Pick<Rental, "total" | "paid" | "deposit_received" | "deposit_refunded" | "deposit_applied">) => ({
  total: Number(r.total),
  paid: Number(r.paid),
  balance: Math.round((Number(r.total) - Number(r.paid)) * 100) / 100,
  depositHeld: Math.round((Number(r.deposit_received) - Number(r.deposit_refunded) - Number(r.deposit_applied)) * 100) / 100,
});
