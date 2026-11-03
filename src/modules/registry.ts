import type { ComponentType } from "react";
import { standardNav, type ModuleKey, type NavContext, type NavGroup } from "@/lib/shop/nav";
import { Today } from "@/components/shop/Today";
import { clothingNav } from "@/modules/clothing/nav";
import { TrendzDashboard } from "@/modules/clothing/components/TrendzDashboard";

// The one place the shop app picks a module. A new business type: add its key to ModuleKey (src/lib/shop/nav.ts) and an entry here.
export interface ShopModule {
  nav: (c: NavContext) => NavGroup[];
  Home: ComponentType;
  /** under the shop name in the side menu */
  tagline: string;
  /** screens only this module has: a shop of another module typing their address goes home */
  screens: string[];
  /** a shared screen this module shows its own version of */
  replace?: (path: string, canManage: boolean) => string | null;
}

export const shopModules: Record<ModuleKey, ShopModule> = {
  clothing: {
    nav: clothingNav, Home: TrendzDashboard, tagline: "Rental Studio",
    screens: ["/finance", "/bookings", "/all-rentals", "/scan", "/stock-locations"],
    replace: (path, canManage) => (path === "/rentals" ? "/bookings" : path === "/dashboard" ? (canManage ? "/finance" : "/") : null),
  },
  standard: { nav: standardNav, Home: Today, tagline: "Overbooked", screens: [] },
};
