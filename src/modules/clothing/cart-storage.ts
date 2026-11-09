export interface CartLine {
  variation_id: string;
  qty: number;
  amount_override: string;
  unit_ids: string[];
}

export interface Cart {
  id: number;
  branchId: string;
  lines: CartLine[];
}

export interface CartCollection {
  activeId: number;
  nextId: number;
  carts: Cart[];
}

export const emptyCart: Cart = { id: 1, branchId: "", lines: [] };
export const emptyCollection: CartCollection = {
  activeId: emptyCart.id,
  nextId: emptyCart.id + 1,
  carts: [emptyCart],
};

export function cartStorageKey(shopId: string, profileId: string): string {
  return `ob_cart_${shopId}_${profileId}`;
}

export function checkoutDraftKey(
  shopId: string,
  profileId: string,
  cartId: number,
): string {
  return `ob_booking_${shopId}_${profileId}_${cartId}`;
}

export function readCartCollection(key: string): CartCollection | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<CartCollection & Omit<Cart, "id">>;
    if (
      Array.isArray(saved.carts) &&
      saved.carts.some((cart) => cart.id === saved.activeId) &&
      Number.isSafeInteger(saved.nextId)
    ) {
      return saved as CartCollection;
    }
    if (Array.isArray(saved.lines) && typeof saved.branchId === "string") {
      return {
        ...emptyCollection,
        carts: [{ ...emptyCart, branchId: saved.branchId, lines: saved.lines }],
      };
    }
  } catch {
    // Storage may be blocked, or the saved cart may be unreadable.
  }
  return null;
}

interface CheckoutDraftPreview {
  customerLabel?: string;
  customer?: { full_name?: string };
  start?: string;
  end?: string;
}

export function readDraftPreview(key: string): CheckoutDraftPreview | null {
  try {
    return JSON.parse(
      sessionStorage.getItem(key) ?? "null",
    ) as CheckoutDraftPreview | null;
  } catch {
    return null;
  }
}
