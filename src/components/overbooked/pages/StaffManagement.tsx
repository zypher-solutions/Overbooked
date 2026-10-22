import { useState, useEffect } from "react";
import { Users, ShieldAlert, Check, X, Building2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Branch {
  id: string;
  name: string;
  is_active: boolean;
}

interface Profile {
  id: string;
  full_name: string;
  role: "super_admin" | "manager" | "owner" | "staff";
  branch_id: string | null;
  is_active: boolean;
  email?: string;
}

export function StaffManagement() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [pending, setPending] = useState<
    | { kind: "branch"; p: Profile; value: string }
    | { kind: "role"; p: Profile; value: Profile["role"] }
    | { kind: "status"; p: Profile; value: boolean }
    | null
  >(null);

  const fetchData = async () => {
    setLoading(true);
    
    // Fetch profiles
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, role, branch_id, is_active')
      .order('role', { ascending: true })
      .order('full_name', { ascending: true });

    if (profileError) {
      toast.error("Failed to load staff profiles");
    } else {
      let finalProfiles = profileData || [];
      
      // If user is super_admin, fetch emails securely
      if (profile?.role === 'super_admin') {
        const { data: emailData, error: emailError } = await supabase.rpc('get_staff_emails');
        if (!emailError && emailData) {
          const emailMap = new Map(emailData.map((e: any) => [e.id, e.email]));
          finalProfiles = finalProfiles.map((p: any) => ({
            ...p,
            email: emailMap.get(p.id) || "No email"
          }));
        }
      }
      
      setProfiles(finalProfiles);
    }

    // Fetch active branches
    const { data: branchData, error: branchError } = await supabase
      .from('branches')
      .select('id, name, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (branchError) {
      toast.error("Failed to load branches");
    } else {
      setBranches(branchData || []);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (profile?.role === "super_admin") {
      fetchData();
    }
  }, [profile]);

  if (profile?.role !== "super_admin") {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <ShieldAlert className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-foreground">Access Denied</h2>
        <p className="text-muted-foreground mt-2">Only Super Admins can manage staff assignments.</p>
      </div>
    );
  }

  const handleBranchChange = async (userId: string, newBranchId: string) => {
    setUpdatingId(userId);
    try {
      const branchIdToSave = newBranchId === "none" ? null : newBranchId;
      
      const { error } = await supabase
        .from('profiles')
        .update({ branch_id: branchIdToSave })
        .eq('id', userId);

      if (error) throw error;
      
      toast.success("Branch assignment updated successfully");
      
      // Update local state instead of re-fetching everything
      setProfiles(prev => prev.map(p => 
        p.id === userId ? { ...p, branch_id: branchIdToSave } : p
      ));
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed to update branch assignment");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleAccessChange = async (p: Profile, isActive: boolean, role: Profile["role"]) => {
    setUpdatingId(p.id);
    try {
      const { error } = await supabase.rpc("admin_set_staff_status", {
        p_user_id: p.id,
        p_is_active: isActive,
        p_role: role,
      });
      if (error) throw error;
      toast.success("Staff access updated successfully");
      setProfiles(prev => prev.map(x => (x.id === p.id ? { ...x, is_active: isActive, role } : x)));
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed to update staff access");
    } finally {
      setUpdatingId(null);
    }
  };

  const confirmPending = () => {
    if (!pending) return;
    const { kind, p, value } = pending;
    setPending(null);
    if (kind === "branch") handleBranchChange(p.id, value);
    else if (kind === "role") handleAccessChange(p, p.is_active, value);
    else handleAccessChange(p, value, p.role);
  };

  const pendingText = () => {
    if (!pending) return "";
    const name = pending.p.full_name;
    if (pending.kind === "branch") {
      const b = branches.find(x => x.id === pending.value)?.name || "Unassigned";
      return "Move " + name + " to " + b + "?";
    }
    if (pending.kind === "role") return "Change " + name + " to role " + pending.value.replace("_", " ") + "?";
    return pending.value
      ? "Reactivate " + name + "? They will be able to sign in again."
      : "Deactivate " + name + "? They lose access immediately.";
  };

  const getRoleDisplay = (p: Profile) => (
    <select
      value={p.role}
      onChange={(e) => setPending({ kind: "role", p, value: e.target.value as Profile["role"] })}
      disabled={updatingId === p.id || p.id === profile?.id}
      aria-label={"Role for " + p.full_name}
      className="rounded-md border border-border bg-surface px-2 py-1 text-xs uppercase tracking-widest text-foreground focus:border-gold focus:outline-none disabled:opacity-50"
    >
      {["super_admin", "owner", "manager", "staff"].map(r => (
        <option key={r} value={r}>{r.replace("_", " ")}</option>
      ))}
    </select>
  );

  const getStatusToggle = (p: Profile) => (
    <button
      type="button"
      onClick={() => setPending({ kind: "status", p, value: !p.is_active })}
      disabled={updatingId === p.id || p.id === profile?.id}
      aria-label={(p.is_active ? "Deactivate " : "Activate ") + p.full_name}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border disabled:opacity-50",
        p.is_active
          ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
          : "bg-red-500/10 text-red-500 border-red-500/20"
      )}
    >
      {p.is_active ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {p.is_active ? "Active" : "Inactive"}
    </button>
  );

  const getBranchDisplay =(p: Profile) => {
    if (p.role === "super_admin" || p.role === "owner") {
      return (
        <div className="flex items-center gap-2 text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-md text-sm">
          <Building2 className="h-4 w-4" />
          <span>All Branches</span>
        </div>
      );
    }

    return (
      <select
        value={p.branch_id || "none"}
        onChange={(e) => setPending({ kind: "branch", p, value: e.target.value })}
        disabled={updatingId === p.id}
        className="w-full md:w-auto rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:opacity-50"
      >
        <option value="none">-- Unassigned --</option>
        {branches.map(b => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display font-semibold text-foreground">Staff Management</h2>
      </div>

      {loading ? (
        <div className="text-center py-10 text-muted-foreground">Loading staff...</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          {/* Desktop Table */}
          <table className="w-full text-left text-sm hidden md:table">
            <thead className="bg-muted/70 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-6 py-4">Staff Member</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Assigned Branch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {profiles.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/10 text-gold">
                        <Users className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="font-medium text-foreground block">{p.full_name}</span>
                        <span className="text-xs text-muted-foreground mt-0.5 block">{p.email || "No email"}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">{getRoleDisplay(p)}</td>
                  <td className="px-6 py-4">{getStatusToggle(p)}</td>
                  <td className="px-6 py-4">
                    {getBranchDisplay(p)}
                  </td>
                </tr>
              ))}
              {profiles.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                    No staff profiles found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Mobile List View */}
          <div className="md:hidden flex flex-col divide-y divide-border">
            {profiles.map((p) => (
              <div key={p.id} className="p-4 flex flex-col gap-4 transition-colors hover:bg-white/[0.02]">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/10 text-gold">
                      <Users className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <span className="font-medium text-foreground block truncate">{p.full_name}</span>
                      <span className="text-xs text-muted-foreground block truncate">{p.email || "No email"}</span>
                    </div>
                  </div>
                  {getStatusToggle(p)}
                </div>
                
                <div className="grid grid-cols-1 gap-3 bg-muted/50 p-3 rounded-md border border-border/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Role:</span>
                    {getRoleDisplay(p)}
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-muted-foreground">Assigned Branch:</span>
                    {getBranchDisplay(p)}
                  </div>
                </div>
              </div>
            ))}
            {profiles.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No staff profiles found.
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={pending !== null} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm change</AlertDialogTitle>
            <AlertDialogDescription>{pendingText()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPending}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
