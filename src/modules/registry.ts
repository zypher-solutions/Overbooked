import type { ComponentType } from "react";
import { standardNav, type ModuleKey, type NavContext, type NavGroup } from "@/lib/shop/nav";
import { Today } from "@/components/shop/Today";
import { clothingNav } from "@/modules/clothing/nav";
import type { Product } from "@/lib/shop/types";
import { TrendzDashboard } from "@/modules/clothing/components/TrendzDashboard";
import { ProductWizard } from "@/modules/clothing/components/ProductWizard";
import { importSkus } from "@/modules/clothing/sku";

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
  /** its own form for adding and changing a product (sets keep the shared one); without it, the shared form and pieces list */
  ProductForm?: ComponentType<{ product?: Product }>;
  /** what the product list is called in its menu */
  productsTitle?: string;
  /** numbers SKUs left empty in a CSV import and checks typed ones; without it, SKUs are typed in full */
  importSkus?: typeof importSkus;
}

export const shopModules: Record<ModuleKey, ShopModule> = {
  clothing: {
    nav: clothingNav, Home: TrendzDashboard, tagline: "Rental Studio",
    screens: ["/finance", "/bookings", "/all-rentals", "/scan", "/stock-locations"],
    ProductForm: ProductWizard, productsTitle: "All Products", importSkus,
    replace: (path, canManage) => (path === "/rentals" ? "/bookings" : path === "/dashboard" ? (canManage ? "/finance" : "/") : null),
  },
  standard: { nav: standardNav, Home: Today, tagline: "Overbooked", screens: [] },
};
