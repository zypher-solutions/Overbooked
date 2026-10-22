import { createContext, useCallback, useContext, useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import type { PaymentStatus, Product, ProductVariation, Rental, RentalItem, ReturnCondition, StockLocation, Category, Booking, BookingItem, CreateBookingDraft, BranchStock } from "./types";
import { checkAvailability, createBookingAtomic, getEligiblePhysicalUnits } from "./availability";
import { netTotal, discountError } from './money';
import { daysBetween, shiftISO, todayISO } from "./utils";
import { createClient } from "../supabase/client";
import { cancelBookingAction } from "@/app/actions/booking";
import { toast } from "sonner";
import { loadRentalDraft, clearRentalDraft, updateDraftCartItems } from "./draftStorage";

export interface ImportRow {
  // Required product-level columns
  "product name"?: string;
  "base sku"?: string;
  category?: string;
  "base daily rate"?: string;
  // Optional product-level columns
  "purchase price"?: string;
  description?: string;
  // Variation-level columns
  color?: string;
  size?: string;
  "sku code"?: string;
  // Backward-compat aliases kept for safety
  name?: string;
  sku?: string;
  "daily rate"?: string;
  "variation sku"?: string;
  "variation name"?: string;
  // Dynamic columns: Stock: <branchname> and Attr: <attrname>
  [key: string]: string | undefined;
}

interface StoreValue {
  isLoading: boolean;
  products: Product[];
  rentals: Rental[];
  bookings: Booking[];
  branches: string[];
  locations: StockLocation[];
  categories: Category[];
  cart: RentalItem[];
  addToCart: (item: RentalItem) => void;
  removeFromCart: (index: number) => void;
  updateCartItemQty: (index: number, newQty: number) => void;
  clearCart: () => void;
  discardRentalDraft: () => void;

  createBooking: (draft: CreateBookingDraft) => Promise<Booking>;
  pickupBooking: (bookingId: string, expectedReturnDate: string, pickupPayment: number, pickupPaymentMethod: string) => Promise<void>;
  fetchBookings: () => Promise<Booking[]>;
  cancelBooking: (id: string, cancellationFee?: number, refundPaymentMethod?: string, cancellationReason?: string) => Promise<void>;
  createProduct: (p: Omit<Product, "id">) => Promise<Product>;
  updateProduct: (id: string, p: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => void;
  setProductActive: (id: string, active: boolean) => Promise<void>;
  updateRental: (id: string, patch: Partial<Rental>) => void;
  extendRental: (id: string, newDueDate: string, paymentAmount: number, paymentMethod: string, notes?: string) => Promise<void>;
  recordPayment: (rentalId: string, amount: number, method: string) => Promise<void>;
  returnRental: (
    rentalId: string,
    items: { inventory_item_id: string; condition: string; return_notes?: string; rental_item_id?: string }[],
    returnedOn: string,
    settlement: {
      extra_fees: number;
      extra_fees_reason?: string;
      notes?: string;
      deposit_deducted: number;
      deposit_refund_method?: string;
      payment_amount: number;
      payment_method?: string;
    },
  ) => Promise<void>;
  commitImport: (result: any) => Promise<any>;
  createLocation: (loc: Omit<StockLocation, "id">) => void;
  addCategory: (name: string, baseSku?: string) => Promise<Category | null>;
  deleteCategory: (id: string) => Promise<void>;
  fetchInitialData: (options?: { silent?: boolean }) => Promise<void>;
  loadError: boolean;
}

export const StoreContext = createContext<StoreValue | null>(null);

export function OverbookedProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [cart, setCart] = useState<RentalItem[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const draft = loadRentalDraft();
        if (draft && Array.isArray(draft.items) && draft.items.length > 0) {
          return draft.items;
        }
      } catch (e) {
        console.warn("Failed to initialize cart from session draft:", e);
      }
    }
    return [];
  });
  const supabase = useMemo(() => createClient(), []);
  const syncVersionRef = useRef(0);
  const variationSyncVersionRef = useRef<Map<string, number>>(new Map());

  const addToCart = useCallback((item: RentalItem) => {
    const product = products.find((p) => p.id === item.productId);
    if (product && product.isActive === false) {
      toast.error(`"${product.name}" is inactive and cannot be rented. Reactivate it from All Products first.`);
      return;
    }
    setCart((prev) => {
      const next = [...prev, item];
      updateDraftCartItems(next);
      return next;
    });
  }, [products]);

  const removeFromCart = useCallback((index: number) => {
    setCart((prev) => {
      const next = prev.filter((_, i) => i !== index);
      updateDraftCartItems(next);
      return next;
    });
  }, []);

  const updateCartItemQty = useCallback((index: number, newQty: number) => {
    setCart((prev) => {
      if (newQty <= 0) {
        const next = prev.filter((_, i) => i !== index);
        updateDraftCartItems(next);
        return next;
      }
      const next = [...prev];
      next[index] = { ...next[index], qty: newQty };
      updateDraftCartItems(next);
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    updateDraftCartItems([]);
  }, []);

  const discardRentalDraft = useCallback(() => {
    clearRentalDraft();
    setCart([]);
  }, []);

  const fetchBookings = useCallback(async (retryCount: number = 0): Promise<Booking[]> => {
    try {
      let { data, error } = await supabase
        .from('bookings')
        .select(`
          id, token, customer_id, branch_id, booking_date, status, notes, created_at, updated_at, total, advance, security_deposit, advance_payment_method, security_deposit_payment_method,
          cancellation_fee, advance_refund, security_deposit_refund, refund_payment_method, cancellation_reason, cancelled_at, cancelled_by,
          customers ( full_name, phone ),
          branches ( id, name ),
          booking_items (
            id, booking_id, product_id, variation_id, product_name, sku, image_url, qty, daily_rate, pickup_date, return_date, buffer_days, subtotal,
            booking_item_inventory (
              inventory_items ( id, item_sku, status )
            )
          )
        `)
        .order('booking_date', { ascending: false });

      if (error && (error.message?.includes('cancellation_fee') || (error as any).code === '42703')) {
        const fallbackRes = await supabase
          .from('bookings')
          .select(`
            id, token, customer_id, branch_id, booking_date, status, notes, created_at, updated_at, total, advance, security_deposit, advance_payment_method, security_deposit_payment_method,
            customers ( full_name, phone ),
            branches ( id, name ),
            booking_items (
              id, booking_id, product_id, variation_id, product_name, sku, image_url, qty, daily_rate, pickup_date, return_date, buffer_days, subtotal,
              booking_item_inventory (
                inventory_items ( id, item_sku, status )
              )
            )
          `)
          .order('booking_date', { ascending: false });
        data = fallbackRes.data as any;
        error = fallbackRes.error;
      }

      if (error) {
        if (error.message.includes("JWT issued at future") && retryCount < 3) {
          console.warn(`fetchBookings DB query warning: JWT issued at future. Retrying in 1s (Attempt ${retryCount + 1}/3)...`);
          await new Promise(res => setTimeout(res, 1000));
          return fetchBookings(retryCount + 1);
        }
        console.error("fetchBookings DB query warning:", error.message);
        setLoadError(true);
        return [];
      }

      if (data) {
        const mapped: Booking[] = data.map((b: any) => ({
          id: b.id,
          token: b.token,
          customerId: b.customer_id,
          customerName: b.customers?.full_name || 'Unknown',
          customerPhone: b.customers?.phone || '',
          branchId: b.branch_id,
          branchName: b.branches?.name || 'Unknown Branch',
          bookingDate: b.booking_date,
          status: b.status,
          notes: b.notes,
          total: Number(b.total || 0),
          advance: Number(b.advance || 0),
          remaining: b.status === 'cancelled' ? 0 : Math.max(0, Number(b.total || 0) - Number(b.advance || 0)),
          securityDeposit: Number(b.security_deposit ?? b.securityDeposit ?? 0),
          advancePaymentMethod: b.advance_payment_method,
          securityDepositPaymentMethod: b.security_deposit_payment_method,
          createdAt: b.created_at,
          updatedAt: b.updated_at,
          cancellationFee: Number(b.cancellation_fee || 0),
          advanceRefund: Number(b.advance_refund || 0),
          securityDepositRefund: Number(b.security_deposit_refund || 0),
          refundPaymentMethod: b.refund_payment_method,
          cancellationReason: b.cancellation_reason,
          cancelledAt: b.cancelled_at,
          cancelledBy: b.cancelled_by,
          items: (b.booking_items || []).map((bi: any) => {
            const assignedUnits = (bi.booking_item_inventory || [])
              .map((bii: any) => bii.inventory_items)
              .filter(Boolean)
              .map((ii: any) => ({
                id: ii.id,
                itemSku: ii.item_sku,
                status: ii.status,
              }));

            return {
              id: bi.id,
              bookingId: bi.booking_id,
              productId: bi.product_id,
              variationId: bi.variation_id,
              productName: bi.product_name,
              sku: bi.sku,
              imageUrl: bi.image_url,
              qty: bi.qty,
              dailyRate: Number(bi.daily_rate),
              pickupDate: bi.pickup_date,
              returnDate: bi.return_date,
              bufferDays: bi.buffer_days || 0,
              subtotal: Number(bi.subtotal),
              assignedUnits,
              inventoryItemIds: assignedUnits.map((u: any) => u.id),
              assignedUnitSkus: assignedUnits.map((u: any) => u.itemSku),
            };
          })
        }));

        setBookings(mapped);
        setLoadError(false);
        return mapped;
      }
    } catch (e) {
      console.error("fetchBookings error:", e);
      setLoadError(true);
    }
    return [];
  }, [supabase]);

  // A newer refresh makes older ones stale: they stop before writing state, so slow responses never overwrite fresh data.
  const fetchSeqRef = useRef(0);
  const fetchInitialData = useCallback(async (options?: { silent?: boolean }) => {
    const seq = ++fetchSeqRef.current;
    if (!options?.silent) {
      setIsLoading(true);
    }
    try {
      await fetchBookings();
      const [branchesRes, catRes, productsRes, invItemsRes] = await Promise.all([
        supabase.from('branches').select('*'),
        supabase.from('categories').select('*'),
        supabase.from('products').select(`
          *,
          categories(name),
          product_variations(
            id, name, sku, daily_rate, is_enabled, attributes,
            product_stock(quantity, branch_id, branches(id, name))
          )
        `),
        supabase.from('inventory_items').select('id, variation_id, branch_id, status').limit(10000),
      ]);

      if (branchesRes.error || catRes.error || productsRes.error || invItemsRes.error) setLoadError(true);

      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = user
        ? await supabase.from('profiles').select('id, role, branch_id').eq('id', user.id).maybeSingle()
        : { data: null };
      if (seq !== fetchSeqRef.current) return;

      if (branchesRes.data) {
        setLocations(branchesRes.data
          .map(b => ({
            id: b.id, name: b.name, slug: b.slug,
            email: b.email || "", phone: b.phone || "", address: b.address || "", enabled: b.is_active
        })));
      }

      if (catRes.data) {
        setCategories(catRes.data.map(c => ({ id: c.id, name: c.name, base_sku: c.base_sku || undefined })));
      }

      const isGlobalAdmin = profile?.role === 'super_admin' || profile?.role === 'owner';
      const allBranches = branchesRes.data || [];
      // Stock of an inactive branch stays in the database and history but is hidden from availability.
      const activeBranches = allBranches.filter((b: any) => b.is_active !== false);
      const authorizedBranches = isGlobalAdmin
        ? activeBranches
        : profile?.branch_id
          ? activeBranches.filter((b: any) => b.id === profile.branch_id)
          : [];

      // Group authorized inventory_items by variation_id and branch_id
      const invStatsMap = new Map<string, Map<string, { available: number; rented: number; maintenance: number; lost: number }>>();

      (invItemsRes.data || []).forEach((item: any) => {
        if (!item.variation_id || !item.branch_id) return;
        if (!invStatsMap.has(item.variation_id)) {
          invStatsMap.set(item.variation_id, new Map());
        }
        const byBranch = invStatsMap.get(item.variation_id)!;
        if (!byBranch.has(item.branch_id)) {
          byBranch.set(item.branch_id, { available: 0, rented: 0, maintenance: 0, lost: 0 });
        }
        const counts = byBranch.get(item.branch_id)!;
        if (item.status === 'available') counts.available++;
        else if (item.status === 'rented') counts.rented++;
        else if (item.status === 'maintenance') counts.maintenance++;
        else if (item.status === 'lost') counts.lost++;
      });

      if (productsRes.data) {
        setProducts(productsRes.data.map(p => {
          const mappedVariations = (p.product_variations || []).map((v: any) => {
            // 1. Total stock: Read from product_stock.quantity
            const stock: Record<string, number> = {};
            (v.product_stock || []).forEach((ps: any) => {
              const bName = ps.branches?.name;
              if (bName && activeBranches.some((b: any) => b.id === ps.branch_id)) {
                stock[bName] = Number(ps.quantity || 0);
              }
            });

            // 2. Available, rented, maintenance, and lost: Calculate from corresponding inventory_items
            // records that the current user is authorized to access.
            const stockDetails: Record<string, BranchStock> = {};
            for (const authBranch of authorizedBranches) {
              const counts = invStatsMap.get(v.id)?.get(authBranch.id) || { available: 0, rented: 0, maintenance: 0, lost: 0 };
              const totalStockForBranch = stock[authBranch.name] ?? (counts.available + counts.rented + counts.maintenance + counts.lost);

              stockDetails[authBranch.name] = {
                total: totalStockForBranch,
                available: counts.available,
                onRent: counts.rented,
                maintenance: counts.maintenance,
                lost: counts.lost,
              };
            }

            return {
              id: v.id,
              name: v.name,
              sku: v.sku,
              dailyRate: Number(v.daily_rate || 0),
              enabled: v.is_enabled,
              attributes: v.attributes || {},
              stock,
              stockDetails,
            };
          });

          const positiveRates = mappedVariations
            .map((v: any) => v.dailyRate)
            .filter((r: number) => r > 0);
          const computedDailyRate = positiveRates.length > 0
            ? Math.min(...positiveRates)
            : Number((p as any).daily_rate || p.purchase_price || 0);

          return {
            id: p.id,
            name: p.name ?? "",
            sku: p.sku ?? "",
            description: p.description || undefined,
            dailyRate: computedDailyRate,
            purchasePrice: Number(p.purchase_price || 0),
            image: p.image_url || "https://placehold.co/800x800/1c1c1c/888888/png?text=No+Image",
            category: (p.categories as any)?.name || "Uncategorized",
            variations: mappedVariations,
            isActive: p.is_active ?? true,
          };
        }));
      }

      // ── STEP 1: Fetch all rentals (no joins) ─────────────────────────────────
      const step1 = await supabase
        .from('rentals')
        .select('id, token, rent_date, due_date, total, advance, payment_status, status, returned_on, condition, notes, extra_fees, extra_fees_reason, security_deposit, deposit_deducted, deposit_refunded, deposit_refund_method, customer_id, branch_id')
        .order('created_at', { ascending: false });

      if (!step1.data) {
        setLoadError(true);
        setIsLoading(false);
        return;
      }

      const rentalIds = step1.data.map(r => r.id);

      // ── STEP 2: Fetch rental_items for all rentals ───────────────────────────
      const step2 = await supabase
        .from('rental_items')
        .select('id, rental_id, variation_id, product_name, sku, image_url, qty, daily_rate, product_variations(name, product_id)')
        .in('rental_id', rentalIds);

      const rentalItemIds = (step2.data || []).map((ri: any) => ri.id);

      // ── STEP 3: Fetch rental_item_inventory for those rental_item_ids ────────
      const step3 = await supabase
        .from('rental_item_inventory')
        .select('rental_item_id, inventory_item_id, condition, return_notes')
        .in('rental_item_id', rentalItemIds);

      // ── FALLBACK: derive assignedUnits for rental_items with no RII rows ──────
      // When rental_item_inventory has no rows for an 'out' rental_item,
      // look up the 'rented' inventory_items directly by variation+branch.
      // This requires no INSERT permission and works regardless of RLS on the junction table.
      const assignedRentalItemIds = new Set((step3.data || []).map((rii: any) => rii.rental_item_id));
      const outRentalIds = new Set(step1.data.filter(r => r.status === 'out').map(r => r.id));
      const unlinkedRentalItems = (step2.data || []).filter((ri: any) =>
        outRentalIds.has(ri.rental_id) && !assignedRentalItemIds.has(ri.id) && ri.variation_id
      );

      // Build a synthetic RII map from direct inventory_items lookup
      // key: rental_item_id → [{inventory_item_id, item_sku, status}]
      const syntheticRiiMap = new Map<string, any[]>();

      if (unlinkedRentalItems.length > 0) {
        console.log('[FALLBACK] Deriving assignedUnits for', unlinkedRentalItems.length, 'unlinked rental_items via direct inventory_items lookup');

        for (const ri of unlinkedRentalItems) {
          const rental = step1.data.find(r => r.id === ri.rental_id);
          if (!rental) continue;

          const { data: rentedItems, error: riErr } = await supabase
            .from('inventory_items')
            .select('id, item_sku, status')
            .eq('variation_id', ri.variation_id)
            .eq('branch_id', rental.branch_id)
            .order('status', { ascending: false }) // 'rented' sorts after 'available' alphabetically — use limit to pick first qty
            .limit(ri.qty);

          if (riErr) {
            console.error('[FALLBACK] inventory_items query failed for rental_item', ri.id, ':', riErr.message);
            continue;
          }

          console.log('[FALLBACK] rental_item', ri.id, '→', rentedItems?.length, 'inventory_items found:', rentedItems?.map((i: any) => i.item_sku + ':' + i.status).join(', '));
          if (rentedItems && rentedItems.length > 0) {
            syntheticRiiMap.set(ri.id, rentedItems.map((inv: any) => ({
              inventory_item_id: inv.id,
              item_sku: inv.item_sku,
              status: inv.status,
            })));
          }
        }
      }
      // ── END FALLBACK ─────────────────────────────────────────────────────────

      // Collect all inventory_item_ids: from RII table + synthetic fallback
      const riiInventoryIds = [...new Set((step3.data || []).map((rii: any) => rii.inventory_item_id))];
      const fallbackInventoryIds = [...syntheticRiiMap.values()].flatMap(rows => rows.map((r: any) => r.inventory_item_id));
      const inventoryItemIds = [...new Set([...riiInventoryIds, ...fallbackInventoryIds])];

      // ── STEP 4: Fetch inventory_items for those ids ──────────────────────────
      const step4 = inventoryItemIds.length > 0
        ? await supabase
            .from('inventory_items')
            .select('id, item_sku, status')
            .in('id', inventoryItemIds)
        : { data: [], error: null };

      // ── Fetch customers and branches separately for display ──────────────────
      const customerIds = [...new Set(step1.data.map(r => r.customer_id).filter(Boolean))];
      const branchIds = [...new Set(step1.data.map(r => r.branch_id).filter(Boolean))];

      const [customersRes, rentalBranchesRes] = await Promise.all([
        customerIds.length > 0
          ? supabase.from('customers').select('id, full_name, phone').in('id', customerIds)
          : { data: [], error: null },
        branchIds.length > 0
          ? supabase.from('branches').select('id, name').in('id', branchIds)
          : { data: [], error: null },
      ]);
      if (seq !== fetchSeqRef.current) return;

      // ── Build lookup maps ────────────────────────────────────────────────────
      const customerMap = new Map((customersRes.data || []).map((c: any) => [c.id, c]));
      const branchMap = new Map((rentalBranchesRes.data || []).map((b: any) => [b.id, b]));
      const inventoryMap = new Map((step4.data || []).map((ii: any) => [ii.id, ii]));

      // rental_item_id -> list of inventory rows
      const riiByRentalItemId = new Map<string, any[]>();
      for (const rii of (step3.data || [])) {
        if (!riiByRentalItemId.has(rii.rental_item_id)) {
          riiByRentalItemId.set(rii.rental_item_id, []);
        }
        riiByRentalItemId.get(rii.rental_item_id)!.push(rii);
      }

      // rental_id -> list of rental_item rows
      const riByRentalId = new Map<string, any[]>();
      for (const ri of (step2.data || [])) {
        if (!riByRentalId.has(ri.rental_id)) {
          riByRentalId.set(ri.rental_id, []);
        }
        riByRentalId.get(ri.rental_id)!.push(ri);
      }

      // ── Map everything into Rental objects ───────────────────────────────────
      const mappedRentals = step1.data.map(r => {
        const rentalItemRows = riByRentalId.get(r.id) || [];
        const items: RentalItem[] = rentalItemRows.map((item: any) => {
          // Prefer rows from rental_item_inventory; fall back to synthetic derivation
          const riiRows = riiByRentalItemId.get(item.id) || [];
          const syntheticRows = syntheticRiiMap.get(item.id) || [];

          const assignedUnits = riiRows.length > 0
            ? riiRows.map((rii: any) => {
                const inv = inventoryMap.get(rii.inventory_item_id);
                return {
                  id: rii.inventory_item_id,
                  itemSku: inv ? inv.item_sku : null,
                  status: inv ? inv.status : null,
                };
              }).filter((u: any) => u.id && u.itemSku)
            : syntheticRows.map((row: any) => ({
                id: row.inventory_item_id,
                itemSku: row.item_sku,
                status: row.status,
              })).filter((u: any) => u.id && u.itemSku);

          return {
            id: item.id,
            productId: (item.product_variations as any)?.product_id || "",
            productName: item.product_name || "Unknown Item",
            variationId: item.variation_id || undefined,
            variationName: (item.product_variations as any)?.name || undefined,
            sku: item.sku || "",
            image: item.image_url || "https://placehold.co/800x800/1c1c1c/888888/png?text=No+Image",
            qty: item.qty || 1,
            dailyRate: item.daily_rate || 0,
            assignedUnits,
            inventoryItemIds: assignedUnits.map((u: any) => u.id),
            assignedUnitSkus: assignedUnits.map((u: any) => u.itemSku),
          };
        });

        const customer = customerMap.get(r.customer_id);
        const branch = branchMap.get(r.branch_id);

        return {
          id: r.id,
          token: r.token,
          items,
          branch: branch?.name || "",
          customerName: customer?.full_name || "",
          customerPhone: customer?.phone || "",
          rentDate: r.rent_date,
          dueDate: r.due_date,
          total: r.total || 0,
          advance: r.advance || 0,
          securityDeposit: r.security_deposit || 0,
          paymentStatus: r.payment_status as any,
          status: r.status as any,
          notes: r.notes || "",
          returnedOn: r.returned_on || undefined,
          condition: r.condition || undefined,
          extra_fees: r.extra_fees || 0,
          extra_fees_reason: r.extra_fees_reason || undefined,
          depositDeducted: Number(r.deposit_deducted) || 0,
          depositRefunded: Number(r.deposit_refunded) || 0,
          depositRefundMethod: r.deposit_refund_method || undefined,
        };
      });

      setRentals(mappedRentals);
      
    } catch(e) {
      console.error(e);
      setLoadError(true);
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  }, [supabase, fetchBookings]);


  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // Refresh when the tab regains focus or the network returns (realtime may have dropped); at most once per 30 s.
  const lastRefreshRef = useRef(0);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden" || Date.now() - lastRefreshRef.current < 30_000) return;
      lastRefreshRef.current = Date.now();
      fetchInitialData({ silent: true });
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [fetchInitialData]);

  // Real-time sync: re-fetch silently when rentals, items, payments, bookings, or stock changes on ANY device
  useEffect(() => {
    const channel = supabase
      .channel('overbooked-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rentals' }, () => {
        fetchInitialData({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_items' }, () => {
        fetchInitialData({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        fetchInitialData({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        fetchInitialData({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_stock' }, () => {
        fetchInitialData({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, () => {
        fetchInitialData({ silent: true });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchInitialData]);

  const branches = useMemo(() => locations.map(l => l.name), [locations]);

  const createProduct: StoreValue["createProduct"] = useCallback(async (draft) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", user?.id).single();
    if (profile?.role === "staff") {
      throw new Error("Unauthorized: Staff cannot create products");
    }

    // 1. Resolve category_id
    let categoryId: string | null = null;
    if (draft.category) {
      const { data: catData } = await supabase
        .from("categories")
        .select("id")
        .ilike("name", draft.category)
        .maybeSingle();
      if (catData) {
        categoryId = catData.id;
      } else {
        const { data: newCat } = await supabase
          .from("categories")
          .insert({ name: draft.category })
          .select("id")
          .single();
        if (newCat) categoryId = newCat.id;
      }
    }

    // 2. Insert the product — await DB before touching UI state
    const { data: inserted, error: insertErr } = await supabase
      .from("products")
      .insert({
        name: draft.name,
        sku: draft.sku,
        image_url: draft.image,
        description: draft.description,
        category_id: categoryId,
        purchase_price: draft.purchasePrice || 0,
        attributes: draft.attributes || [],
      })
      .select("id, created_at")
      .single();

    if (insertErr || !inserted) {
      throw new Error("Failed to save product: " + (insertErr?.message || "Unknown error"));
    }

    const realId = inserted.id;

    // 3. Save variations + their stock
    const savedVariations: ProductVariation[] = [];
    if (draft.variations?.length) {
      const { data: branchList } = await supabase.from("branches").select("id, name");
      for (const variation of draft.variations) {
        if (!variation.enabled) continue;
        const { data: insertedVar, error: varErr } = await supabase
          .from("product_variations")
          .upsert({
            product_id: realId,
            name: variation.name,
            sku: variation.sku.toUpperCase(),
            daily_rate: variation.dailyRate,
            is_enabled: variation.enabled,
            attributes: variation.attributes || {},
          }, { onConflict: 'sku' })
          .select("id")
          .single();

        if (varErr || !insertedVar) {
          console.error("Failed to insert variation:", varErr);
          continue;
        }

        if (branchList) {
          const authorizedBranches = profile?.role === "manager"
            ? branchList.filter((b) => b.id === profile.branch_id)
            : branchList;

          let skuCounter = 1;
          const inventoryItems: any[] = [];
          for (const branch of authorizedBranches) {
            const qty = variation.stock[branch.name];
            if (qty === undefined) continue;
            
            if (qty <= 0) continue;
            for (let i = 0; i < qty; i++) {
              const itemSku = `${variation.sku}-${String(skuCounter).padStart(3, '0')}`;
              inventoryItems.push({
                product_id: realId,
                variation_id: insertedVar.id,
                branch_id: branch.id,
                item_sku: itemSku,
                status: 'available'
              });
              skuCounter++;
            }
          }
          if (inventoryItems.length > 0) {
            await supabase.from("inventory_items").insert(inventoryItems);
          }

          // Synchronize product_stock to represent total items count
          const { data: availItems } = await supabase.from("inventory_items")
            .select("branch_id, status")
            .eq("variation_id", insertedVar.id);

          const availBranchCounts: Record<string, number> = {};
          const statusBranchCounts: Record<string, { available: number; rented: number; maintenance: number; lost: number }> = {};
          availItems?.forEach((item: any) => {
            availBranchCounts[item.branch_id] = (availBranchCounts[item.branch_id] || 0) + 1;
            if (!statusBranchCounts[item.branch_id]) {
              statusBranchCounts[item.branch_id] = { available: 0, rented: 0, maintenance: 0, lost: 0 };
            }
            if (item.status === 'available') statusBranchCounts[item.branch_id].available++;
            else if (item.status === 'rented') statusBranchCounts[item.branch_id].rented++;
            else if (item.status === 'maintenance') statusBranchCounts[item.branch_id].maintenance++;
            else if (item.status === 'lost') statusBranchCounts[item.branch_id].lost++;
          });

          const stockRowsToUpsert = authorizedBranches.map((b) => ({
            product_id: realId,
            variation_id: insertedVar.id,
            branch_id: b.id,
            quantity: availBranchCounts[b.id] || 0
          }));

          if (stockRowsToUpsert.length > 0) {
            await supabase.from("product_stock").upsert(stockRowsToUpsert, { onConflict: "variation_id,branch_id" });
          }

          const variationStock: Record<string, number> = {};
          const variationStockDetails: Record<string, BranchStock> = {};
          authorizedBranches.forEach((b) => {
            const count = availBranchCounts[b.id] || 0;
            variationStock[b.name] = count;
            const counts = statusBranchCounts[b.id] || { available: 0, rented: 0, maintenance: 0, lost: 0 };
            variationStockDetails[b.name] = {
              total: count,
              available: counts.available,
              onRent: counts.rented,
              maintenance: counts.maintenance,
              lost: counts.lost,
            };
          });

          savedVariations.push({
            ...variation,
            id: insertedVar.id,
            stock: variationStock,
            stockDetails: variationStockDetails,
          });
        } else {
          savedVariations.push({ ...variation, id: insertedVar.id });
        }
      }
    }

    const positiveRates = savedVariations
      .map((v: any) => v.dailyRate)
      .filter((r: number) => r > 0);
    const computedDailyRate = positiveRates.length > 0
      ? Math.min(...positiveRates)
      : Number(draft.dailyRate || 0);

    // Only add to UI state after DB confirms — no silent data loss
    const product: Product = {
      ...draft,
      id: realId,
      dailyRate: computedDailyRate,
      createdAt: inserted.created_at,
      variations: savedVariations,
    };
    setProducts((prev) => [product, ...prev]);

    // Refresh store to ensure all state is fully in sync
    await fetchInitialData({ silent: true });

    return product;
  }, [supabase, fetchInitialData]);

  const updateProduct: StoreValue["updateProduct"] = useCallback(async (id, patch) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", user?.id).single();
    if (profile?.role === "staff") {
      throw new Error("Unauthorized: Staff cannot modify products");
    }

    setProducts((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const updated = { ...p, ...patch };
      if (patch.variations) {
        const positiveRates = patch.variations
          .map((v: any) => v.dailyRate)
          .filter((r: number) => r > 0);
        if (positiveRates.length > 0) {
          updated.dailyRate = Math.min(...positiveRates);
        }
      }
      return updated;
    }));
    if (id.startsWith('p')) return;
    
    try {
      const dbPatch: any = {};
      if (patch.name !== undefined) dbPatch.name = patch.name;
      if (patch.sku !== undefined) dbPatch.sku = patch.sku;
      if (patch.image !== undefined) dbPatch.image_url = patch.image;
      if (patch.description !== undefined) dbPatch.description = patch.description;
      if (patch.purchasePrice !== undefined) dbPatch.purchase_price = patch.purchasePrice;
      if (patch.attributes !== undefined) dbPatch.attributes = patch.attributes;
      if (patch.category !== undefined) {
        const { data: catData } = await supabase.from("categories").select("id").ilike("name", patch.category).maybeSingle();
        if (catData) {
          dbPatch.category_id = catData.id;
        } else if (patch.category) {
          const { data: newCat } = await supabase.from("categories").insert({ name: patch.category }).select("id").single();
          if (newCat) dbPatch.category_id = newCat.id;
        } else {
          dbPatch.category_id = null;
        }
      }

      if (Object.keys(dbPatch).length > 0) {
        const { error: prodErr } = await supabase.from('products').update(dbPatch).eq('id', id);
        if (prodErr) throw new Error("Failed to update product details: " + prodErr.message);
      }

      if (patch.variations) {
        const { data: branches } = await supabase.from("branches").select("id, name");
        const authorizedBranches = profile?.role === "manager"
          ? (branches || []).filter((b) => b.id === profile.branch_id)
          : (branches || []);
        const varIdMap: Record<string, string> = {};
        for (const v of patch.variations) {
          try {
            const isNew = v.id.startsWith('v');
            let realVarId = v.id;
            const rateToSave = (v.dailyRate && v.dailyRate > 0) ? v.dailyRate : (patch.dailyRate || 0);
            
            if (isNew) {
              const { data: upserted, error: varErr } = await supabase.from("product_variations")
                .upsert({
                  product_id: id,
                  name: v.name,
                  sku: v.sku.toUpperCase(),
                  daily_rate: rateToSave,
                  is_enabled: v.enabled,
                  attributes: v.attributes || {}
                }, { onConflict: 'sku' })
                .select("id")
                .single();
                
              if (varErr || !upserted) {
                console.error("Variation upsert error for", v.sku, varErr);
                continue;
              }
              realVarId = upserted.id;
              varIdMap[v.id] = realVarId;
            } else {
              const { error: updateErr } = await supabase.from("product_variations")
                .update({
                  name: v.name,
                  sku: v.sku.toUpperCase(),
                  daily_rate: rateToSave,
                  is_enabled: v.enabled,
                  attributes: v.attributes || {}
                })
                .eq("id", realVarId);
                
              if (updateErr) {
                console.error("Variation update error for", v.sku, updateErr);
                continue;
              }
            }
            
            // Update inventory items
            const { data: existingItems } = await supabase.from("inventory_items")
              .select("item_sku, branch_id")
              .eq("variation_id", realVarId)
              .order("item_sku", { ascending: false });
              
            let nextSkuNumber = 1;
            if (existingItems && existingItems.length > 0) {
              const lastSku = existingItems[0].item_sku;
              const parts = lastSku.split('-');
              const num = parseInt(parts[parts.length - 1], 10);
              if (!isNaN(num)) nextSkuNumber = num + 1;
            }

            const branchCounts: Record<string, number> = {};
            existingItems?.forEach(item => {
              branchCounts[item.branch_id] = (branchCounts[item.branch_id] || 0) + 1;
            });

            const newInventoryItems = [];
            for (const branch of authorizedBranches) {
              const qty = v.stock[branch.name];
              if (qty === undefined) continue;
              
              if (qty <= 0) continue;
              
              const existingCount = branchCounts[branch.id] || 0;
              const toCreate = qty - existingCount;
              
              if (toCreate > 0) {
                for (let i = 0; i < toCreate; i++) {
                  const itemSku = `${v.sku}-${String(nextSkuNumber).padStart(3, '0')}`;
                  newInventoryItems.push({
                    product_id: id,
                    variation_id: realVarId,
                    branch_id: branch.id,
                    item_sku: itemSku,
                    status: 'available'
                  });
                  nextSkuNumber++;
                }
              } else if (toCreate < 0) {
                const excessCount = Math.abs(toCreate);
                const itemsToDelete = existingItems
                  ?.filter(item => item.branch_id === branch.id)
                  ?.slice(0, excessCount)
                  .map(i => i.item_sku) || [];
                  
                if (itemsToDelete.length > 0) {
                  await supabase.from("inventory_items")
                    .delete()
                    .in("item_sku", itemsToDelete)
                    .eq("status", "available");
                }
              }
            }

            if (newInventoryItems.length > 0) {
              await supabase.from("inventory_items").insert(newInventoryItems);
            }

            // Synchronize product_stock so quantity represents total stock
            const { data: availItems } = await supabase.from("inventory_items")
              .select("branch_id")
              .eq("variation_id", realVarId);

            const availBranchCounts: Record<string, number> = {};
            availItems?.forEach((item: any) => {
              availBranchCounts[item.branch_id] = (availBranchCounts[item.branch_id] || 0) + 1;
            });

            const stockRowsToUpsert = authorizedBranches.map((b) => ({
              product_id: id,
              variation_id: realVarId,
              branch_id: b.id,
              quantity: availBranchCounts[b.id] || 0
            }));

            if (stockRowsToUpsert.length > 0) {
              await supabase.from("product_stock").upsert(stockRowsToUpsert, { onConflict: "variation_id,branch_id" });
            }
          } catch (innerErr) {
            console.error("Error processing variation", v.sku, innerErr);
          }
        }
        if (Object.keys(varIdMap).length > 0) {
          setProducts((prev) =>
            prev.map((p) => {
              if (p.id === id) {
                return {
                  ...p,
                  variations: p.variations?.map(v => varIdMap[v.id] ? { ...v, id: varIdMap[v.id] } : v)
                };
              }
              return p;
            })
          );
        }
      }

      await fetchInitialData({ silent: true });
    } catch (e) {
      console.error("updateProduct error", e);
      throw e;
    }
  }, [supabase, fetchInitialData]);


  const createBooking = useCallback(async (draft: CreateBookingDraft): Promise<Booking> => {
    if (!draft.items || draft.items.length === 0) {
      throw new Error("Cart is empty");
    }
    if (!draft.branch) {
      throw new Error("Please select a branch.");
    }
    if (!draft.pickupDate) {
      throw new Error("Pickup date is required");
    }
    if (!draft.returnDate) {
      throw new Error("Return date is required");
    }
    if (draft.pickupDate > draft.returnDate) {
      throw new Error("Pickup date cannot be after return date");
    }
    const today = todayISO();
    if (draft.pickupDate < today) {
      throw new Error("Pickup date cannot be in the past");
    }
    const bufferDays = draft.bufferDays ?? 0;
    if (bufferDays < 0) {
      throw new Error("Maintenance buffer days cannot be negative");
    }

    // 1. Resolve Branch
    const { data: branch, error: bErr } = await supabase
      .from('branches')
      .select('id, name')
      .ilike('name', draft.branch)
      .maybeSingle();

    if (bErr || !branch) {
      throw new Error("Please select a valid active branch.");
    }

    // 2. Resolve Customer Identity
    let customerId: string;
    const cleanPhone = draft.customerPhone.replace(/[\s-]/g, "");
    const trimmedName = draft.customerName.trim();

    if (draft.customerId) {
      // Employee explicitly selected an existing customer profile
      customerId = draft.customerId;
    } else {
      // Check if a customer record with the EXACT same name and phone already exists
      const { data: exactMatch } = await supabase
        .from('customers')
        .select('id, full_name')
        .eq('phone', cleanPhone)
        .ilike('full_name', trimmedName)
        .maybeSingle();

      if (exactMatch) {
        // Safe match: Same person, reuse their customer record
        customerId = exactMatch.id;
      } else {
        // Different person sharing this phone number, or brand new customer:
        // Create an independent customer record so we never overwrite an existing customer's saved name
        // or mutate past booking customer records!
        const { data: newCustomer, error: custErr } = await supabase
          .from('customers')
          .insert({
            full_name: trimmedName,
            phone: cleanPhone
          })
          .select('id')
          .single();

        if (custErr || !newCustomer) {
          throw new Error("Failed to create customer record: " + (custErr?.message || "Unknown error"));
        }
        customerId = newCustomer.id;
      }
    }

    // 3. Stage 1 Availability Validation (Frontend Store Pre-Check)
    for (const item of draft.items) {
      if (item.variationId) {
        const avail = await checkAvailability(supabase, {
          branchId: branch.id,
          variationId: item.variationId,
          pickupDate: draft.pickupDate,
          returnDate: draft.returnDate,
          bufferDays: bufferDays,
          requestedQty: item.qty
        });

        if (!avail.can_book) {
          throw new Error(`Not enough availability for ${item.productName}${item.variationName ? ` (${item.variationName})` : ''} on selected dates. Only ${avail.available_quantity} available.`);
        }

        // Authoritative verification of assigned physical unit IDs against genuine conflicts
        const assignedUnitIds = (item as any).inventoryItemIds as string[] | undefined;
        if (assignedUnitIds && assignedUnitIds.length > 0) {
          const eligibleUnits = await getEligiblePhysicalUnits(supabase, {
            branchId: branch.id,
            variationId: item.variationId,
            pickupDate: draft.pickupDate,
            returnDate: draft.returnDate,
            bufferDays: bufferDays,
          });
          const eligibleIdSet = new Set(eligibleUnits.map(u => u.id));
          for (const uId of assignedUnitIds) {
            if (!eligibleIdSet.has(uId)) {
              throw new Error(`Selected physical unit for ${item.productName} is no longer available on selected dates.`);
            }
          }
        }
      }
    }

    // 4. Stage 2 Concurrency-Safe Atomic Creation (createBookingAtomic)
    const bookingDate = today;

    const days = daysBetween(draft.pickupDate, draft.returnDate);

    const payloadItems = draft.items.map(item => ({
      productId: item.productId,
      variationId: item.variationId!,
      productName: item.productName,
      sku: item.sku,
      imageUrl: item.image,
      qty: item.qty,
      dailyRate: item.dailyRate,
      pickupDate: draft.pickupDate,
      returnDate: draft.returnDate,
      bufferDays: bufferDays,
      subtotal: item.qty * item.dailyRate * days,
      inventoryItemIds: (item as any).inventoryItemIds || []
    }));

    const grossAmount = payloadItems.reduce((acc, item) => acc + item.subtotal, 0);
    const discount = draft.discount || 0;
    const discountMsg = discountError(grossAmount, discount);
    if (discountMsg) throw new Error(discountMsg);
    const totalAmount = netTotal(grossAmount, discount);
    const advancePaid = draft.advancePaid || 0;
    const securityDeposit = draft.securityDeposit || 0;
    const advancePaymentMethod = draft.advancePaymentMethod;
    const securityDepositPaymentMethod = draft.securityDepositPaymentMethod;

    const result = await createBookingAtomic(supabase, {
      customerId,
      branchId: branch.id,
      bookingDate,
      status: 'confirmed',
      notes: draft.notes?.trim() || undefined,
      total: totalAmount,
      discount,
      advance: advancePaid,
      securityDeposit: securityDeposit,
      advancePaymentMethod: advancePaymentMethod,
      securityDepositPaymentMethod: securityDepositPaymentMethod,
      items: payloadItems
    });

    if (!result.success || !result.bookingId) {
      throw new Error("Failed to create booking");
    }

    // 5. Source of truth update from DB
    const updatedBookings = await fetchBookings();
    await fetchInitialData({ silent: true });
    
    // Clear cart upon successful persistence and sync
    clearRentalDraft();
    clearCart();

    // The booking is saved. If the refresh failed, build the confirmation from what we just sent
    // instead of reporting an error for a booking that exists.
    const createdBooking: Booking = updatedBookings.find(b => b.id === result.bookingId) ?? {
      id: result.bookingId,
      token: result.token || "",
      customerId,
      customerName: draft.customerName,
      customerPhone: draft.customerPhone,
      branchId: branch.id,
      branchName: branch.name,
      bookingDate,
      status: 'confirmed',
      notes: draft.notes?.trim() || undefined,
      total: totalAmount,
      advance: advancePaid,
      securityDeposit,
      items: payloadItems,
    };

    if (!createdBooking.token && result.token) {
      createdBooking.token = result.token;
    }

    return createdBooking;
  }, [supabase, fetchBookings, clearCart, fetchInitialData]);



  const cancelBooking = useCallback(async (
    id: string,
    cancellationFee: number = 0,
    refundPaymentMethod: string = "cash",
    cancellationReason: string = ""
  ): Promise<void> => {
    try {
      await cancelBookingAction(id, cancellationFee, refundPaymentMethod, cancellationReason);
    } catch (e) {
      // A lost session makes proxy.ts redirect the action to /login, which surfaces as an opaque error.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Your session ended, please sign in again.");
      throw e;
    }

    setBookings((prev) => prev.map((b) => (b.id === id ? {
      ...b,
      status: 'cancelled',
      remaining: 0,
      cancellationFee,
      advanceRefund: Math.max(0, (b.advance || 0) - cancellationFee),
      securityDepositRefund: b.securityDeposit || 0,
      refundPaymentMethod: refundPaymentMethod as any,
      cancellationReason
    } : b)));
    await fetchBookings();
    await fetchInitialData({ silent: true });
  }, [supabase, fetchBookings, fetchInitialData]);

  const pickupBooking = useCallback(async (bookingId: string, expectedReturnDate: string, pickupPayment: number, pickupPaymentMethod: string): Promise<void> => {
    // 1. Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      throw new Error("You must be logged in to complete pickup.");
    }

    // 2. Fetch the matching profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, is_active')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      throw new Error("Your employee profile could not be found. Please contact an administrator.");
    }

    if (!profile.is_active) {
      throw new Error("Your employee profile is inactive. Please contact an administrator.");
    }

    // 3. Call the RPC with the resolved staff ID and expected return date
    const { data, error } = await supabase.rpc('pickup_booking_atomic', {
      p_booking_id: bookingId,
      p_expected_return_date: expectedReturnDate,
      p_pickup_payment: pickupPayment,
      p_staff_id: profile.id,
      p_payment_method: pickupPaymentMethod
    });

    if (error) {
      throw new Error(error.message);
    }
    
    // Refresh bookings and rentals after atomic creation
    await fetchBookings();
    
    // Also trigger initial data fetch to get new rentals and sync stock silently
    await fetchInitialData({ silent: true });
  }, [supabase, fetchBookings, fetchInitialData]);

  const updateRental: StoreValue["updateRental"] = useCallback((id, patch) => {
    const before = rentals.find((r) => r.id === id);
    setRentals((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    if (!id.startsWith('r')) {
      const dbPatch: any = {};
      // Only notes may be updated directly; money, dates and status are locked by a DB trigger
      // and change only through the atomic RPCs (extend / return / record payment).
      if (patch.notes !== undefined) dbPatch.notes = patch.notes;

      if (Object.keys(dbPatch).length > 0) {
        supabase.from('rentals').update(dbPatch).eq('id', id).then(({ error }) => {
          if (!error) return;
          // the database refused the change, so undo the optimistic update
          if (before) setRentals((prev) => prev.map((r) => (r.id === id ? { ...r, notes: before.notes } : r)));
          toast.error("Could not save the rental: " + error.message);
        });
      }
    }
  }, [supabase, rentals]);

  const extendRental: StoreValue["extendRental"] = useCallback(async (id, newDueDate, paymentAmount, paymentMethod, notes) => {
    const { data, error } = await supabase.rpc('extend_rental_atomic', {
      p_rental_id: id,
      p_new_due_date: newDueDate,
      p_payment_amount: paymentAmount,
      p_payment_method: paymentMethod,
      p_notes: notes
    });

    if (error) {
      throw new Error(error.message);
    }
    
    // Refresh to get updated totals, due date, and new payments
    await fetchBookings();
    await fetchInitialData({ silent: true });
  }, [supabase, fetchBookings, fetchInitialData]);

  // Records a real payment (row in `payments` + advance + derived status) via the database function.
  const recordPayment: StoreValue["recordPayment"] = useCallback(async (rentalId, amount, method) => {
    const { data, error } = await supabase.rpc('record_rental_payment', {
      p_rental_id: rentalId,
      p_amount: amount,
      p_method: method,
    });

    if (error) {
      throw new Error(error.message);
    }

    setRentals((prev) => prev.map((r) => (
      r.id === rentalId
        ? { ...r, advance: Number(data?.advance ?? r.advance), paymentStatus: (data?.payment_status ?? r.paymentStatus) as any }
        : r
    )));
  }, [supabase]);

  // Targeted post-return synchronization to update physical inventory & product availability
  const syncAfterReturn = useCallback(async (
    rentalId: string,
    returnDetails: {
      status: 'returned';
      paymentStatus: PaymentStatus;
      condition: ReturnCondition;
      returnedOn: string;
      total: number;
      advance: number;
      notes: string;
      extra_fees?: number;
      extra_fees_reason?: string;
      depositDeducted?: number;
      depositRefunded?: number;
      depositRefundMethod?: string;
      items?: { inventory_item_id: string; condition: string; return_notes?: string }[];
    }
  ) => {
    // 1. Identify affected variation IDs and product IDs (checking local rentals state first)
    const targetRental = rentals.find((r) => r.id === rentalId);
    let affectedVariationIds: string[] = [];
    const affectedProductIds = new Set<string>();

    if (targetRental?.items && targetRental.items.length > 0) {
      affectedVariationIds = [
        ...new Set(
          targetRental.items
            .map((i) => i.variationId)
            .filter((id): id is string => Boolean(id))
        ),
      ];
      targetRental.items.forEach((i) => {
        if (i.productId) affectedProductIds.add(i.productId);
      });
    } else {
      // Fallback: Query DB directly for rental items if target rental was not loaded in local memory
      const { data: dbItems } = await supabase
        .from("rental_items")
        .select("variation_id, product_variations(product_id)")
        .eq("rental_id", rentalId);

      if (dbItems) {
        dbItems.forEach((item: any) => {
          if (item.variation_id) affectedVariationIds.push(item.variation_id);
          const prodId = item.product_variations?.product_id;
          if (prodId) affectedProductIds.add(prodId);
        });
        affectedVariationIds = [...new Set(affectedVariationIds)];
      }
    }

    // 2. Update the returned rental in local state cleanly
    const unitConditionMap = new Map(
      (returnDetails.items || []).map((u) => [u.inventory_item_id, u.condition])
    );

    setRentals((prev) => {
      return prev.map((r) => {
        if (r.id !== rentalId) return r;
        return {
          ...r,
          status: "returned" as const,
          paymentStatus: returnDetails.paymentStatus,
          condition: returnDetails.condition,
          returnedOn: returnDetails.returnedOn,
          total: returnDetails.total,
          advance: returnDetails.advance,
          notes: returnDetails.notes,
          extra_fees: returnDetails.extra_fees,
          extra_fees_reason: returnDetails.extra_fees_reason,
          depositDeducted: returnDetails.depositDeducted,
          depositRefunded: returnDetails.depositRefunded,
          depositRefundMethod: returnDetails.depositRefundMethod,
          items: r.items?.map((item) => ({
            ...item,
            assignedUnits: item.assignedUnits?.map((u) => {
              const returnedCond = unitConditionMap.get(u.id);
              if (returnedCond) {
                const newStatus =
                  returnedCond === "lost"
                    ? "lost"
                    : returnedCond === "damaged"
                    ? "maintenance"
                    : "available";
                return { ...u, status: newStatus };
              }
              return u;
            }),
          })),
        };
      });
    });

    if (affectedVariationIds.length === 0) {
      await fetchInitialData({ silent: true });
      return;
    }

    // Record request version per affected variation to safely handle concurrency across products
    const reqVersion = ++syncVersionRef.current;
    affectedVariationIds.forEach((vId) => {
      variationSyncVersionRef.current.set(vId, reqVersion);
    });

    // 3. Targeted fetch: query fresh inventory_items for ONLY affected variations
    const { data: freshInvItems, error: invErr } = await supabase
      .from("inventory_items")
      .select("id, variation_id, branch_id, status")
      .in("variation_id", affectedVariationIds);

    if (invErr || !freshInvItems) {
      console.error("Failed to sync inventory after return:", invErr);
      await fetchInitialData({ silent: true });
      return;
    }

    // 4. Aggregate inventory statistics by variation_id and branch_id
    const invStatsMap = new Map<
      string,
      Map<string, { available: number; rented: number; maintenance: number; lost: number }>
    >();

    freshInvItems.forEach((item: any) => {
      if (!item.variation_id || !item.branch_id) return;
      if (!invStatsMap.has(item.variation_id)) {
        invStatsMap.set(item.variation_id, new Map());
      }
      const byBranch = invStatsMap.get(item.variation_id)!;
      if (!byBranch.has(item.branch_id)) {
        byBranch.set(item.branch_id, { available: 0, rented: 0, maintenance: 0, lost: 0 });
      }
      const counts = byBranch.get(item.branch_id)!;
      if (item.status === "available") counts.available++;
      else if (item.status === "rented") counts.rented++;
      else if (item.status === "maintenance") counts.maintenance++;
      else if (item.status === "lost") counts.lost++;
    });

    // 5. Update products state: recalculate derived stockDetails without mutating total physical stock (v.stock)
    setProducts((prevProducts) => {
      return prevProducts.map((p) => {
        if (!affectedProductIds.has(p.id) || !p.variations) return p;

        const updatedVariations = p.variations.map((v) => {
          if (!affectedVariationIds.includes(v.id)) return v;

          // Prevent race condition: skip variation if a newer sync already started for it
          if (variationSyncVersionRef.current.get(v.id) !== reqVersion) return v;

          const updatedStockDetails: Record<string, BranchStock> = { ...v.stockDetails };
          const branchNames = new Set([
            ...Object.keys(v.stock || {}),
            ...Object.keys(v.stockDetails || {}),
          ]);

          for (const branchName of branchNames) {
            const loc = locations.find((l) => l.name === branchName);
            const counts =
              (loc && invStatsMap.get(v.id)?.get(loc.id)) || {
                available: 0,
                rented: 0,
                maintenance: 0,
                lost: 0,
              };
            const totalStockForBranch =
              v.stock[branchName] ??
              (counts.available + counts.rented + counts.maintenance + counts.lost);

            updatedStockDetails[branchName] = {
              total: totalStockForBranch,
              available: counts.available,
              onRent: counts.rented,
              maintenance: counts.maintenance,
              lost: counts.lost,
            };
          }

          return {
            ...v,
            stockDetails: updatedStockDetails,
            // v.stock is preserved untouched!
          };
        });

        return {
          ...p,
          variations: updatedVariations,
        };
      });
    });
  }, [supabase, locations, rentals, fetchInitialData]);

  // returnRental: called by ReturnRentalModal. The database function settles the deposit
  // (taken against fees / refunded), records any payment, and derives total, advance and status.
  const returnRental: StoreValue["returnRental"] = useCallback(async (
    rentalId,
    items,
    returnedOn,
    settlement,
  ): Promise<void> => {
    let finalReturnedAt = returnedOn;
    if (finalReturnedAt.length === 10) {
      if (finalReturnedAt === todayISO()) {
        finalReturnedAt = new Date().toISOString();
      } else {
        finalReturnedAt = finalReturnedAt + 'T12:00:00Z';
      }
    }

    // Overall rental condition = worst unit condition
    const conditionRank = { lost: 2, damaged: 1, good: 0 };
    let worstCondition: 'good' | 'damaged' | 'lost' = 'good';
    for (const unit of items) {
      const rank = conditionRank[unit.condition as keyof typeof conditionRank] ?? 0;
      if (rank > conditionRank[worstCondition]) {
        worstCondition = unit.condition as 'good' | 'damaged' | 'lost';
      }
    }

    const { data, error: rpcError } = await supabase.rpc('mark_returned_atomic', {
      p_rental_id: rentalId,
      p_returned_on: finalReturnedAt,
      p_condition: worstCondition,
      p_notes: settlement.notes ?? '',
      p_extra_fees: settlement.extra_fees || 0,
      p_extra_fees_reason: settlement.extra_fees_reason || null,
      p_items: items,
      p_deposit_deducted: settlement.deposit_deducted || 0,
      p_deposit_refund_method: settlement.deposit_refund_method || null,
      p_settlement_payment: settlement.payment_amount || 0,
      p_payment_method: settlement.payment_method || null,
    });

    if (rpcError) {
      console.error("Failed to mark returned via returnRental:", rpcError);
      throw new Error("Return failed: " + rpcError.message);
    }

    await syncAfterReturn(rentalId, {
      status: 'returned',
      paymentStatus: data?.payment_status,
      condition: worstCondition,
      returnedOn: finalReturnedAt,
      total: Number(data?.total),
      advance: Number(data?.advance),
      notes: settlement.notes ?? '',
      extra_fees: settlement.extra_fees || 0,
      extra_fees_reason: settlement.extra_fees_reason,
      depositDeducted: Number(data?.deposit_deducted) || 0,
      depositRefunded: Number(data?.deposit_refunded) || 0,
      depositRefundMethod: settlement.deposit_refund_method,
      items,
    });
  }, [supabase, syncAfterReturn]);

  const commitImport: StoreValue["commitImport"] = useCallback(async (result) => {
    const { data, error } = await supabase.rpc('import_products_atomic', { p_payload: result });
    if (error) {
      throw error;
    }
    
    // Refresh the store data so the UI reflects the new products
    await fetchInitialData({ silent: true });
    return data;
  }, [supabase, fetchInitialData]);

  const createLocation: StoreValue["createLocation"] = useCallback((draft) => {
    const tempId = `l${Date.now()}`;
    setLocations((prev) => [...prev, { ...draft, id: tempId }]);
    
    supabase.from('branches').insert({
      name: draft.name,
      slug: draft.slug,
      email: draft.email || null,
      phone: draft.phone || null,
      address: draft.address || null,
      is_active: draft.enabled !== false
    }).select('id').single().then(({ data, error }) => {
      if (data && !error) {
        setLocations(prev => prev.map(l => l.id === tempId ? { ...l, id: data.id } : l));
      } else {
        console.error("Failed to insert branch:", error);
      }
    });
  }, [supabase]);

  // One database call decides: no history -> deleted; any rental/booking history -> deactivated.
  const deleteProduct: StoreValue["deleteProduct"] = useCallback((id) => {
    const productToDelete = products.find((p) => p.id === id);

    if (id.startsWith('p')) {
      setProducts((prev) => prev.filter((p) => p.id !== id));
      return;
    }

    (async () => {
      const { data, error } = await supabase.rpc('delete_or_deactivate_product', { p_product_id: id });

      if (error) {
        console.error("Failed to delete product:", error);
        toast.error(error.message || "Could not delete this product.");
        return;
      }

      if (data?.result === 'deactivated') {
        setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, isActive: false } : p)));
        toast.info("This product has rental history, so it was deactivated instead of deleted. Use Reactivate in All Products to bring it back.");
        return;
      }

      setProducts((prev) => prev.filter((p) => p.id !== id));
      toast.success("Product deleted.");

      if (productToDelete?.image && productToDelete.image.includes('product_images/')) {
        const parts = productToDelete.image.split('/');
        const filename = parts[parts.length - 1];
        if (filename) {
          await supabase.storage.from("product_images").remove([filename]);
        }
      }
    })();
  }, [supabase, products]);


  // Reactivating a product also re-enables its variations (deactivation disabled all of them).
  const setProductActive: StoreValue["setProductActive"] = useCallback(async (id, active) => {
    const { error } = await supabase.from('products').update({ is_active: active }).eq('id', id);
    if (error) {
      throw new Error(error.message);
    }
    if (active) {
      await supabase.from('product_variations').update({ is_enabled: true }).eq('product_id', id);
    }
    await fetchInitialData({ silent: true });
  }, [supabase, fetchInitialData]);

  const addCategory = useCallback(async (name: string, baseSku?: string) => {
    const { data, error } = await supabase.from("categories").insert({
      name,
      base_sku: baseSku || null
    }).select("*").single();

    if (error || !data) {
      console.error("Failed to add category:", error);
      return null;
    }

    const newCat: Category = { id: data.id, name: data.name, base_sku: data.base_sku || undefined };
    setCategories(prev => [...prev, newCat]);
    return newCat;
  }, [supabase]);

  const deleteCategory = useCallback(async (id: string) => {
    // Backstop for products added on another device: never leave products without a category/SKU prefix.
    const { count } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("category_id", id);
    if (count) {
      toast.error(`This category is used by ${count} product(s). Move them to another category first.`);
      return;
    }
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) {
      console.error("Failed to delete category:", error);
      return;
    }
    setCategories(prev => prev.filter(c => c.id !== id));
  }, [supabase]);

  const value = useMemo(() => ({
    isLoading, products, rentals, bookings, branches, locations, categories, cart,
    createProduct, updateProduct, deleteProduct, setProductActive, createBooking, pickupBooking, fetchBookings, cancelBooking, updateRental, extendRental, recordPayment, returnRental, commitImport, createLocation, addCategory, deleteCategory, addToCart, removeFromCart, updateCartItemQty, clearCart, discardRentalDraft,
    fetchInitialData, loadError
  }), [isLoading, products, rentals, bookings, branches, locations, categories, cart, createProduct, updateProduct, deleteProduct, setProductActive, createBooking, pickupBooking, fetchBookings, cancelBooking, updateRental, extendRental, recordPayment, returnRental, commitImport, createLocation, addCategory, deleteCategory, addToCart, removeFromCart, updateCartItemQty, clearCart, discardRentalDraft, fetchInitialData, loadError]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useOverbooked() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useOverbooked must be used inside OverbookedProvider");
  return ctx;
}


