import { BarChart3, Boxes, Calendar, CalendarClock, CalendarDays, ClipboardList, LayoutGrid, Plus, ScanLine, Settings, Tag, Upload, Wallet, UserSquare } from "lucide-react";
import type { NavContext, NavGroup } from "@/lib/shop/nav";

// The menu of bridal, groom and other clothing shops (the TRENDZ screens)
export const clothingNav = (c: NavContext): NavGroup[] => [
  { items: [
    { href: "/", label: "Dashboard", icon: BarChart3, show: true },
    { href: "/finance", label: "Finance", icon: Wallet, show: c.canManage },
  ] },
  { title: "Rentals", items: [
    { href: "/bookings", label: "Bookings", icon: Calendar, show: true },
    { href: "/scan", label: "Inventory Search", icon: ScanLine, show: true },
    { href: "/all-rentals", label: "All Rentals", icon: ClipboardList, show: true },
    { href: "/calendar", label: "Calendar", icon: CalendarDays, show: true },
    { href: "/customers", label: "Customers", icon: UserSquare, show: true },
    { href: "/appointments", label: "Appointments", icon: CalendarClock, show: c.feature("appointments") },
  ] },
  { title: "Products", items: [
    { href: "/catalog", label: "All Products", icon: LayoutGrid, show: true },
    { href: "/catalog/new", label: "Add New Product", icon: Plus, show: c.canManage },
    { href: "/catalog?tab=categories", label: "Categories", icon: Tag, show: c.canManage },
    { href: "/catalog/import", label: "CSV Import", icon: Upload, show: c.canManage },
  ] },
  // branches and staff are set up by Zypher; where stock is kept shows for a Zypher support login
  { title: "Admin", items: [
    { href: "/stock-locations", label: "Stock Locations", icon: Boxes, show: c.isSupport },
    { href: "/settings", label: "Shop settings", icon: Settings, show: c.isOwner },
  ] },
];
