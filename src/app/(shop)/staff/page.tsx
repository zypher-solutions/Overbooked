"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Link2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { emailError, normalizeEmail, personNameError } from "@/lib/validate";
import { usernameNameError } from "@/lib/username";
import { addStaffByUsername, inviteStaff, newInviteLink, resetStaffPassword } from "@/app/actions/staff";
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
  email: string | null; username: string | null; must_change_password: boolean; last_sign_in_at: string | null; pending: boolean;
}
type Change = { person: Person; patch: { role?: Role; is_active?: boolean; branch_id?: string | null }; text: string };
type Creds = { name: string; login: string; password: string };

// shown once: the owner or manager passes these on; the person must choose their own password at first sign-in
function CredsModal({ creds, onClose }: { creds: Creds | null; onClose: () => void }) {
  const text = creds ? `Login: ${creds.login}\nTemporary password: ${creds.password}` : "";
  return (
    <Modal open={creds !== null} onClose={onClose} title={`Login for ${creds?.name ?? ""}`}
      description="Give these to them in person or on WhatsApp. The password is shown only this once; they choose their own when they first sign in."
      footer={<>
        <button type="button" className={ghostButtonClass} onClick={onClose}>Done</button>
        <button type="button" className={goldButtonClass} onClick={() => navigator.clipboard.writeText(text).then(
          () => toast.success("Copied"), () => toast.error("Could not copy"))}>
          <Copy className="h-4 w-4" aria-hidden="true" /> Copy
        </button>
      </>}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md border border-border bg-background p-3 text-sm">
        <dt className="text-muted-foreground">Login</dt><dd className="font-mono text-foreground">{creds?.login}</dd>
        <dt className="text-muted-foreground">Temporary password</dt><dd className="font-mono text-foreground">{creds?.password}</dd>
      </dl>
    </Modal>
  );
}

function useReset(onDone: () => Promise<void> | void) {
  const [asking, setAsking] = useState<{ id: string; full_name: string } | null>(null);
  const [creds, setCreds] = useState<Creds | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = async () => {
    if (!asking) return;
    const p = asking;
    setAsking(null);
    setBusyId(p.id);
    try {
      const { password, login } = await resetStaffPassword(p.id);
      setCreds({ name: p.full_name, login, password });
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset the password.");
    } finally {
      setBusyId(null);
    }
  };
  const ui = <>
    <ConfirmDialog open={asking !== null} confirmLabel="Reset password"
      message={`Reset ${asking?.full_name ?? ""}'s password? They are signed out everywhere and get a temporary password from you.`}
      onConfirm={() => void confirm()} onCancel={() => setAsking(null)} />
    <CredsModal creds={creds} onClose={() => setCreds(null)} />
  </>;
  return { ask: setAsking, busyId, ui };
}

const resetButtonClass = "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50";

// a manager's view of this page: only resetting the passwords of staff in their own branch (migration 049)
function ManagerResets() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc("staff_reset_people");
    if (error) return void toast.error("Could not load your staff: " + error.message);
    setPeople(data as unknown as Person[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const reset = useReset(load);
  return (
    <div className="space-y-5">
      <PageHeader title="Staff management" subtitle="Reset a password for staff of your branch" />
      <Panel title="Staff">
        {people === null ? <Empty>Loading staff...</Empty> : people.length === 0 ? <Empty>No active staff in your branch.</Empty> : (
          <ul className="divide-y divide-border">
            {people.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <span>
                  <span className="block font-medium text-foreground">{p.full_name}</span>
                  <span className="block text-xs text-muted-foreground">{p.username ?? p.email}{p.must_change_password ? " · must choose a new password" : ""}</span>
                </span>
                <button type="button" className={resetButtonClass} disabled={reset.busyId === p.id}
                  onClick={() => reset.ask(p)} aria-label={"Reset password for " + p.full_name}>
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Reset password
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Adding, removing and changing people is done by the shop owner.</p>
      </Panel>
      {reset.ui}
    </div>
  );
}

// The owner's one page for their people (branches are on Branch management). The database functions (migration 033)
// check every rule again: only the real owner of this shop, plan limits, at least one active owner, Zypher support
// logins only switched off/on.
export default function StaffPage() {
  const { role, isSupport } = useShop();
  return role === "manager" && !isSupport ? <ManagerResets /> : <StaffManagement />;
}

const EMPTY_INVITE = { mode: "username" as "username" | "email", email: "", name: "", fullName: "", role: "staff" as Role, branchId: "" };

function StaffManagement() {
  const { shop, role, isSupport, branches } = useShop();
  const { profile } = useAuth();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [invite, setInvite] = useState(EMPTY_INVITE);
  const [inviting, setInviting] = useState(false);
  const [share, setShare] = useState<{ name: string; link: string } | null>(null);
  const [newCreds, setNewCreds] = useState<Creds | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const isRealOwner = role === "owner" && !isSupport;
  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc("setup_people", { p_shop_id: shop.id });
    if (error) return void toast.error("Could not load your staff: " + error.message);
    setPeople(data as unknown as Person[]);
  }, [shop.id]);
  useEffect(() => { if (isRealOwner) void load(); }, [isRealOwner, load]);
  const reset = useReset(load);

  if (!isRealOwner) return <Panel><p className="text-sm text-muted-foreground">Only the shop owner can manage staff.</p></Panel>;

  const openBranches = branches.filter((b) => b.is_active);
  const loginLimit = PLAN_LOGINS[shop.plan];
  const loginsUsed = (people ?? []).filter((p) => p.is_active && p.role !== "support").length;
  const byUsername = invite.mode === "username";
  const roles: Role[] = byUsername ? ["manager", "staff"] : ROLES;   // an owner always logs in with a real email
  const needsBranch = invite.role === "manager" || invite.role === "staff";

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = personNameError(invite.fullName, "person's name") ?? (byUsername ? usernameNameError(invite.name) : emailError(invite.email))
      ?? (needsBranch && !invite.branchId ? "Choose the branch they work at." : null);
    if (bad) return void toast.error(bad);
    setInviting(true);
    try {
      const fullName = invite.fullName.trim().replace(/\s+/g, " ");
      if (byUsername) {
        const { username, password } = await addStaffByUsername({
          shopId: shop.id, name: invite.name.trim().toLowerCase(), fullName,
          role: invite.role as "manager" | "staff", branchId: invite.branchId,
        });
        setNewCreds({ name: fullName, login: username, password });
      } else {
        const { emailedTo } = await inviteStaff({
          shopId: shop.id, email: normalizeEmail(invite.email), fullName,
          role: invite.role, branchId: needsBranch ? invite.branchId : null,
        });
        toast.success(`Invite emailed to ${emailedTo}. It works once, for one hour.`);
      }
      setInvite({ ...EMPTY_INVITE, mode: invite.mode });
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
        <div role="radiogroup" aria-label="How they log in" className="mb-3 inline-flex rounded-lg border border-border p-0.5 text-sm">
          {(["username", "email"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={invite.mode === m}
              onClick={() => setInvite({ ...invite, mode: m, role: m === "username" && invite.role === "owner" ? "staff" : invite.role })}
              className={"rounded-md px-3 py-1.5 " + (invite.mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {m === "username" ? "With username" : "With email"}
            </button>
          ))}
        </div>
        <form onSubmit={sendInvite} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto_auto]">
          <input type="text" required placeholder="Full name" aria-label="Full name" className={inputClass} value={invite.fullName}
            onChange={(e) => setInvite({ ...invite, fullName: e.target.value })} />
          {byUsername ? (
            <div className={inputClass + " flex items-center gap-1 focus-within:border-neon focus-within:ring-2 focus-within:ring-ring"}>
              <input type="text" required placeholder="Username" aria-label="Username" autoCapitalize="none" spellCheck={false} maxLength={30}
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/80" value={invite.name}
                onChange={(e) => setInvite({ ...invite, name: e.target.value.toLowerCase().replace(/\s/g, "") })} />
              <span className="shrink-0 text-muted-foreground">@{shop.slug}</span>
            </div>
          ) : (
            <input type="email" required placeholder="Email" aria-label="Email" className={inputClass} value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
          )}
          <select aria-label="Role" className={inputClass} value={invite.role}
            onChange={(e) => setInvite({ ...invite, role: e.target.value as Role, branchId: "" })}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <select aria-label="Branch" className={inputClass} value={invite.branchId} disabled={!needsBranch} required={needsBranch}
            onChange={(e) => setInvite({ ...invite, branchId: e.target.value })}>
            <option value="">{needsBranch ? "Branch" : "All branches"}</option>
            {openBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button type="submit" disabled={inviting} className={goldButtonClass}>
            {inviting ? "Creating..." : byUsername ? "Create login" : "Email invite"}
          </button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          {byUsername
            ? "For people without email. You get a temporary password to give them; they choose their own at first sign-in. If they forget it, you or their manager reset it here."
            : "We email them an invite with a link and a 6-digit code. It works once, for one hour; only someone with that inbox can join. They can reset a forgotten password themselves."}
          {" "}Managers and staff work at one branch; owners see all branches and always log in with email.
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
                        <span className="block text-xs text-muted-foreground">
                          {p.username ?? p.email} · {p.pending ? "never signed in" : "last sign-in " + fmtDateTime(p.last_sign_in_at, shop.timezone ?? undefined)}
                          {p.must_change_password ? " · must choose a new password" : ""}
                        </span>
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
                          <div className="inline-flex flex-wrap justify-end gap-1.5">
                            {p.role !== "owner" ? (
                              <button type="button" disabled={working || reset.busyId === p.id} onClick={() => reset.ask(p)}
                                aria-label={"Reset password for " + p.full_name} className={resetButtonClass}>
                                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Reset password
                              </button>
                            ) : null}
                            {p.username ? null : (
                              <button type="button" disabled={working} onClick={() => void freshLink(p)} aria-label={"New login link for " + p.full_name}
                                className={resetButtonClass}>
                                <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> {p.pending ? "New invite link" : "Login link"}
                              </button>
                            )}
                          </div>
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
          Use the switch to turn someone off or on; switch a person on before resetting their password. &quot;Reset password&quot; gives
          them a temporary password and signs them out everywhere. You cannot change your own role. Branches are on Branch management.
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
      <CredsModal creds={newCreds} onClose={() => setNewCreds(null)} />
      {reset.ui}
    </div>
  );
}

function initial(plan: string) {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}
