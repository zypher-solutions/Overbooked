import { createClient } from "@/lib/supabase/client";

// Ids of the rentals that match a typed word: token, customer name or phone, an item's SKU or name, or a piece code.
export async function searchRentalIds(text: string): Promise<string[]> {
  const q = text.trim();
  if (!q) return [];
  const supabase = createClient();
  const like = `%${q.replace(/[%_,()*]/g, "")}%`;
  const [byToken, customers, units, lines] = await Promise.all([
    supabase.from("rentals").select("id").ilike("token", like).limit(200),
    supabase.from("customers").select("id").or(`full_name.ilike.${like},phone.ilike.${like}`).limit(200),
    supabase.from("units").select("id").ilike("code", like).limit(200),
    supabase.from("rental_lines").select("rental_id").or(`sku.ilike.${like},description.ilike.${like}`).limit(500),
  ]);
  const ids = new Set<string>((byToken.data ?? []).map((x) => x.id));
  (lines.data ?? []).forEach((x) => ids.add(x.rental_id));
  const customerIds = (customers.data ?? []).map((c) => c.id);
  const unitIds = (units.data ?? []).map((u) => u.id);
  const [byCustomer, byUnit] = await Promise.all([
    customerIds.length ? supabase.from("rentals").select("id").in("customer_id", customerIds).limit(500) : null,
    unitIds.length ? supabase.from("unit_reservations").select("rental_id").in("unit_id", unitIds) : null,
  ]);
  (byCustomer?.data ?? []).forEach((x) => ids.add(x.id));
  (byUnit?.data ?? []).forEach((x) => ids.add(x.rental_id));
  return Array.from(ids);
}
