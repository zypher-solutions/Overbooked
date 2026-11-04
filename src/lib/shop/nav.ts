import {
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  Home,
  LayoutGrid,
  LineChart,
  Settings,
  UserSquare,
  type LucideIcon,
} from "lucide-react";

// The side menus. Each business type module supplies its own (src/modules/<name>/nav.ts); this file holds the shared ones.
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  show: boolean;
};
export type NavGroup = { title?: string; items: NavItem[] };
/** the set of screens a shop uses; each key has an entry in src/modules/registry.ts */
export type ModuleKey = "clothing" | "standard";

/** what a menu needs to know about the signed-in person and shop */
export interface NavContext {
  isOwner: boolean;
  canManage: boolean;
  isSupport: boolean;
  feature: (key: string) => boolean;
  word: (
    key: "item" | "items" | "unit" | "units" | "start" | "end",
    fallback?: string,
  ) => string;
}

// cars, bikes and resorts
export const standardNav = (c: NavContext): NavGroup[] => [
  {
    title: "Work",
    items: [
      { href: "/", label: "Today", icon: Home, show: true },
      { href: "/book", label: "New booking", icon: CalendarPlus, show: true },
      { href: "/rentals", label: "Bookings", icon: ClipboardList, show: true },
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
    title: "People",
    items: [
      { href: "/customers", label: "Customers", icon: UserSquare, show: true },
    ],
  },
  {
    title: "Inventory",
    items: [
      {
        href: "/catalog",
        label: c.word("items", "Catalog"),
        icon: LayoutGrid,
        show: true,
      },
    ],
  },
  {
    title: "Money",
    items: [
      {
        href: "/dashboard",
        label: "Money and reports",
        icon: LineChart,
        show: c.canManage,
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        href: "/settings",
        label: "Shop settings",
        icon: Settings,
        show: c.isOwner,
      },
    ],
  },
];
