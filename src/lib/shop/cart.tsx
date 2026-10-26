"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { Modal, ghostButtonClass, goldButtonClass } from "@/components/shop/ui";

// The cart, as in TRENDZ: items picked from Inventory Search or All Rentals wait here until Checkout
// opens the booking form with them. One cart per person per shop, kept on this device.
export interface CartLine { variation_id: string; qty: number; amount_override: string; unit_ids: string[] }
interface CartState { branchId: string; lines: CartLine[] }

interface CartValue extends CartState {
  count: number;
  /** adds one of a variation (or that exact piece); asks first when the cart holds another branch's items */
  add: (branchId: string, variationId: string, unitId?: string) => void;
  setLines: (fn: (lines: CartLine[]) => CartLine[]) => void;
  setBranch: (branchId: string) => void;
  clear: () => void;
}

const Ctx = createContext<CartValue | null>(null);
const empty: CartState = { branchId: "", lines: [] };

function withItem(state: CartState, branchId: string, variationId: string, unitId?: string): CartState {
  const lines = state.branchId === branchId ? state.lines : [];
  const existing = lines.find((l) => l.variation_id === variationId);
  if (existing) {
    if (unitId && existing.unit_ids.includes(unitId)) return { branchId, lines };
    // a scanned piece keeps the pieces already chosen; otherwise the system picks again
    const unit_ids = unitId && existing.unit_ids.length === existing.qty ? [...existing.unit_ids, unitId] : [];
    return { branchId, lines: lines.map((l) => l === existing ? { ...l, qty: l.qty + 1, unit_ids } : l) };
  }
  return { branchId, lines: [...lines, { variation_id: variationId, qty: 1, amount_override: "", unit_ids: unitId ? [unitId] : [] }] };
}

export function CartProvider({ shopId, children }: { shopId: string; children: ReactNode }) {
  const { profile } = useAuth();
  const key = `ob_cart_${shopId}_${profile?.id ?? ""}`;
  const [state, setState] = useState<CartState>(empty);
  const [loadedKey, setLoadedKey] = useState("");
  const [pending, setPending] = useState<{ branchId: string; variationId: string; unitId?: string } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      setState(saved ? { ...empty, ...(JSON.parse(saved) as CartState) } : empty);
    } catch { setState(empty); }
    setLoadedKey(key);
  }, [key]);
  useEffect(() => {
    if (loadedKey !== key) return;
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }, [state, key, loadedKey]);

  const add = useCallback((branchId: string, variationId: string, unitId?: string) => {
    if (state.lines.length && state.branchId && state.branchId !== branchId) {
      setPending({ branchId, variationId, unitId });
      return;
    }
    setState((s) => withItem(s, branchId, variationId, unitId));
  }, [state]);

  const value = useMemo<CartValue>(() => ({
    ...state,
    count: state.lines.reduce((n, l) => n + l.qty, 0),
    add,
    setLines: (fn) => setState((s) => ({ ...s, lines: fn(s.lines).filter((l) => l.qty > 0) })),
    setBranch: (branchId) => setState((s) => ({ branchId, lines: s.lines.map((l) => ({ ...l, unit_ids: [] })) })),
    clear: () => setState(empty),
  }), [state, add]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal open={pending !== null} onClose={() => setPending(null)} title="The cart has another branch's items"
        description="A booking is for one branch. Start a new cart with this item, or keep the cart as it is."
        footer={<>
          <button className={ghostButtonClass} onClick={() => setPending(null)}>Keep the current cart</button>
          <button className={goldButtonClass} onClick={() => {
            if (pending) setState(withItem(empty, pending.branchId, pending.variationId, pending.unitId));
            setPending(null);
          }}>Start a new cart</button>
        </>}>
        <span />
      </Modal>
    </Ctx.Provider>
  );
}

export function useCart() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCart must be used inside the shop app");
  return v;
}
