import { useState } from "react";
import { useOverbooked } from "@/lib/overbooked/store";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { Plus, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";
import { validateCategoryBaseSku } from "@/lib/overbooked/utils";
import { ConfirmDialog } from "../ConfirmDialog";

export function Categories() {
  const { categories, products, addCategory, deleteCategory } = useOverbooked();
  const { profile } = useAuth();
  const canDelete = profile?.role === "super_admin" || profile?.role === "owner";
  const [isAdding, setIsAdding] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatBaseSku, setNewCatBaseSku] = useState("");
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  // A category with products cannot be deleted: they would lose their category and SKU prefix.
  const askDelete = (c: { id: string; name: string }) => {
    const used = products.filter((p) => p.category === c.name).length;
    if (used > 0) {
      toast.error(`"${c.name}" is used by ${used} product(s). Move them to another category first, then delete it.`);
      return;
    }
    setDeleting({ id: c.id, name: c.name });
  };

  const handleAdd = async () => {
    if (!newCatName.trim() || !newCatBaseSku.trim()) {
      toast.error("Category name and Base SKU are required");
      return;
    }
    if (!validateCategoryBaseSku(newCatBaseSku.trim())) {
      toast.error("Invalid Base SKU Format. It must be 2-6 uppercase letters (e.g. WS).");
      return;
    }
    const cat = await addCategory(newCatName.trim(), newCatBaseSku.trim());
    if (cat) {
      toast.success("Category added successfully");
      setNewCatName("");
      setNewCatBaseSku("");
      setIsAdding(false);
    } else {
      toast.error("Failed to add category");
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display font-semibold text-foreground">Categories</h2>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-2 rounded-md bg-gold px-4 py-2 text-sm font-medium text-black hover:bg-gold/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Category
        </button>
      </div>

      {isAdding && (
        <div className="glass-strong rounded-xl border border-border p-6 shadow-xl animate-in fade-in slide-in-from-top-4">
          <h3 className="text-lg font-medium text-foreground mb-4">New Category</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Category Name</label>
              <input
                type="text"
                placeholder="e.g. Wedding Suit"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Base SKU</label>
              <input
                type="text"
                placeholder="e.g. WS"
                value={newCatBaseSku}
                onChange={(e) => setNewCatBaseSku(e.target.value.toUpperCase())}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold font-mono uppercase"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setIsAdding(false)}
              className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!newCatName.trim() || !newCatBaseSku.trim()}
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              Save Category
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <table className="w-full text-left text-sm hidden md:table">
          <thead className="bg-muted/70 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-6 py-4">Name</th>
              <th className="px-6 py-4">Base SKU</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {categories.map((c) => (
              <tr key={c.id} className="transition-colors hover:bg-white/[0.02]">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gold/10 text-gold">
                      <Tag className="h-4 w-4" />
                    </div>
                    <span className="font-medium text-foreground">{c.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  {c.base_sku ? (
                    <span className="inline-flex items-center rounded bg-black/5 px-2 py-1 text-xs font-mono font-medium text-foreground">
                      {c.base_sku}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">-</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  {canDelete && (
                    <button
                      onClick={() => askDelete(c)}
                      className="p-2text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors"
                      title="Delete Category"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {categories.length === 0 && !isAdding && (
              <tr>
                <td colSpan={3} className="px-6 py-8 text-center text-muted-foreground">
                  No categories found. Click "Add Category" to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Mobile List View */}
        <div className="md:hidden flex flex-col divide-y divide-border">
          {categories.length === 0 && !isAdding ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No categories found. Click "Add Category" to create one.
            </div>
          ) : (
            categories.map((c) => (
              <div key={c.id} className="p-4 flex items-center justify-between transition-colors hover:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gold/10 text-gold">
                    <Tag className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="font-medium text-foreground block">{c.name}</span>
                    {c.base_sku ? (
                      <span className="inline-block mt-1 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-mono font-medium text-foreground">
                        {c.base_sku}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic text-xs mt-1 block">-</span>
                    )}
                  </div>
                </div>
                {canDelete && (
                  <button
                    onClick={() => askDelete(c)}
                    className="p-2.5 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors"
                    title="Delete Category"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!deleting}
        message={`Are you sure you want to delete "${deleting?.name}"?`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteCategory(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
