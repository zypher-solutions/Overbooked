import { useMemo, useState } from "react";
import { Star, Image as ImageIcon, Trash2 } from "lucide-react";
import { useOverbooked } from "@/lib/overbooked/store";
import type { Product } from "@/lib/overbooked/types";
import { inr, formatProductPrice } from "@/lib/overbooked/utils";
import { StatusBadge, inputClass, goldButtonClass } from "../primitives";
import { TableSkeleton } from "../Skeleton";
import { ConfirmDialog } from "../ConfirmDialog";
export function AllProducts({ 
  onOpen, 
  onEdit 
}: { 
  onOpen: (p: Product) => void;
  onEdit: (id: string | null) => void;
}) {
  const { products, branches, isLoading, deleteProduct, setProductActive } = useOverbooked();
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [deleting, setDeleting] = useState<Product | null>(null);

  const totalOf = (p: Product) => {
    return (p.variations || []).reduce((sum, v) => {
      if (!v.enabled) return sum;
      return sum + Object.values(v.stock).reduce((a, b) => a + b, 0);
    }, 0);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      
      const total = totalOf(p);
      if (stockFilter === "in" && total <= 0) return false;
      if (stockFilter === "out" && total > 0) return false;
      
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      
      return true;
    });
  }, [products, query, categoryFilter, stockFilter]);

  // Unique categories for the dropdown
  const uniqueCategories = useMemo(() => {
    return Array.from(new Set(products.map(p => p.category).filter(Boolean)));
  }, [products]);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold">All Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered.length} item{filtered.length === 1 ? "" : "s"} in the catalog
          </p>
        </div>
        <button
          onClick={() => onEdit(null)}
          className={goldButtonClass}
        >
          New Product
        </button>
      </header>

      {/* Toolbar */}
      <div className="glass mt-6 flex flex-col md:flex-row md:items-center justify-between gap-4 p-3">
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          <select className={inputClass + " w-full sm:w-40"} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">Select a category</option>
            {uniqueCategories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          
          <select className={inputClass + " w-full sm:w-40"} value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
            <option value="all">Filter by stock status</option>
            <option value="in">In stock</option>
            <option value="out">Out of stock</option>
          </select>
          <button className="h-9 px-4 w-full sm:w-auto rounded border border-border text-xs font-medium hover:bg-white/[0.05] transition-colors">Filter</button>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
          <input
            className={inputClass + " w-full sm:w-48"}
            placeholder="Search products…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="h-9 px-4 w-full sm:w-auto rounded border border-border text-xs font-medium hover:bg-white/[0.05] transition-colors">Search products</button>
        </div>
      </div>

      {/* Desktop Table */}
      <div className="glass mt-4 overflow-x-auto rounded-lg hidden 2xl:block">
        <table className="w-full min-w-[1200px] text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-white/[0.02]">
              <th className="w-16 px-4 py-3"><ImageIcon className="h-4 w-4 text-muted-foreground" /></th>
              <th className="px-4 py-3 font-medium text-gold hover:text-gold/80 cursor-pointer">Name</th>
              <th className="px-4 py-3 font-medium text-gold hover:text-gold/80 cursor-pointer">SKU</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Variations</th>
              <th className="px-4 py-3 font-medium text-gold hover:text-gold/80 cursor-pointer">Daily Rate</th>
              <th className="px-4 py-3 font-medium">Total Stock</th>
              <th className="px-4 py-3 font-medium">Branches</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          {isLoading ? (
            <tbody>
              <tr>
                <td colSpan={10} className="p-4">
                  <TableSkeleton rows={10} columns={10} />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody className="divide-y divide-border">
              {filtered.map((p) => {
              const stockNum = totalOf(p);
              const inStock = stockNum > 0;
              return (
                <tr key={p.id} className="group transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <img src={p.image || undefined} alt="" className="h-10 w-10 rounded border border-border object-cover bg-surface-2" />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">
                      {p.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.sku || "—"}
                  </td>
                  <td className="px-4 py-3 text-gold hover:underline cursor-pointer">
                    {p.category || "Uncategorized"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.variations?.length || 0}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-mono text-gold font-medium">
                      {inr(p.dailyRate || 0)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={inStock ? "text-emerald-500 font-medium" : "text-rust font-medium"}>
                      {inStock ? `In stock (${stockNum})` : "Out of stock"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gold">
                    {branches.map(b => {
                      const qty = (p.variations || []).reduce((sum, v) => sum + (v.stock[b] || 0), 0);
                      if (qty && qty > 0) return <div key={b} className="hover:underline cursor-pointer">{b} ({qty})</div>;
                      return null;
                    })}
                    {stockNum === 0 && <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {p.isActive === false ? (
                      <span className="inline-flex items-center rounded-md bg-red-400/10 px-2 py-1 text-xs font-medium text-red-400 ring-1 ring-inset ring-red-400/20">Inactive</span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-400/20">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button 
                        onClick={() => onEdit(p.id)}
                        className="rounded border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/20 transition-colors"
                      >
                        Edit
                      </button>
                      {p.isActive === false && (
                        <button
                          onClick={async () => {
                            try {
                              await setProductActive(p.id, true);
                            } catch (e: any) {
                              alert(e.message || "Could not reactivate this product.");
                            }
                          }}
                          className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        >
                          Reactivate
                        </button>
                      )}
                      <button
                        onClick={() => setDeleting(p)}
                        className="rounded border border-red-500/30 bg-red-500/10 p-1.5 text-red-500 hover:bg-red-500/20 transition-colors"
                        title="Delete product"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          )}
        </table>
        {!isLoading && filtered.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No products found matching your search.
          </p>
        )}
      </div>

      {/* Mobile Card View */}
      <div className="2xl:hidden mt-4 space-y-4">
        {isLoading ? (
          <div className="glass p-4 rounded-xl">
            <TableSkeleton rows={4} columns={1} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass px-4 py-10 text-center text-sm text-muted-foreground rounded-xl">
            No products found matching your search.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {filtered.map((p) => {
              const stockNum = totalOf(p);
              const inStock = stockNum > 0;
              return (
                <div key={p.id} className="glass rounded-xl p-4 flex flex-col transition-colors hover:bg-white/[0.02]">
                  <div className="flex gap-4 mb-3">
                    <img src={p.image || undefined} alt="" className="h-16 w-16 rounded-md border border-border object-cover bg-surface-2 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="font-semibold text-foreground truncate">{p.name}</h3>
                        {p.isActive === false ? (
                          <span className="shrink-0 inline-flex items-center rounded-md bg-red-400/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400 ring-1 ring-inset ring-red-400/20">Inactive</span>
                        ) : (
                          <span className="shrink-0 inline-flex items-center rounded-md bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-inset ring-emerald-400/20">Active</span>
                        )}
                      </div>
                      <p className="font-mono text-xs text-muted-foreground mt-0.5 truncate">{p.sku || "—"}</p>
                      <div className="text-sm font-mono text-gold font-medium mt-1">
                        {inr(p.dailyRate || 0)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 mb-4 text-xs bg-muted/70 rounded-lg p-2.5">
                    <div>
                      <p className="uppercase tracking-widest text-[10px] text-muted-foreground font-semibold mb-0.5">Category</p>
                      <p className="text-gold font-medium">{p.category || "Uncategorized"}</p>
                    </div>
                    <div className="text-right">
                      <p className="uppercase tracking-widest text-[10px] text-muted-foreground font-semibold mb-0.5">Stock</p>
                      <span className={inStock ? "text-emerald-500 font-medium" : "text-rust font-medium"}>
                        {inStock ? `${stockNum} Units` : "Out of stock"}
                      </span>
                    </div>
                    <div className="col-span-2 pt-2 mt-1 border-t border-border flex justify-between items-start">
                      <div>
                        <p className="uppercase tracking-widest text-[10px] text-muted-foreground font-semibold mb-0.5">Branches</p>
                        <div className="text-gold">
                          {branches.map(b => {
                            const qty = (p.variations || []).reduce((sum, v) => sum + (v.stock[b] || 0), 0);
                            if (qty && qty > 0) return <span key={b} className="block">{b} ({qty})</span>;
                            return null;
                          })}
                          {stockNum === 0 && <span className="text-muted-foreground">—</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="uppercase tracking-widest text-[10px] text-muted-foreground font-semibold mb-0.5">Variations</p>
                        <p className="text-muted-foreground">{p.variations?.length || 0}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-auto pt-2 border-t border-border/50">
                    <button 
                      onClick={() => onEdit(p.id)}
                      className="flex-1 rounded-md border border-gold/30 bg-gold/10 py-2.5 text-xs font-medium text-gold hover:bg-gold/20 transition-colors"
                    >
                      Edit Product
                    </button>
                    {p.isActive === false && (
                      <button
                        onClick={async () => {
                          try {
                            await setProductActive(p.id, true);
                          } catch (e: any) {
                            alert(e.message || "Could not reactivate this product.");
                          }
                        }}
                        className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      >
                        Reactivate
                      </button>
                    )}
                    <button
                      onClick={() => setDeleting(p)}
                      className="rounded-md border border-red-500/30 bg-red-500/10 px-3 flex items-center justify-center text-red-500 hover:bg-red-500/20 transition-colors"
                      title="Delete product"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end text-sm text-muted-foreground">
        <div>
          {filtered.length} items
        </div>
      </div>
      <ConfirmDialog
        open={!!deleting}
        message={`Delete ${deleting?.name}?\n\nIf it has rental or booking history it will be deactivated instead of deleted.`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteProduct(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}


