import { Boxes, Building2, CalendarClock, CalendarDays, CalendarPlus, ClipboardList, Home, LayoutGrid, LineChart, Settings, Users, UserSquare, type LucideIcon } from "lucide-react";

// The side menus. Each business type module supplies its own (src/modules/<name>/nav.ts); this file holds the shared ones.
export type NavItem = { href: string; label: string; icon: LucideIcon; show: boolean };
export type NavGroup = { title?: string; items: NavItem[] };

/** what a menu needs to know about the signed-in person and shop */
export interface NavContext {
  isOwner: boolean; canManage: boolean; isSupport: boolean; isZypher: boolean;
  feature: (key: string) => boolean;
  word: (key: "item" | "items" | "unit" | "units" | "start" | "end", fallback?: string) => string;
}

// Zypher's console only sets a shop up: branches, staff, stock locations. It never sees bookings, customers or money.
export const setupNav = (): NavGroup[] => [{ title: "Setup", items: [
  { href: "/branches", label: "Branch Management", icon: Building2, show: true },
  { href: "/staff", label: "Staff Management", icon: Users, show: true },
  { href: "/stock-locations", label: "Stock Locations", icon: Boxes, show: true },
] }];

// cars, bikes and resorts
export const standardNav = (c: NavContext): NavGroup[] => [{ items: [
  { href: "/", label: "Today", icon: Home, show: true },
  { href: "/book", label: "New booking", icon: CalendarPlus, show: true },
  { href: "/rentals", label: "Bookings", icon: ClipboardList, show: true },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, show: true },
  { href: "/appointments", label: "Appointments", icon: CalendarClock, show: c.feature("appointments") },
  { href: "/customers", label: "Customers", icon: UserSquare, show: true },
  { href: "/catalog", label: c.word("items", "Catalog"), icon: LayoutGrid, show: true },
  { href: "/dashboard", label: "Money and reports", icon: LineChart, show: c.canManage },
  { href: "/settings", label: "Shop settings", icon: Settings, show: c.isOwner },
] }];
