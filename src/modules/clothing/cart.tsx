"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { useShop } from "@/lib/shop/ShopContext";
import { Modal, ghostButtonClass, goldButtonClass } from "@/components/shop/ui";
import {
  cartStorageKey,
  checkoutDraftKey,
  emptyCart,
  emptyCollection,
  readCartCollection,
  type Cart,
  type CartCollection,
  type CartLine,
} from "./cart-storage";

export type { CartLine } from "./cart-storage";

interface CartValue extends Cart {
  ready: boolean;
  count: number;
  carts: Cart[];
  booking: boolean;
  draftKey: (id: number) => string;
  beginBooking: (id: number) => (() => void) | null;
  add: (branchId: string, variationId: string, unitId?: string) => boolean;
  setLines: (fn: (lines: CartLine[]) => CartLine[]) => void;
  setBranch: (branchId: string) => void;
  activate: (id: number) => void;
  create: () => void;
  remove: (id: number) => void;
}

interface PendingItem {
  cartId: number;
  branchId: string;
  variationId: string;
  unitId?: string;
}

const Ctx = createContext<CartValue | null>(null);

function withItem(
  cart: Cart,
  branchId: string,
  variationId: string,
  unitId?: string,
): Cart {
  const lines = cart.branchId === branchId ? cart.lines : [];
  const existing = lines.find((line) => line.variation_id === variationId);
  if (existing) {
    if (unitId && existing.unit_ids.includes(unitId)) return cart;
    const unit_ids =
      unitId && existing.unit_ids.length === existing.qty
        ? [...existing.unit_ids, unitId]
        : [];
    return {
      ...cart,
      branchId,
      lines: lines.map((line) =>
        line === existing ? { ...line, qty: line.qty + 1, unit_ids } : line,
      ),
    };
  }
  return {
    ...cart,
    branchId,
    lines: [
      ...lines,
      {
        variation_id: variationId,
        qty: 1,
        amount_override: "",
        unit_ids: unitId ? [unitId] : [],
      },
    ],
  };
}

function appendCart(
  collection: CartCollection,
  initial: Cart = emptyCart,
): CartCollection {
  const id = collection.nextId;
  return {
    activeId: id,
    nextId: id + 1,
    carts: [...collection.carts, { ...initial, id }],
  };
}

export function CartProvider({
  shopId,
  children,
}: {
  shopId: string;
  children: ReactNode;
}): React.JSX.Element {
  const { profile } = useAuth();
  const { businessModule } = useShop();
  const profileId = profile?.id ?? "";
  const key = cartStorageKey(shopId, profileId);
  const multiple = businessModule === "clothing";
  const [snapshot, setSnapshot] = useState({
    key: "",
    collection: emptyCollection,
  });
  const latest = useRef(snapshot);
  const storageFailed = useRef(false);
  const bookingIds = useRef(new Set<number>());
  const [booking, setBooking] = useState<number[]>([]);
  const [pending, setPending] = useState<PendingItem | null>(null);
  const ready = snapshot.key === key;
  const collection = ready ? snapshot.collection : emptyCollection;
  const active =
    collection.carts.find((cart) => cart.id === collection.activeId) ??
    emptyCart;
  const draftKey = (id: number): string =>
    checkoutDraftKey(shopId, profileId, id);

  useEffect(() => {
    const loaded = {
      key,
      collection: readCartCollection(key) ?? emptyCollection,
    };
    latest.current = loaded;
    storageFailed.current = false;
    setSnapshot(loaded);

    function syncCarts(event: StorageEvent): void {
      if (event.key !== key) return;
      const saved = readCartCollection(key) ?? emptyCollection;
      const selected = latest.current.collection.activeId;
      const activeId = saved.carts.some((cart) => cart.id === selected)
        ? selected
        : saved.activeId;
      latest.current = { key, collection: { ...saved, activeId } };
      setSnapshot(latest.current);
    }

    window.addEventListener("storage", syncCarts);
    return () => {
      window.removeEventListener("storage", syncCarts);
      latest.current = { key: "", collection: emptyCollection };
    };
  }, [key]);

  const commit = useCallback(
    (update: (value: CartCollection) => CartCollection): void => {
      if (latest.current.key !== key) return;
      const current = latest.current.collection;
      const saved = storageFailed.current ? null : readCartCollection(key);
      const activeId = saved?.carts.some((cart) => cart.id === current.activeId)
        ? current.activeId
        : saved?.activeId;
      const source =
        saved && activeId !== undefined ? { ...saved, activeId } : current;
      const next = update(source);
      if (next === source) return;
      latest.current = { key, collection: next };
      setSnapshot(latest.current);
      try {
        localStorage.setItem(key, JSON.stringify(next));
        storageFailed.current = false;
      } catch {
        if (!storageFailed.current)
          toast.warning(
            "Carts could not be saved on this device. Keep this tab open.",
          );
        storageFailed.current = true;
      }
    },
    [key],
  );

  function updateCart(id: number, update: (cart: Cart) => Cart): void {
    if (bookingIds.current.has(id)) return;
    commit((value) => {
      const current = value.carts.find((cart) => cart.id === id);
      if (!current) return value;
      const next = update(current);
      if (current === next) return value;
      return {
        ...value,
        carts: value.carts.map((cart) => (cart.id === id ? next : cart)),
      };
    });
  }

  function add(
    branchId: string,
    variationId: string,
    unitId?: string,
  ): boolean {
    if (!ready) return false;
    if (bookingIds.current.has(active.id)) {
      toast.info(
        "This cart is being booked. Switch carts to add another item.",
      );
      return false;
    }
    let added = false;
    updateCart(active.id, (cart) => {
      if (cart.lines.length && cart.branchId && cart.branchId !== branchId) {
        setPending({ cartId: cart.id, branchId, variationId, unitId });
        return cart;
      }
      const next = withItem(cart, branchId, variationId, unitId);
      added = next !== cart;
      if (!added) toast.info("This piece is already in the active cart.");
      return next;
    });
    return added;
  }

  function beginBooking(id: number): (() => void) | null {
    if (
      bookingIds.current.has(id) ||
      !latest.current.collection.carts.some((cart) => cart.id === id)
    )
      return null;
    bookingIds.current.add(id);
    setBooking([...bookingIds.current]);
    return () => {
      bookingIds.current.delete(id);
      if (latest.current.key === key) setBooking([...bookingIds.current]);
    };
  }

  function remove(id: number): void {
    if (latest.current.key !== key) return;
    try {
      sessionStorage.removeItem(draftKey(id));
      if (id === emptyCart.id)
        sessionStorage.removeItem(`ob_booking_${shopId}`);
    } catch {
      // Storage may be unavailable.
    }
    commit((value) => {
      if (!multiple) return emptyCollection;
      const remaining = value.carts.filter((cart) => cart.id !== id);
      if (!remaining.length) return appendCart({ ...value, carts: [] });
      const activeId =
        value.activeId === id
          ? remaining[remaining.length - 1].id
          : value.activeId;
      return { ...value, activeId, carts: remaining };
    });
  }

  const value: CartValue = {
    ...active,
    ready,
    booking: booking.includes(active.id),
    count: active.lines.reduce((sum, line) => sum + line.qty, 0),
    carts: collection.carts,
    draftKey,
    beginBooking,
    add,
    setLines: (update) =>
      updateCart(active.id, (cart) => {
        const lines = update(cart.lines).filter((line) => line.qty > 0);
        if (
          lines.length === cart.lines.length &&
          lines.every((line, index) => line === cart.lines[index])
        )
          return cart;
        return { ...cart, lines };
      }),
    setBranch: (branchId) =>
      updateCart(active.id, (cart) => ({
        ...cart,
        branchId,
        lines: cart.lines.map((line) => ({ ...line, unit_ids: [] })),
      })),
    activate: (id) =>
      commit((current) =>
        current.carts.some((cart) => cart.id === id)
          ? { ...current, activeId: id }
          : current,
      ),
    create: () => commit((current) => appendCart(current)),
    remove,
  };

  function addToNewCart(): void {
    if (!pending) return;
    const { branchId, variationId, unitId, cartId } = pending;
    const itemCart = withItem(emptyCart, branchId, variationId, unitId);
    if (multiple) commit((current) => appendCart(current, itemCart));
    else updateCart(cartId, () => ({ ...itemCart, id: cartId }));
    setPending(null);
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title="This item is at another branch"
        description={
          multiple
            ? "Each booking uses one branch. Add this item to a new cart and keep your current cart saved."
            : "Each booking uses one branch. Starting a new cart replaces the current items."
        }
        footer={
          <>
            <button
              className={ghostButtonClass}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
            <button className={goldButtonClass} onClick={addToNewCart}>
              Start a new cart
            </button>
          </>
        }
      >
        <span />
      </Modal>
    </Ctx.Provider>
  );
}

export function useCart(): CartValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useCart must be used inside the shop app");
  return value;
}
