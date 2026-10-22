import { useState, useEffect } from "react";
import { Plus, Trash2, Edit, Building2, Check, X, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../ConfirmDialog";

interface Branch {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
}

export function BranchManagement() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    address: "",
    phone: "",
    email: "",
    is_active: true
  });

  const fetchBranches = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('branches').select('*').order('created_at', { ascending: true });
    if (error) {
      toast.error("Failed to load branches");
    } else {
      setBranches(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (profile?.role === "super_admin") {
      fetchBranches();
    }
  }, [profile]);

  if (profile?.role !== "super_admin") {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <ShieldAlert className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-foreground">Access Denied</h2>
        <p className="text-muted-foreground mt-2">Only Super Admins can manage branches.</p>
      </div>
    );
  }

  const handleOpenModal = (branch?: Branch) => {
    if (branch) {
      setEditingBranch(branch);
      setFormData({
        name: branch.name,
        slug: branch.slug,
        address: branch.address || "",
        phone: branch.phone || "",
        email: branch.email || "",
        is_active: branch.is_active
      });
    } else {
      setEditingBranch(null);
      setFormData({
        name: "",
        slug: "",
        address: "",
        phone: "",
        email: "",
        is_active: true
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Branch name is required");
      return;
    }
    if (!formData.slug.trim()) {
      toast.error("Branch slug is required");
      return;
    }

    try {
      if (editingBranch) {
        const { error } = await supabase
          .from('branches')
          .update({
            name: formData.name.trim(),
            slug: formData.slug.trim(),
            address: formData.address.trim() || null,
            phone: formData.phone.trim() || null,
            email: formData.email.trim() || null,
            is_active: formData.is_active
          })
          .eq('id', editingBranch.id);

        if (error) throw error;
        toast.success("Branch updated successfully");
      } else {
        const { error } = await supabase
          .from('branches')
          .insert({
            name: formData.name.trim(),
            slug: formData.slug.trim(),
            address: formData.address.trim() || null,
            phone: formData.phone.trim() || null,
            email: formData.email.trim() || null,
            is_active: formData.is_active
          });

        if (error) throw error;
        toast.success("Branch created successfully");
      }
      setIsModalOpen(false);
      fetchBranches();
    } catch (e: any) {
      console.error(e);
      if (e.code === '23505') {
        toast.error("A branch with this name or slug already exists.");
      } else {
        toast.error(e.message || "Failed to save branch");
      }
    }
  };

  const handleDelete = (branch: Branch) => setDeleting(branch);

  const doDelete = async (branch: Branch) => {
    try {
      // Deleting would null out their branch_id and leave the sidebar on "Loading Branch...".
      const { count, error: countError } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('branch_id', branch.id);
      if (countError) throw countError;
      if (count) {
        toast.error(`${count} staff member(s) are assigned to this branch. Reassign them first, or deactivate the branch instead.`, { duration: 5000 });
        return;
      }
      const { error } = await supabase.from('branches').delete().eq('id', branch.id);
      if (error) {
        if (error.code === '23503') { // Foreign key constraint violation
          toast.error("This branch cannot be deleted because it contains existing operational data. Deactivate the branch instead.", { duration: 5000 });
        } else {
          throw error;
        }
      } else {
        toast.success("Branch deleted successfully");
        fetchBranches();
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to delete branch");
    }
  };

  const toggleStatus = async (branch: Branch) => {
    try {
      const { error } = await supabase
        .from('branches')
        .update({ is_active: !branch.is_active })
        .eq('id', branch.id);
      
      if (error) throw error;
      toast.success(`Branch ${branch.is_active ? 'deactivated' : 'activated'}`);
      fetchBranches();
    } catch (e: any) {
      toast.error(e.message || "Failed to update branch status");
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display font-semibold text-foreground">Branch Management</h2>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 rounded-md bg-gold px-4 py-2 text-sm font-medium text-black hover:bg-gold/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Branch
        </button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-muted-foreground">Loading branches...</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          {/* Desktop Table */}
          <table className="w-full text-left text-sm hidden md:table">
            <thead className="bg-muted/70 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-6 py-4">Branch</th>
                <th className="px-6 py-4">Contact</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Created Date</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {branches.map((b) => (
                <tr key={b.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gold/10 text-gold">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="font-medium text-foreground block">{b.name}</span>
                        <span className="text-muted-foreground font-mono text-xs block">{b.slug}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-xs text-muted-foreground">
                      {b.phone && <div className="text-foreground">{b.phone}</div>}
                      {b.email && <div>{b.email}</div>}
                      {b.address && <div className="truncate max-w-[200px]" title={b.address}>{b.address}</div>}
                      {!b.phone && !b.email && !b.address && "-"}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => toggleStatus(b)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors border",
                        b.is_active
                          ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20"
                          : "bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20"
                      )}
                    >
                      {b.is_active ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      {b.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground text-xs">
                    {new Date(b.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleOpenModal(b)}
                        className="p-2 text-muted-foreground hover:text-gold hover:bg-gold/10 rounded-md transition-colors"
                        title="Edit Branch"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(b)}
                        className="p-2 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors"
                        title="Delete Branch"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {branches.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    No branches found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Mobile List View */}
          <div className="md:hidden flex flex-col divide-y divide-border">
            {branches.map((b) => (
              <div key={b.id} className="p-4 flex flex-col gap-3 transition-colors hover:bg-white/[0.02]">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gold/10 text-gold">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <span className="font-medium text-foreground block">{b.name}</span>
                      <span className="text-muted-foreground font-mono text-[10px] block">{b.slug}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleStatus(b)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border",
                      b.is_active
                        ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                        : "bg-red-500/10 text-red-500 border-red-500/20"
                    )}
                  >
                    {b.is_active ? "Active" : "Inactive"}
                  </button>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                  {b.phone && <div className="col-span-2 truncate">{b.phone}</div>}
                  {b.email && <div className="col-span-2 truncate">{b.email}</div>}
                  {b.address && <div className="col-span-2 truncate">{b.address}</div>}
                  {!b.phone && !b.email && !b.address && <div className="col-span-2">-</div>}
                </div>
                
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                  <span className="text-[10px] text-muted-foreground">
                    Created {new Date(b.created_at).toLocaleDateString()}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleOpenModal(b)}
                      className="p-1.5 text-muted-foreground hover:text-gold hover:bg-gold/10 rounded-md transition-colors"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(b)}
                      className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {branches.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No branches found.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <h3 className="text-xl font-display font-semibold text-foreground mb-4">
              {editingBranch ? "Edit Branch" : "Create Branch"}
            </h3>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Branch Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Kozhikode"
                  value={formData.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!editingBranch) {
                      setFormData(prev => ({ ...prev, name: val, slug: val.toLowerCase().replace(/[^a-z0-9]+/g, '-') }));
                    } else {
                      setFormData(prev => ({ ...prev, name: val }));
                    }
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Slug *</label>
                <input
                  type="text"
                  placeholder="e.g. kozhikode"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '') })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Phone Number</label>
                <input
                  type="text"
                  placeholder="e.g. +91 98765 43210"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Email Address</label>
                <input
                  type="email"
                  placeholder="e.g. kozhikode@trendz.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Physical Address</label>
                <textarea
                  placeholder="Full physical address..."
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold resize-none"
                  rows={3}
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm font-medium text-muted-foreground">Status</span>
                <label className="flex items-center cursor-pointer">
                  <div className="relative">
                    <input 
                      type="checkbox" 
                      className="sr-only"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    />
                    <div className={cn("block w-10 h-6 rounded-full transition-colors", formData.is_active ? "bg-emerald-500" : "bg-border")}></div>
                    <div className={cn("dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform", formData.is_active ? "transform translate-x-4" : "")}></div>
                  </div>
                  <div className="ml-3 text-sm font-medium text-foreground">
                    {formData.is_active ? "Active" : "Inactive"}
                  </div>
                </label>
              </div>
            </div>
            
            <div className="mt-8 flex justify-end gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formData.name.trim() || !formData.slug.trim()}
                className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-gray-100 disabled:opacity-50 transition-colors"
              >
                {editingBranch ? "Save Changes" : "Create Branch"}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!deleting}
        message={`Are you sure you want to delete "${deleting?.name}"?`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void doDelete(deleting);
          setDeleting(null);
        }}
      />
    </div>
  );
}
