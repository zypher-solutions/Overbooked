"use client";

import { useState, useEffect, useMemo } from "react";
import { Sidebar, type PageKey } from "@/components/overbooked/Sidebar";
import { RentalFormModal } from "@/components/overbooked/RentalFormModal";
import { WhatsAppModal } from "@/components/overbooked/WhatsAppModal";
import { RentalStatusModal } from "@/components/overbooked/RentalStatusModal";
import { ReplaceDraftModal } from "@/components/overbooked/ReplaceDraftModal";
import { EditRentalModal } from "@/components/overbooked/EditRentalModal";
import { ScanLookup } from "@/components/overbooked/pages/ScanLookup";
import { AllProducts } from "@/components/overbooked/pages/AllProducts";
import { AllRentals } from "@/components/overbooked/pages/AllRentals";
import { Dashboard } from "@/components/overbooked/pages/Dashboard";
import { CsvImport } from "@/components/overbooked/pages/CsvImport";
import { StockLocations } from "@/components/overbooked/pages/StockLocations";
import { Categories } from "@/components/overbooked/pages/Categories";
import { BranchManagement } from "@/components/overbooked/pages/BranchManagement";
import { StaffManagement } from "@/components/overbooked/pages/StaffManagement";
import { AddProduct } from "@/components/overbooked/pages/AddProduct";
import { Bookings } from "@/components/overbooked/pages/Bookings";
import { ZypherConsole } from "@/components/overbooked/pages/ZypherConsole";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { OfflineBanner } from "@/components/overbooked/OfflineBanner";
import { Menu, ShoppingCart } from "lucide-react";
import { useOverbooked } from "@/lib/overbooked/store";
import type { Rental, Product, RentalItem } from "@/lib/overbooked/types";
import { saveRentalDraft } from "@/lib/overbooked/draftStorage";

function OverbookedApp() {
  const [page, setPage] = useState<PageKey>("scan");
  const { profile, shop } = useAuth();
  // Zypher staff outside any shop only have the console
  const noShop = profile?.role === "super_admin" && !shop;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const { products, cart, addToCart, clearCart, discardRentalDraft, fetchInitialData, loadError } = useOverbooked();
  const [confirmed, setConfirmed] = useState<Rental | null>(null);
  const [statusProduct, setStatusProduct] = useState<Product | null>(null);
  const [pendingReplace, setPendingReplace] = useState<{
    product: Product;
    branch?: string;
    variationId?: string;
  } | null>(null);
  const [editing, setEditing] = useState<Rental | null>(null);
  
  const currentStatusProduct = useMemo(() => {
    if (!statusProduct) return null;
    return products.find((p) => p.id === statusProduct.id) || statusProduct;
  }, [products, statusProduct]);
  
  const [productToEditId, setProductToEditId] = useState<string | null>(null);

  // reopen the last page, unless this user's role may not see it (the browser may be shared)
  useEffect(() => {
    if (!profile) return;
    const saved = localStorage.getItem("overbooked_last_page") as PageKey;
    const role = profile.role;
    const allowed =
      saved === "zypher" ? role === "super_admin"
      : ["branches", "staff", "stock"].includes(saved) ? role === "super_admin" || role === "owner"
      : ["add-product", "categories", "import"].includes(saved) ? role !== "staff"
      : true;
    if (saved && allowed) setPage(saved);
  }, [profile]);

  const handlePageChange = (p: PageKey) => {
    setPage(p);
    localStorage.setItem("overbooked_last_page", p);
    if (p === "add-product") {
      setProductToEditId(null);
    }
    setIsMobileMenuOpen(false);
  };

  const executePutOut = (product: Product, branch?: string, variationId?: string) => {
    const v = product.variations?.find((x) => x.id === variationId);
    if (v) {
      discardRentalDraft();
      const item: RentalItem = {
        productId: product.id,
        productName: product.name,
        variationId: v.id,
        variationName: v.name,
        sku: v.sku,
        image: product.image,
        qty: 1,
        dailyRate: v.dailyRate || product.dailyRate || 0,
      };
      if (branch) {
        saveRentalDraft({
          items: [item],
          branch,
          customerName: "",
          customerPhone: "",
          selectedCustomerId: null,
          conflictChoice: null,
          pickupDate: "",
          returnDate: "",
          bufferDays: 0,
          advancePaid: 0,
          advancePaymentMethod: "",
          securityDeposit: 0,
          securityDepositPaymentMethod: "",
          notes: "",
          selectedUnits: {},
          updatedAt: Date.now(),
        });
      }
      addToCart(item);
      setIsCheckoutOpen(true);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Top Bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 min-h-16 pt-[env(safe-area-inset-top)] bg-surface border-b border-border z-20 flex items-center px-4">
        <button
          aria-label="Open menu"
          onClick={() => {
            setIsMobileMenuOpen(true);
          }}
          className="h-11 w-11 -ml-2 text-foreground hover:bg-black/5 rounded-md flex items-center justify-center"
        >
          <Menu className="w-6 h-6" />
        </button>
        <span className="ml-2 font-display font-semibold text-lg">{shop?.name ?? "Overbooked"}</span>
      </div>

      {/* Overlay for mobile sidebar */}
      {isMobileMenuOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/30 z-30 backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <Sidebar 
        active={page} 
        onChange={handlePageChange} 
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
      />
      
      <main className="lg:ml-64 min-w-0 px-4 sm:px-6 lg:px-8 py-6 lg:py-10 pt-[calc(5rem+env(safe-area-inset-top))] lg:pt-10 pb-28 lg:pb-10">
        <OfflineBanner />
        {loadError && (
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-rust/50 bg-rust/10 p-3 text-sm text-rust">
            <span>Couldn't load the latest data. What you see may be out of date.</span>
            <button onClick={() => fetchInitialData({ silent: true })} className="rounded-md border border-rust/50 px-3 py-1 font-medium hover:bg-rust/10">
              Retry
            </button>
          </div>
        )}
        {page === "zypher" || noShop ? <ZypherConsole /> : null}
        {noShop ? null : <>
        {page === "dashboard" ? <Dashboard onEdit={setEditing} /> : null}
        {page === "scan" ? <ScanLookup /> : null}
        {page === "bookings" ? <Bookings onNavigate={handlePageChange} /> : null}
        {page === "rentals" ? <AllRentals onOpen={setStatusProduct} /> : null}
        {page === "products" ? (
          <AllProducts 
            onOpen={setStatusProduct} 
            onEdit={(id) => {
              setProductToEditId(id);
              setPage("add-product");
            }}
          />
        ) : null}
        {page === "stock" ? <StockLocations /> : null}
        {page === "categories" ? <Categories /> : null}
        {page === "branches" ? <BranchManagement /> : null}
        {page === "staff" ? <StaffManagement /> : null}
        {page === "import" ? <CsvImport /> : null}
        {page === "add-product" ? (
          <AddProduct 
            productToEditId={productToEditId} 
            onClose={() => handlePageChange("products")}
          />
        ) : null}
        </>}
      </main>

      <RentalFormModal
        open={isCheckoutOpen}
        onClose={() => {
          setIsCheckoutOpen(false);
          fetchInitialData({ silent: true });
        }}
        onCreated={(r) => {
          setIsCheckoutOpen(false);
          setConfirmed(r);
          fetchInitialData({ silent: true });
          handlePageChange("bookings");
        }}
      />
      {cart.length > 0 && (
        <button
          onClick={() => setIsCheckoutOpen(true)}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 sm:bottom-6 sm:right-6 z-40 flex h-14 items-center gap-3 rounded-full bg-gold px-6 text-white shadow-lg hover:bg-gold/90 transition-transform hover:scale-105"
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="font-semibold tracking-wide whitespace-nowrap">Checkout ({cart.length})</span>
        </button>
      )}
      <WhatsAppModal rental={confirmed} onClose={() => setConfirmed(null)} />
      <RentalStatusModal
        product={currentStatusProduct}
        onClose={() => setStatusProduct(null)}
        onPutOut={(p, branch, variationId) => {
          if (cart.length > 0) {
            setPendingReplace({ product: p, branch, variationId });
          } else {
            executePutOut(p, branch, variationId);
          }
          setStatusProduct(null);
        }}
        onEdit={setEditing}
      />
      <ReplaceDraftModal
        open={!!pendingReplace}
        onConfirm={() => {
          if (pendingReplace) {
            executePutOut(
              pendingReplace.product,
              pendingReplace.branch,
              pendingReplace.variationId
            );
            setPendingReplace(null);
          }
        }}
        onCancel={() => {
          setPendingReplace(null);
        }}
      />
      <EditRentalModal rental={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

import { OverbookedProvider } from "@/lib/overbooked/store";

export default function Page() {
  return (
    <OverbookedProvider>
      <OverbookedApp />
    </OverbookedProvider>
  );
}
