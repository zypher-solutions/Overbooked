"use client";

import { createClient } from "@/lib/supabase/client";

// Actions that are saved only in the browser (the cart and its booking draft) are reported to the shop's activity log here.
// Everything saved in the database is logged by the database itself (see "Activity log" in CLAUDE.md); never log it here too.
// Fire and forget: the log never blocks or breaks the screen.

export type CartEvent =
  | { kind: "item_added" | "item_removed"; cart: number; customer?: string; variationId: string; unitId?: string; qty?: number; branchId?: string }
  | { kind: "customer_set"; cart: number; customer: string; previous?: string }
  | { kind: "cart_discarded"; cart: number; customer?: string; items: number };

export function logCartEvent(e: CartEvent): void {
  const args = {
    p_kind: e.kind,
    p_cart: e.cart,
    p_customer: e.customer || null,
    p_previous: e.kind === "customer_set" ? e.previous || null : null,
    p_variation: e.kind === "item_added" || e.kind === "item_removed" ? e.variationId : null,
    p_unit: e.kind === "item_added" || e.kind === "item_removed" ? e.unitId ?? null : null,
    p_qty: e.kind === "item_added" || e.kind === "item_removed" ? e.qty ?? 1 : 1,
    p_items: e.kind === "cart_discarded" ? e.items : null,
    p_branch: e.kind === "item_added" || e.kind === "item_removed" ? e.branchId || null : null,
  };
  void createClient().rpc("log_cart_event", args).then(() => undefined, () => undefined);
}
