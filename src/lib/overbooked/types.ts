export type PaymentStatus = "unpaid" | "partial" | "paid";
export type PaymentMethod = "cash" | "upi" | "card" | "bank_transfer";
export type RentalStatus = "out" | "returned";
export type ReturnCondition = "good" | "damaged" | "lost";
export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";

export interface BranchStock {
  total: number;
  available: number;
  onRent: number;
  maintenance: number;
  lost: number;
}

export interface ProductVariation {
  id: string;
  name: string;
  sku: string;
  dailyRate: number;
  stock: Record<string, number>; // Total stock
  stockDetails?: Record<string, BranchStock>; // Detailed breakdown
  attributes: Record<string, string>;
  enabled: boolean;
  physicalItems?: InventoryItem[];
}

export interface InventoryItem {
  id: string;
  productId: string;
  variationId: string;
  branchId: string;
  itemSku: string;
  status: "available" | "rented" | "maintenance";
  qrToken?: string;
}

export interface ProductAttribute {
  name: string;
  values: string[];
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  dailyRate: number;
  image: string;
  description?: string;
  category: string;
  purchasePrice?: number;
  attributes?: ProductAttribute[];
  variations?: ProductVariation[];
  createdAt?: string;
  isActive?: boolean;
}

export interface RentalItem {
  id?: string;
  productId: string;
  productName: string;
  variationId?: string;
  variationName?: string;
  sku: string;
  image: string;
  qty: number;
  dailyRate: number;
  assignedUnits?: PhysicalInventoryUnit[];
  inventoryItemIds?: string[];
  assignedUnitSkus?: string[];
}

export interface Rental {
  id: string;
  token: string;
  items: RentalItem[];
  branch: string;
  customerName: string;
  customerPhone: string;
  rentDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  total: number;
  advance: number;
  securityDeposit?: number;
  paymentStatus: PaymentStatus;
  status: RentalStatus | BookingStatus;
  notes: string;
  returnedOn?: string;
  condition?: ReturnCondition;
  bufferDays?: number;
  /** Breakdown only: `total` already includes these fees once the rental is returned. */
  extra_fees?: number;
  extra_fees_reason?: string;
  depositDeducted?: number;
  depositRefunded?: number;
  depositRefundMethod?: PaymentMethod | string;
  isBooking?: boolean;
  bookingRef?: Booking;
  cancellationFee?: number;
  advanceRefund?: number;
  securityDepositRefund?: number;
  refundPaymentMethod?: PaymentMethod | string;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

export interface PhysicalInventoryUnit {
  id: string;
  itemSku: string;
  status: string;
}

export interface BookingItem {
  id?: string;
  bookingId?: string;
  productId?: string;
  variationId: string;
  productName: string;
  sku: string;
  imageUrl?: string;
  qty: number;
  dailyRate: number;
  pickupDate: string; // YYYY-MM-DD
  returnDate: string; // YYYY-MM-DD
  bufferDays: number;
  subtotal: number;
  assignedUnits?: PhysicalInventoryUnit[];
  inventoryItemIds?: string[];
  assignedUnitSkus?: string[];
}

export interface Booking {
  id: string;
  token: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  branchId: string;
  branchName?: string;
  bookingDate: string; // YYYY-MM-DD
  status: BookingStatus;
  notes?: string;
  total: number;
  advance: number;
  remaining?: number;
  securityDeposit: number;
  advancePaymentMethod?: PaymentMethod;
  securityDepositPaymentMethod?: PaymentMethod;
  items: BookingItem[];
  createdAt?: string;
  updatedAt?: string;
  cancellationFee?: number;
  advanceRefund?: number;
  securityDepositRefund?: number;
  refundPaymentMethod?: PaymentMethod | string;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

export interface CreateBookingDraft {
  items: (RentalItem & { inventoryItemIds?: string[] })[];
  branch: string; // Branch name or ID
  customerId?: string;
  customerName: string;
  customerPhone: string;
  pickupDate: string;
  returnDate: string;
  bufferDays?: number;
  advancePaid?: number;
  securityDeposit?: number;
  discount?: number;
  advancePaymentMethod?: PaymentMethod;
  securityDepositPaymentMethod?: PaymentMethod;
  notes?: string;
}

export interface RentalSessionDraft {
  items: RentalItem[];
  branch: string;
  customerName: string;
  customerPhone: string;
  selectedCustomerId?: string | null;
  conflictChoice?: "entered" | "existing" | null;
  pickupDate: string;
  returnDate: string;
  bufferDays: number;
  advancePaid: number | "";
  discount?: number | "";
  advancePaymentMethod: string;
  securityDeposit: number | "";
  securityDepositPaymentMethod: string;
  notes: string;
  selectedUnits: Record<string, string>;
  updatedAt: number;
}

export interface StockLocation {
  id: string;
  name: string;
  slug: string;
  address?: string;
  phone?: string;
  email: string;
  enabled: boolean;
}

export interface Category {
  id: string;
  name: string;
  base_sku?: string;
}

export interface PreviewVariation {
  color: string;
  size: string;
  sku: string;
  dailyRate: number;
  stockByBranch: Record<string, number>;
  totalUnits: number;
}

export interface PreviewProduct {
  name: string;
  category: string;
  description: string;
  purchasePrice: number;
  dailyRate: number;
  baseSku: string;
  variations: PreviewVariation[];
}

export interface ValidationResult {
  errors: string[];
  products: PreviewProduct[];
  newCategories: Array<{ name: string; prefix: string }>;
  existingCategoriesCount: number;
  totalVariations: number;
  totalUnits: number;
}
