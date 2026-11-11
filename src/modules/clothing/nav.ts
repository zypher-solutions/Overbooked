import {
  BarChart3,
  Barcode,
  SlidersHorizontal,
  Calendar,
  ScanLine,
  CalendarClock,
  CalendarDays,
  LayoutGrid,
  Plus,
  Settings,
  Gem,
  History,
  Sheet,
  Tag,
  TrendingUp,
  Wallet,
  UserSquare,
  Users,
} from "lucide-react";
import type { NavContext, NavGroup } from "@/lib/shop/nav";

// The menu of bridal, groom and other clothing shops (the TRENDZ screens)
export const clothingNav = (c: NavContext): NavGroup[] => [
  {
    title: "Work",
    items: [
      { href: "/", label: "Dashboard", icon: BarChart3, show: true },
      { href: "/finance", label: "Finance", icon: Wallet, show: c.canManage },
      { href: "/bookings", label: "Bookings", icon: Calendar, show: true },
      { href: "/calendar", label: "Calendar", icon: CalendarDays, show: true },
      {
        href: "/appointments",
        label: "Appointments",
        icon: CalendarClock,
        show: c.feature("appointments"),
      },
    ],
  },
  {
    title: "Inventory",
    items: [
      { href: "/scan", label: "Inventory search", icon: ScanLine, show: true },
      { href: "/catalog", label: "Products", icon: LayoutGrid, show: true },
      {
        href: "/catalog/new",
        label: "Add New Product",
        icon: Plus,
        show: c.canManage,
      },
      // the spreadsheet: many products at once, Excel paste, Excel/CSV files, and editing many saved products
      {
        href: "/catalog/bulk",
        label: "Bulk add & edit",
        icon: Sheet,
        show: c.canManage,
      },
      {
        href: "/catalog?tab=categories",
        label: "Categories",
        icon: Tag,
        show: c.canManage,
      },
      {
        href: "/catalog?tab=extras",
        label: "Accessories",
        icon: Gem,
        show: c.canManage,
      },
      {
        href: "/catalog/earnings",
        label: "Earnings by product",
        icon: TrendingUp,
        show: c.canManage,
      },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/customers", label: "Customers", icon: UserSquare, show: true },
    ],
  },
  // the owner runs staff and branches; where stock is kept shows for a Zypher support login
  {
    title: "Admin",
    items: [
      { href: "/staff", label: "Staff management", icon: Users, show: c.isOwner && !c.isSupport },
      { href: "/admin/attributes", label: "Attributes", icon: SlidersHorizontal, show: c.canManage },
      { href: "/admin/sku", label: "SKU", icon: Barcode, show: c.canManage },
      {
        href: "/branches",
        label: "Branch management",
        icon: Settings,
        show: c.isOwner,
      },
      { href: "/admin/activity", label: "Activity log", icon: History, show: c.isOwner && !c.isSupport },
    ],
  },
];
