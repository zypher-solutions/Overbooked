import type { RentalItem, RentalSessionDraft } from "./types";

const DRAFT_KEY_PREFIX = "overbooked_rental_draft_";

/**
 * Returns a namespaced sessionStorage key for the authenticated user session.
 */
export function getRentalDraftKey(userId?: string | null): string {
  if (userId && typeof userId === "string" && userId.trim()) {
    return `${DRAFT_KEY_PREFIX}${userId.trim()}`;
  }

  // Fallback: If userId is not yet populated, check for any existing rental draft in sessionStorage
  if (typeof window !== "undefined") {
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(DRAFT_KEY_PREFIX)) {
          return key;
        }
      }
    } catch {
      // sessionStorage restricted / unavailable
    }
  }

  return `${DRAFT_KEY_PREFIX}active`;
}

/**
 * Defensively parses and validates raw JSON from sessionStorage.
 * Protects against malformed data, schema mismatch, or corrupted storage.
 */
export function parseRentalDraft(raw: string | null): RentalSessionDraft | null {
  if (!raw || typeof raw !== "string") return null;

  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;

    // Validate items array
    if (!Array.isArray(data.items)) return null;
    const validItems: RentalItem[] = [];
    for (const item of data.items) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.productId !== "string" || !item.productId) continue;
      if (typeof item.sku !== "string") continue;

      const qty = typeof item.qty === "number" && Number.isFinite(item.qty) && item.qty > 0 ? item.qty : 1;
      const dailyRate = typeof item.dailyRate === "number" && Number.isFinite(item.dailyRate) && item.dailyRate >= 0 ? item.dailyRate : 0;

      validItems.push({
        id: typeof item.id === "string" ? item.id : undefined,
        productId: String(item.productId),
        productName: String(item.productName || "Unknown Item"),
        variationId: typeof item.variationId === "string" ? item.variationId : undefined,
        variationName: typeof item.variationName === "string" ? item.variationName : undefined,
        sku: String(item.sku),
        image: typeof item.image === "string" ? item.image : "",
        qty,
        dailyRate,
      });
    }

    const branch = typeof data.branch === "string" ? data.branch : "";
    const customerName = typeof data.customerName === "string" ? data.customerName.slice(0, 200) : "";
    const customerPhone = typeof data.customerPhone === "string" ? data.customerPhone.slice(0, 20) : "";
    const selectedCustomerId = typeof data.selectedCustomerId === "string" ? data.selectedCustomerId : null;
    const conflictChoice = data.conflictChoice === "entered" || data.conflictChoice === "existing" ? data.conflictChoice : null;
    const pickupDate = typeof data.pickupDate === "string" ? data.pickupDate : "";
    const returnDate = typeof data.returnDate === "string" ? data.returnDate : "";
    const bufferDays = typeof data.bufferDays === "number" && Number.isFinite(data.bufferDays) && data.bufferDays >= 0 ? data.bufferDays : 0;

    const advancePaid = typeof data.advancePaid === "number" && Number.isFinite(data.advancePaid) && data.advancePaid >= 0
      ? data.advancePaid
      : "";
    const advancePaymentMethod = typeof data.advancePaymentMethod === "string" ? data.advancePaymentMethod : "";
    const securityDeposit = typeof data.securityDeposit === "number" && Number.isFinite(data.securityDeposit) && data.securityDeposit >= 0
      ? data.securityDeposit
      : "";
    const securityDepositPaymentMethod = typeof data.securityDepositPaymentMethod === "string" ? data.securityDepositPaymentMethod : "";
    const discount = typeof data.discount === "number" && Number.isFinite(data.discount) && data.discount >= 0 ? data.discount : "";
    const notes = typeof data.notes === "string" ? data.notes.slice(0, 2000) : "";

    // selectedUnits: Record<string, string> where key is `${cartIdx}_${unitIdx}` -> inventory_item_id
    const selectedUnits: Record<string, string> = {};
    if (data.selectedUnits && typeof data.selectedUnits === "object" && !Array.isArray(data.selectedUnits)) {
      for (const [k, v] of Object.entries(data.selectedUnits)) {
        if (typeof k === "string" && typeof v === "string") {
          selectedUnits[k] = v;
        }
      }
    }

    const updatedAt = typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt) ? data.updatedAt : Date.now();

    return {
      items: validItems,
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
      updatedAt,
    };
  } catch (err) {
    console.warn("parseRentalDraft error:", err);
    return null;
  }
}

/**
 * Loads the active rental session draft from browser sessionStorage.
 * Safe for SSR.
 */
export function loadRentalDraft(userId?: string | null): RentalSessionDraft | null {
  if (typeof window === "undefined") return null;

  try {
    const key = getRentalDraftKey(userId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;

    const parsed = parseRentalDraft(raw);
    if (!parsed) {
      // Data in storage is invalid, purge it safely
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn("loadRentalDraft error:", e);
    return null;
  }
}

/**
 * Saves a rental session draft to browser sessionStorage.
 * Safe for SSR. Guarantees that older timestamps cannot overwrite newer changes.
 */
export function saveRentalDraft(draft: RentalSessionDraft, userId?: string | null): boolean {
  if (typeof window === "undefined") return false;

  try {
    const key = getRentalDraftKey(userId);
    
    // Concurrency / stale write check
    const existingRaw = sessionStorage.getItem(key);
    if (existingRaw) {
      const existing = parseRentalDraft(existingRaw);
      if (existing && existing.updatedAt > draft.updatedAt) {
        // Newer write already in place, drop stale save
        return false;
      }
    }

    const payload = JSON.stringify({
      ...draft,
      updatedAt: draft.updatedAt || Date.now(),
    });

    sessionStorage.setItem(key, payload);
    return true;
  } catch (e) {
    console.warn("saveRentalDraft error:", e);
    return false;
  }
}

/**
 * Explicitly clears the active rental session draft.
 * Clears the user key as well as any lingering rental draft keys in sessionStorage.
 */
export function clearRentalDraft(userId?: string | null): void {
  if (typeof window === "undefined") return;

  try {
    const userKey = getRentalDraftKey(userId);
    sessionStorage.removeItem(userKey);

    // Clean up any remaining draft keys in current tab's sessionStorage
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(DRAFT_KEY_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch (e) {
    console.warn("clearRentalDraft error:", e);
  }
}

/**
 * Returns true if an active draft exists in sessionStorage.
 */
export function hasActiveRentalDraft(userId?: string | null): boolean {
  const draft = loadRentalDraft(userId);
  return Boolean(draft && draft.items.length > 0);
}

/**
 * Synchronizes cart items to the active draft in sessionStorage.
 * Preserves any customer details, dates, or payment methods already entered.
 */
export function updateDraftCartItems(items: RentalItem[], userId?: string | null): void {
  if (typeof window === "undefined") return;

  try {
    if (items.length === 0) {
      clearRentalDraft(userId);
      return;
    }

    const existing = loadRentalDraft(userId);
    const updatedDraft: RentalSessionDraft = {
      items,
      branch: existing?.branch || "",
      customerName: existing?.customerName || "",
      customerPhone: existing?.customerPhone || "",
      selectedCustomerId: existing?.selectedCustomerId || null,
      conflictChoice: existing?.conflictChoice || null,
      pickupDate: existing?.pickupDate || "",
      returnDate: existing?.returnDate || "",
      bufferDays: typeof existing?.bufferDays === "number" ? existing.bufferDays : 0,
      advancePaid: existing?.advancePaid !== undefined ? existing.advancePaid : "",
      advancePaymentMethod: existing?.advancePaymentMethod || "",
      securityDeposit: existing?.securityDeposit !== undefined ? existing.securityDeposit : "",
      securityDepositPaymentMethod: existing?.securityDepositPaymentMethod || "",
      discount: existing?.discount !== undefined ? existing.discount : "",
      notes: existing?.notes || "",
      selectedUnits: existing?.selectedUnits || {},
      updatedAt: Date.now(),
    };

    saveRentalDraft(updatedDraft, userId);
  } catch (e) {
    console.warn("updateDraftCartItems error:", e);
  }
}
