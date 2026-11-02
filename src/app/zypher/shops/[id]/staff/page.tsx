"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Link2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { inviteStaff, newInviteLink } from "@/app/actions/staff";
import { StatusBadge, goldButtonClass, inputClass } from "@/components/overbooked/primitives";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader, ShareLinkDialog, fmtWhen, tableWrap, theadClass } from "@/components/zypher/kit";

type Role = "owner" | "manager" | "staff" | "support";
const ROLES: Role[] = ["owner", "manager", "staff", "support"];

interface Person {
  id: string; full_name: string; role: Role; branch_id: string | null; is_active: boolean;
  email: string; last_sign_in_at: string | null; pending: boolean;
}
interface Branch { id: string; name: string; is_active: boolean }

type Change = { person: Person; patch: { role?: Role; is_active?: boolean; branch_id?: string | null }; text: string };

// A shop's logins, set up by Zypher: invite, role, branch, switch off, and a fresh login link for a forgotten password.
export default function ShopStaff() {
  const { id } = useParams<{ id: string }>();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [shopName, setShopName] = useState("");
  const [invite, setInvite] = useState({ email: "", fullName: "", role: "staff" as Role, branchId: "" });
  const [inviting, setInviting] = useState(false);
  const [share, setShare] = useState<{ name: string; link: string } | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [p, b, shop] = await Promise.all([
      supabase.rpc("setup_people", { p_shop_id: id }),
      supabase.rpc("setup_branches", { p_shop_id: id }),
      supabase.from("shops").select("name").eq("id", id).maybeSingle(),
    ]);
    if (p.error) return void toast.error("Could not load the staff: " + p.error.message);
    setPeople(p.data as unknown as Person[]);
    setBranches(((b.data ?? []) as unknown as Branch[]).filter((x) => x.is_active));
    setShopName(shop.data?.name ?? "");
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const needsBranch = invite.role === "manager" || invite.role === "staff";

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    try {
      const { link } = await inviteStaff({ shopId: id, email: invite.email, fullName: invite.fullName, role: invite.role, branchId: invite.branchId || null });
      setShare({ name: invite.fullName, link });
      setInvite({ email: "", fullName: "", role: "staff", branchId: "" });
      await load();
    } catch (err: any) {
      toast.error(err.message || "Could not create the invite");
    } finally {
      setInviting(false);
    }
  };

  const freshLink = async (p: Person) => {
    setWorkingId(p.id);
    try {
      const { link } = await newInviteLink(id, p.id);
      setShare({ name: p.full_name, link });
    } catch (err: any) {
      toast.error(err.message || "Could not create a new link");
    } finally {
      setWorkingId(null);
    }
  };

  const apply = async () => {
    if (!change) return;
    const { person, patch } = change;
    setChange(null);
    setWorkingId(person.id);
    const { error } = await createClient().rpc("setup_set_person", { p_shop_id: id, p_user_id: person.id, p: patch });
    setWorkingId(null);
    if (error) return void toast.error(error.message);
    toast.success("Saved");
    await load();
  };

  const ask = (person: Person, patch: Change["patch"], text: string) => setChange({ person, patch, text });

  return (
    <>
      <PageHeader title="Staff" subtitle={`${shopName ? shopName + ": " : ""}who can sign in, with which role and branch`} />

      <form onSubmit={sendInvite} className="mb-5 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><UserPlus className="h-4 w-4 text-gold" /> Invite a person</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto_auto]">
          <input type="text" required placeholder="Full name" aria-label="Full name" className={inputClass} value={invite.fullName}
            onChange={(e) => setInvite({ ...invite, fullName: e.target.value })} />
          <input type="email" required placeholder="Email" aria-label="Email" className={inputClass} value={invite.email}
            onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
          <select aria-label="Role" className={inputClass} value={invite.role}
            onChange={(e) => setInvite({ ...invite, role: e.target.value as Role, branchId: "" })}>
            {ROLES.map((r) => <option key={r} value={r}>{r === "support" ? "Zypher support" : r}</option>)}
          </select>
          <select aria-label="Branch" className={inputClass} value={invite.branchId} disabled={!needsBranch} required={needsBranch}
            onChange={(e) => setInvite({ ...invite, branchId: e.target.value })}>
            <option value="">{needsBranch ? "Branch" : "All branches"}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button type="submit" disabled={inviting} className={goldButtonClass}>{inviting ? "Creating..." : "Create invite link"}</button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          You get a link to send on WhatsApp. It works once, for one hour; the person opens it and chooses a password.
          A Zypher support login is Zypher&apos;s own sign-in to this shop for fixing problems; it does not use up the plan&apos;s login limit.
        </p>
      </form>

      {people === null ? <p className="py-10 text-center text-muted-foreground">Loading staff...</p> : (
        <div className={tableWrap}>
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className={theadClass}>
              <tr><th className="px-4 py-3">Person</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {people.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5">
                    <span className="block font-medium text-foreground">{p.full_name}</span>
                    <span className="block text-xs text-muted-foreground">{p.email} · {p.pending ? "never signed in" : "last sign-in " + fmtWhen(p.last_sign_in_at)}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <select aria-label={"Role for " + p.full_name} className={inputClass + " w-auto min-w-[7.5rem] py-1 text-xs"} value={p.role} disabled={workingId === p.id}
                      onChange={(e) => ask(p, { role: e.target.value as Role }, `Change ${p.full_name} to ${e.target.value}?`)}>
                      {ROLES.map((r) => <option key={r} value={r}>{r === "support" ? "Zypher support" : r}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    {p.role === "owner" || p.role === "support" ? <span className="text-xs text-muted-foreground">All branches</span> : (
                      <select aria-label={"Branch for " + p.full_name} className={inputClass + " w-auto min-w-[7.5rem] py-1 text-xs"} value={p.branch_id ?? ""} disabled={workingId === p.id}
                        onChange={(e) => ask(p, { branch_id: e.target.value || null }, `Move ${p.full_name} to ${branches.find((b) => b.id === e.target.value)?.name ?? "no branch"}?`)}>
                        <option value="">Unassigned</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <button type="button" disabled={workingId === p.id} aria-label={(p.is_active ? "Deactivate " : "Activate ") + p.full_name}
                      onClick={() => ask(p, { is_active: !p.is_active }, p.is_active ? `Deactivate ${p.full_name}? They lose access straight away.` : `Reactivate ${p.full_name}? They can sign in again.`)}>
                      <StatusBadge tone={p.is_active ? "emerald" : "rust"}>{p.is_active ? "Active" : "Inactive"}</StatusBadge>
                    </button>
                    {p.pending ? <StatusBadge tone="indigo">Invite pending</StatusBadge> : null}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" disabled={workingId === p.id} onClick={() => void freshLink(p)} aria-label={"New login link for " + p.full_name}
                      title={p.pending ? "New invite link" : "New login link (forgotten password)"}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
                      <Link2 className="h-3.5 w-3.5" /> {p.pending ? "New invite link" : "Login link"}
                    </button>
                  </td>
                </tr>
              ))}
              {people.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Nobody yet. Invite the owner above.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      <ShareLinkDialog share={share} onClose={() => setShare(null)} />

      <AlertDialog open={change !== null} onOpenChange={(o) => { if (!o) setChange(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm change</AlertDialogTitle>
            <AlertDialogDescription>{change?.text}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void apply()}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
