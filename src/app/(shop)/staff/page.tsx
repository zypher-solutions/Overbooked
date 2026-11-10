"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { emailError, normalizeEmail, personNameError } from "@/lib/validate";
import { inviteStaff, newInviteLink } from "@/app/actions/staff";
import { useShop } from "@/lib/shop/ShopContext";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { fmtDateTime } from "@/lib/shop/format";
import { ConfirmDialog } from "@/components/overbooked/ConfirmDialog";
import { Switch } from "@/components/ui/switch";
import {
  Empty, Modal, PageHeader, Panel, StatusBadge, ghostButtonClass, goldButtonClass, inputClass, tableWrap, theadClass,
} from "@/components/shop/ui";

type Role = "owner" | "manager" | "staff" | "support";
const ROLES: Role[] = ["owner", "manager", "staff"];
const ROLE_LABELS: Record<Role, string> = { owner: "Owner", manager: "Manager", staff: "Staff", support: "Zypher support" };
// shortcut: copy of plan_limit(…, 'logins') in 20261101000000_platform.sql, only for the header text (the database enforces the real limit); change both together
const PLAN_LOGINS: Record<string, number> = { starter: 3 };

interface Person {
  id: string; full_name: string; role: Role; branch_id: string | null; is_active: boolean;
  email: string; last_sign_in_at: string | null; pending: boolean;
}
type Change = { person: Person; patch: { role?: Role; is_active?: boolean; branch_id?: string | null }; text: string };

// The owner's one page for their people (branches are on Branch management). The database functions (migration 033)
// check every rule again: only the real owner of this shop, plan limits, at least one active owner, Zypher support
// logins only switched off/on.
export default function StaffManagement() {
  const { shop, role, isSupport, branches } = useShop();
  const { profile } = useAuth();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [invite, setInvite] = useState({ email: "", fullName: "", role: "staff" as Role, branchId: "" });
  const [inviting, setInviting] = useState(false);
  const [share, setShare] = useState<{ name: string; link: string } | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const isRealOwner = role === "owner" && !isSupport;
  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc("setup_people", { p_shop_id: shop.id });
    if (error) return void toast.error("Could not load your staff: " + error.message);
    setPeople(data as unknown as Person[]);
  }, [shop.id]);
  useEffect(() => { if (isRealOwner) void load(); }, [isRealOwner, load]);

  if (!isRealOwner) return <Panel><p className="text-sm text-muted-foreground">Only the shop owner can manage staff.</p></Panel>;

  const openBranches = branches.filter((b) => b.is_active);
  const loginLimit = PLAN_LOGINS[shop.plan];
  const loginsUsed = (people ?? []).filter((p) => p.is_active && p.role !== "support").length;
  const needsBranch = invite.role === "manager" || invite.role === "staff";

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = personNameError(invite.fullName, "person's name") ?? emailError(invite.email)
      ?? (needsBranch && !invite.branchId ? "Choose the branch they work at." : null);
    if (bad) return void toast.error(bad);
    setInviting(true);
    try {
      const { link } = await inviteStaff({
        shopId: shop.id, email: normalizeEmail(invite.email), fullName: invite.fullName.trim().replace(/\s+/g, " "),
        role: invite.role, branchId: needsBranch ? invite.branchId : null,
      });
      setShare({ name: invite.fullName.trim(), link });
      setInvite({ email: "", fullName: "", role: "staff", branchId: "" });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the invite.");
    } finally {
      setInviting(false);
    }
  };

  const freshLink = async (p: Person) => {
    setWorkingId(p.id);
    try {
      const { link } = await newInviteLink(shop.id, p.id);
      if (link) setShare({ name: p.full_name, link });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create a new link.");
    } finally {
      setWorkingId(null);
    }
  };

  const apply = async () => {
    if (!change) return;
    const { person, patch } = change;
    setChange(null);
    setWorkingId(person.id);
    const { error } = await createClient().rpc("setup_set_person", { p_shop_id: shop.id, p_user_id: person.id, p: patch });
    setWorkingId(null);
    if (error) return void toast.error(error.message);
    toast.success("Saved");
    await load();
  };

  const ask = (person: Person, patch: Change["patch"], text: string) => setChange({ person, patch, text });
  const small = inputClass + " w-auto min-w-[7.5rem] py-1 text-xs";

  return (
    <div className="space-y-5">
      <PageHeader title="Staff management"
        subtitle={`${initial(shop.plan)} plan · ${loginsUsed}${loginLimit ? ` of ${loginLimit}` : ""} logins in use`} />

      <Panel title={<span className="flex items-center gap-2"><UserPlus className="h-4 w-4 text-gold" aria-hidden="true" /> Add a person</span>}>
        <form onSubmit={sendInvite} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto_auto]">
          <input type="text" required placeholder="Full name" aria-label="Full name" className={inputClass} value={invite.fullName}
            onChange={(e) => setInvite({ ...invite, fullName: e.target.value })} />
          <input type="email" required placeholder="Email" aria-label="Email" className={inputClass} value={invite.email}
            onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
          <select aria-label="Role" className={inputClass} value={invite.role}
            onChange={(e) => setInvite({ ...invite, role: e.target.value as Role, branchId: "" })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <select aria-label="Branch" className={inputClass} value={invite.branchId} disabled={!needsBranch} required={needsBranch}
            onChange={(e) => setInvite({ ...invite, branchId: e.target.value })}>
            <option value="">{needsBranch ? "Branch" : "All branches"}</option>
            {openBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button type="submit" disabled={inviting} className={goldButtonClass}>{inviting ? "Creating..." : "Create invite link"}</button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          You get a link to send on WhatsApp. It works once, for one hour; the person opens it and chooses their own password.
          Managers and staff work at one branch; owners see all branches.
        </p>
      </Panel>

      <Panel title="People">
        {people === null ? <Empty>Loading staff...</Empty> : (
          <div className={tableWrap}>
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className={theadClass}>
                <tr><th className="px-4 py-3">Person</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Access</th><th className="px-4 py-3" /></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {people.map((p) => {
                  const zypher = p.role === "support";
                  const me = p.id === profile?.id;
                  const working = workingId === p.id || me;
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium text-foreground">{p.full_name}{me ? " (you)" : ""}</span>
                        <span className="block text-xs text-muted-foreground">{p.email} · {p.pending ? "never signed in" : "last sign-in " + fmtDateTime(p.last_sign_in_at, shop.timezone ?? undefined)}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {zypher ? <span className="text-xs text-muted-foreground">{ROLE_LABELS.support}</span> : (
                          <select aria-label={"Role for " + p.full_name} className={small} value={p.role} disabled={working}
                            onChange={(e) => ask(p, { role: e.target.value as Role }, `Change ${p.full_name} to ${ROLE_LABELS[e.target.value as Role]}?`)}>
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {p.role === "owner" || zypher ? <span className="text-xs text-muted-foreground">All branches</span> : (
                          <select aria-label={"Branch for " + p.full_name} className={small} value={p.branch_id ?? ""} disabled={working}
                            onChange={(e) => ask(p, { branch_id: e.target.value || null }, `Move ${p.full_name} to ${openBranches.find((b) => b.id === e.target.value)?.name ?? "no branch"}?`)}>
                            <option value="">Unassigned</option>
                            {openBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium has-[:disabled]:cursor-not-allowed">
                            <Switch checked={p.is_active} disabled={working} aria-label={(p.is_active ? "Switch off " : "Switch on ") + p.full_name}
                              onCheckedChange={() => ask(p, { is_active: !p.is_active }, p.is_active
                                ? `Switch off ${p.full_name}? They lose access straight away.`
                                : `Switch on ${p.full_name}? They can sign in.`)} />
                            <span className={p.is_active ? "text-foreground" : "text-muted-foreground"}>{p.is_active ? "Active" : "Off"}</span>
                          </label>
                          {p.pending ? <StatusBadge tone="indigo">Invite pending</StatusBadge> : null}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {/* an inactive person is signed out the moment they use a link, so switch them on first */}
                        {zypher || me || !p.is_active ? null : (
                          <button type="button" disabled={working} onClick={() => void freshLink(p)} aria-label={"New login link for " + p.full_name}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
                            <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> {p.pending ? "New invite link" : "Login link"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Use the switch to turn someone off or on; switch a person on before sending them a link. &quot;Login link&quot; is for a
          forgotten password. You cannot change your own role. Branches are on Branch management.
        </p>
      </Panel>

      <Modal open={share !== null} onClose={() => setShare(null)} title={`Link for ${share?.name ?? ""}`}
        description="Send this link to them (WhatsApp is fine). It works once and expires in one hour; they set their own password."
        footer={<>
          <button type="button" className={ghostButtonClass} onClick={() => setShare(null)}>Close</button>
          <button type="button" className={goldButtonClass} onClick={() => navigator.clipboard.writeText(share?.link ?? "").then(
            () => toast.success("Link copied"), () => toast.error("Could not copy"))}>
            <Copy className="h-4 w-4" aria-hidden="true" /> Copy link
          </button>
        </>}>
        <textarea readOnly value={share?.link ?? ""} aria-label="Link" rows={3}
          className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground" />
      </Modal>

      <ConfirmDialog open={change !== null} message={change?.text ?? ""} onConfirm={() => void apply()} onCancel={() => setChange(null)} />
    </div>
  );
}

function initial(plan: string) {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}
