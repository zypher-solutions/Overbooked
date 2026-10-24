// Row shapes of the v2 database as the shop app reads them.

export type Role = "super_admin" | "owner" | "manager" | "staff";
export type Kind = "wearable" | "vehicle" | "room";
export type RentalStatus = "reserved" | "active" | "completed" | "cancelled" | "no_show";
export type PaymentKind = "payment" | "refund" | "deposit" | "deposit_refund" | "deposit_applied";
export type Method = "cash" | "upi" | "card" | "bank_transfer";
export type RateType = "hour" | "day" | "night" | "extra_km" | "extra_hour" | "extra_person" | "driver_day" | "late_penalty";
export type ChargeType = "late" | "extra_km" | "fuel" | "damage" | "lost" | "cleaning" | "toll" | "parking" | "challan"
  | "alteration" | "extra_person" | "other";
export type UnitStatus = "available" | "maintenance" | "lost" | "retired";
export type AddOnBasis = "per_rental" | "per_day" | "per_unit_day" | "per_person_night";

export interface FieldDef { key: string; label: string; type: "text" | "number" | "select"; options?: string[]; required?: boolean }

export interface Template {
  key: string;
  name: string;
  kind: Kind;
  labels: Record<string, string>;
  variation_fields: FieldDef[];
  unit_fields: FieldDef[];
  checks: { pickup?: string[]; return?: string[] };
  rate_types: RateType[];
  turnaround: string;
  features: Record<string, boolean>;
  default_add_ons: { name: string; basis: AddOnBasis; amount: number }[];
  measurement_fields: string[];
  sort: number;
}

export interface Branch { id: string; name: string; slug: string; is_active: boolean; phone: string | null; address: string | null; email: string | null }
export interface Category { id: string; name: string; template_key: string; sku_prefix: string | null }
export interface AddOn { id: string; name: string; basis: AddOnBasis; amount: number; template_keys: string[]; is_active: boolean }

export interface Rate { rate_type: RateType; amount: number }
export interface Variation {
  id: string;
  product_id: string;
  name: string;
  sku: string;
  attributes: Record<string, string | number>;
  base_occupancy: number | null;
  max_occupancy: number | null;
  km_included_per_day: number | null;
  turnaround: string;
  is_enabled: boolean;
  variation_rates?: Rate[];
}
export interface Product {
  id: string;
  category_id: string;
  name: string;
  sku: string;
  description: string | null;
  image_url: string | null;
  purchase_price: number;
  replacement_value: number;
  is_set: boolean;
  is_active: boolean;
  product_variations?: Variation[];
}
export interface Unit {
  id: string;
  product_id: string;
  variation_id: string;
  branch_id: string;
  code: string;
  status: UnitStatus;
  status_reason: string | null;
  attributes: Record<string, string | number>;
  odometer: number | null;
}

export interface Customer {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  address: string | null;
  id_type: string | null;
  id_number: string | null;
  licence_number: string | null;
  licence_expiry: string | null;
  is_blocked: boolean;
  blocked_reason: string | null;
  notes: string | null;
  created_at: string;
}

export interface Rental {
  id: string;
  branch_id: string;
  customer_id: string;
  token: string;
  status: RentalStatus;
  start_at: string;
  end_at: string;
  actual_start_at: string | null;
  actual_end_at: string | null;
  adults: number;
  children: number;
  with_driver: boolean;
  whole_property: boolean;
  deposit_agreed: number;
  items_total: number;
  add_ons_total: number;
  charges_total: number;
  discount: number;
  cancellation_fee: number;
  total: number;
  paid: number;
  deposit_received: number;
  deposit_refunded: number;
  deposit_applied: number;
  id_verified_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  notes: string | null;
  created_at: string;
  customers?: Pick<Customer, "id" | "full_name" | "phone"> & Partial<Customer>;
  rental_lines?: RentalLine[];
}

export interface RentalLine {
  id: string;
  product_id: string;
  variation_id: string;
  kind: Kind;
  description: string;
  sku: string;
  image_url: string | null;
  qty: number;
  rate_type: string;
  rate: number;
  time_units: number;
  amount: number;
  is_override: boolean;
}
export interface Reservation {
  id: string;
  line_id: string;
  unit_id: string;
  period: string;
  state: "held" | "out" | "returned" | "released";
  units?: Pick<Unit, "id" | "code" | "odometer" | "status" | "status_reason" | "variation_id">;
}
export interface RentalAddOn { id: string; add_on_id: string; name: string; basis: AddOnBasis; quantity: number; unit_amount: number; amount: number }
export interface Charge { id: string; type: ChargeType; amount: number; note: string | null; created_at: string }
export interface Check {
  id: string;
  unit_id: string;
  phase: "pickup" | "return";
  condition: "good" | "damaged" | "lost" | null;
  odometer: number | null;
  fuel_level: number | null;
  notes: string | null;
  photo_paths: string[];
  checked_at: string;
}
export interface Payment {
  id: string;
  rental_id: string;
  kind: PaymentKind;
  amount: number;
  method: Method | null;
  paid_at: string;
  note: string | null;
}

// quote_rental output
export interface QuoteLine {
  product_id: string;
  variation_id: string;
  kind: Kind;
  description: string;
  sku: string;
  qty: number;
  rate_type: string;
  rate: number;
  time_units: number;
  amount: number;
  is_override: boolean;
  reserve: boolean;
}
export interface Quote {
  lines: QuoteLine[];
  add_ons: { add_on_id: string; name: string; basis: AddOnBasis; quantity: number; unit_amount: number; amount: number }[];
  items_total: number;
  add_ons_total: number;
  total_before_discount: number;
  days: number;
  nights: number;
  hours: number;
}

export type AppointmentType = "fitting" | "trial" | "delivery" | "collection" | "inspection" | "other";
export interface Appointment {
  id: string;
  branch_id: string;
  customer_id: string;
  rental_id: string | null;
  type: AppointmentType;
  scheduled_at: string;
  status: "scheduled" | "done" | "missed" | "cancelled";
  notes: string | null;
  customers?: { id: string; full_name: string; phone: string } | null;
  rentals?: { token: string } | null;
}

export interface Measurement {
  id: string;
  customer_id: string;
  label: string;
  measurements: Record<string, string>;
  notes: string | null;
  taken_at: string;
}

export interface SetItem { variation_id: string; qty: number }
