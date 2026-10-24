import { useState, useEffect } from "react";
import { Users, ShieldAlert, Check, X, Building2, UserPlus, Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { inviteStaff, newInviteLink } from "@/app/actions/staff";
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
  pending?: boolean;
}

const SHOP_ROLES = ["owner", "manager", "staff"] as const;

export function StaffManagement() {
  const { profile, shop } = useAuth();
  const canManage = profile?.role === "super_admin" || profile?.role === "owner";
  const [invite, setInvite] = useState({ email: "", fullName: "", role: "staff" as (typeof SHOP_ROLES)[number], branchId: "" });
  const [inviting, setInviting] = useState(false);
  const [shareLink, setShareLink] = useState<{ name: string; link: string } | null>(null);
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
      // Zypher staff can read every profile: keep to this shop's people
      .eq('shop_id', shop?.id ?? '')
      .order('role', { ascending: true })
      .order('full_name', { ascending: true });

    if (profileError) {
      toast.error("Failed to load staff profiles");
    } else {
      let finalProfiles = profileData || [];
      
      // Emails and invite state (never signed in = invite pending)
      const { data: emailData, error: emailError } = await supabase.rpc('get_staff_emails');
      if (!emailError && emailData) {
        const emailMap = new Map<string, any>(emailData.map((e: any) => [e.id, e]));
        finalProfiles = finalProfiles.map((p: any) => ({
          ...p,
          email: emailMap.get(p.id)?.email || "No email",
          pending: emailMap.has(p.id) && !emailMap.get(p.id).last_sign_in_at,
        }));
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
    if (canManage) {
      fetchData();
    }
  }, [profile]);

  if (!canManage) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <ShieldAlert className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-foreground">Access Denied</h2>
        <p className="text-muted-foreground mt-2">Only the shop owner can manage staff.</p>
      </div>
    );
  }

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    try {
      const { link } = await inviteStaff({
        email: invite.email,
        fullName: invite.fullName,
        role: invite.role,
        branchId: invite.role === "owner" ? null : invite.branchId || null,
      });
      setShareLink({ name: invite.fullName, link });
      setInvite({ email: "", fullName: "", role: "staff", branchId: "" });
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Could not create the invite");
    } finally {
      setInviting(false);
    }
  };

  const freshLink = async (p: Profile) => {
    setUpdatingId(p.id);
    try {
      const { link } = await newInviteLink(p.id);
      setShareLink({ name: p.full_name, link });
    } catch (err: any) {
      toast.error(err.message || "Could not create a new link");
    } finally {
      setUpdatingId(null);
    }
  };

  const copyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink.link);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy. Select the link and copy it by hand.");
    }
  };

  const handleBranchChange = async (userId: string, newBranchId: string) => {
    setUpdatingId(userId);
    try {
      const branchIdToSave = newBranchId === "none" ? null : newBranchId;
      
      const { error } = await supabase.rpc('set_staff_branch', {
        p_user_id: userId,
        p_branch_id: branchIdToSave,
      });

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
      {SHOP_ROLES.map(r => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>
  );

  const getStatusToggle = (p: Profile) => p.pending ? (
    <button
      type="button"
      onClick={() => freshLink(p)}
      disabled={updatingId === p.id}
      aria-label={"New invite link for " + p.full_name}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border bg-gold/10 text-gold border-gold/30 disabled:opacity-50"
    >
      <Link2 className="h-3 w-3" />
      Invite pending · New link
    </button>
  ) : (
    <span className="inline-flex items-center gap-1.5">
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
    {p.id !== profile?.id && (profile?.role === "super_admin" || p.role !== "owner") && (
      <button
        type="button"
        onClick={() => freshLink(p)}
        disabled={updatingId === p.id}
        title="New login link (forgotten password)"
        aria-label={"New login link for " + p.full_name}
        className="rounded-full border border-border p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <Link2 className="h-3 w-3" />
      </button>
    )}
    </span>
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

      <form onSubmit={sendInvite} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <UserPlus className="h-4 w-4 text-gold" /> Invite staff
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto_auto]">
          <input type="text" required placeholder="Full name" aria-label="Full name" value={invite.fullName}
            onChange={(e) => setInvite({ ...invite, fullName: e.target.value })}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none" />
          <input type="email" required placeholder="Email" aria-label="Email" value={invite.email}
            onChange={(e) => setInvite({ ...invite, email: e.target.value })}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none" />
          <select aria-label="Role" value={invite.role}
            onChange={(e) => setInvite({ ...invite, role: e.target.value as (typeof SHOP_ROLES)[number] })}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm uppercase tracking-widest text-foreground focus:border-gold focus:outline-none">
            {SHOP_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select aria-label="Branch" value={invite.branchId} disabled={invite.role === "owner"}
            required={invite.role !== "owner"}
            onChange={(e) => setInvite({ ...invite, branchId: e.target.value })}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none disabled:opacity-50">
            <option value="">{invite.role === "owner" ? "All branches" : "Branch"}</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button type="submit" disabled={inviting}
            className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-white hover:bg-gold/90 disabled:opacity-50">
            {inviting ? "Creating..." : "Create invite link"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">You get a link to send on WhatsApp. It works once, for one hour; the person opens it and chooses a password.</p>
      </form>

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

      <AlertDialog open={shareLink !== null} onOpenChange={(o) => { if (!o) setShareLink(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invite link for {shareLink?.name}</AlertDialogTitle>
            <AlertDialogDescription>Send this link to them. It works once and expires in one hour.</AlertDialogDescription>
          </AlertDialogHeader>
          <textarea readOnly value={shareLink?.link ?? ""} aria-label="Invite link" rows={3}
            className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground" />
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <a href={"https://wa.me/?text=" + encodeURIComponent("Your login for " + (shop?.name ?? "Overbooked") + ": " + (shareLink?.link ?? ""))}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
              Send on WhatsApp
            </a>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void copyLink(); }}>
              <Copy className="mr-1 h-4 w-4" /> Copy link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
