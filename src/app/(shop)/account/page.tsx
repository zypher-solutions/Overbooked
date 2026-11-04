"use client";

import { useState } from "react";
import { AtSign, BriefcaseBusiness, KeyRound, MapPin, Phone, UserRound, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { PasswordField, passwordIsStrong } from "@/components/overbooked/PasswordField";
import { Modal, PageHeader, Panel, ghostButtonClass, goldButtonClass } from "@/components/shop/ui";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";

export default function AccountPage() {
  const { profile, user } = useAuth();
  const { role, isSupport, branches, myBranchId, loading } = useShop();
  const [passwordOpen, setPasswordOpen] = useState(false);

  const name = profile?.full_name?.trim() || "Account holder";
  const phone = user?.phone?.trim() || "Phone not set";
  const email = user?.email?.trim() || "Email not set";
  const designation = isSupport ? "Zypher support" : formatDesignation(role);
  const branch = myBranchId
    ? branches.find((item) => item.id === myBranchId)?.name ?? (loading ? "Loading branch…" : "Branch unavailable")
    : role === "staff" || role === "manager" ? "Branch not assigned" : "All branches";

  return (
    <div className="space-y-5">
      <PageHeader title="Account settings" subtitle="Your profile and personal security settings." />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <Panel title="Profile details" className="p-5 sm:p-6">
          <div className="flex min-w-0 items-center gap-4 border-b border-border pb-5">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/10 text-gold">
              <UserRound className="h-7 w-7" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-display text-lg font-semibold text-foreground">{name}</h2>
              <p className="mt-1 text-xs font-medium uppercase tracking-widest text-gold">{designation}</p>
            </div>
          </div>

          <dl className="grid gap-x-6 gap-y-5 pt-5 sm:grid-cols-2">
            <AccountDetail icon={Phone} label="Phone number" value={phone} />
            <AccountDetail icon={AtSign} label="Email address" value={email} />
            <AccountDetail icon={BriefcaseBusiness} label="Designation" value={designation} />
            <AccountDetail icon={MapPin} label="Assigned branch" value={branch} />
          </dl>
        </Panel>

        <div className="space-y-4">
          <Panel title="Security" className="p-5 sm:p-6">
            <p className="mb-4 text-sm leading-relaxed text-muted-foreground">Change your password to keep your account secure.</p>
            <button type="button" onClick={() => setPasswordOpen(true)} className={`${goldButtonClass} min-h-11 w-full`}>
              <KeyRound className="h-4 w-4" aria-hidden="true" /> Change password
            </button>
          </Panel>

        </div>
      </div>

      <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}

function formatDesignation(role: string): string {
  if (role === "super_admin") return "Super admin";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function AccountDetail({ icon: Icon, label, value }: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-1 break-words text-sm font-medium text-foreground">{value}</dd>
      </div>
    </div>
  );
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  const savePassword = async (): Promise<void> => {
    if (!passwordIsStrong(password)) {
      toast.error("Follow every password rule in the list.");
      return;
    }
    if (password !== confirmation) {
      toast.error("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) {
        toast.error(error.message || "Could not change password.");
        return;
      }
      toast.success("Password changed.");
      setPassword("");
      setConfirmation("");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Change password"
      footer={<>
        <button type="button" className={ghostButtonClass} onClick={onClose}>Cancel</button>
        <button type="button" className={goldButtonClass} disabled={busy} onClick={() => void savePassword()}>
          {busy ? "Saving..." : "Change password"}
        </button>
      </>}>
      <PasswordField id="new-pw" label="New password" value={password} onChange={setPassword} autoComplete="new-password" rules icon={false} autoFocus />
      <PasswordField id="new-pw2" label="Repeat it" value={confirmation} onChange={setConfirmation} autoComplete="new-password" icon={false} />
      <a href="/mfa" className="mt-3 block text-xs text-gold hover:underline">Set up two-step sign-in with an authenticator app</a>
    </Modal>
  );
}
