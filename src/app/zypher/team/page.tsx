"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { inviteZypherMember, listZypherTeam, setZypherMemberActive, type ZypherMember } from "@/app/actions/zypher";
import { Field, StatusBadge, goldButtonClass, ghostButtonClass, inputClass } from "@/components/overbooked/primitives";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader, Panel, ShareLinkDialog, fmtWhen } from "@/components/zypher/kit";

// Zypher staff logins: they can see every shop and open any of them.
export default function Team() {
  const { profile } = useAuth();
  const [team, setTeam] = useState<ZypherMember[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState<{ name: string; link: string } | null>(null);

  const load = useCallback(async () => {
    try { setTeam(await listZypherTeam()); } catch (e) { toast.error((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const invite = async () => {
    setBusy(true);
    try {
      const { link } = await inviteZypherMember(form);
      setAdding(false);
      setShare({ name: form.fullName, link });
      setForm({ fullName: "", email: "" });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (m: ZypherMember) => {
    try {
      await setZypherMemberActive(m.id, !m.is_active);
      toast.success(m.is_active ? `${m.full_name} can no longer sign in` : `${m.full_name} can sign in again`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Zypher team" subtitle="People who run Overbooked. They see every shop, so add only Zypher staff."
        actions={<button className={goldButtonClass} onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> Add a person</button>} />
      <Panel>
        {team === null ? <p className="text-sm text-muted-foreground">Loading...</p> : (
          <ul className="divide-y divide-border">
            {team.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-medium">{m.full_name}{m.id === profile?.id ? <span className="text-muted-foreground"> (you)</span> : null}</p>
                  <p className="text-xs text-muted-foreground">{m.email} · last sign-in {fmtWhen(m.last_sign_in_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={m.is_active ? "emerald" : "muted"}>{m.is_active ? "Active" : "Off"}</StatusBadge>
                  {m.id !== profile?.id ? (
                    <button className={ghostButtonClass} onClick={() => toggle(m)}>{m.is_active ? "Turn off" : "Turn on"}</button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <AlertDialog open={adding} onOpenChange={setAdding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a Zypher staff member</AlertDialogTitle>
            <AlertDialogDescription>You get a one-hour link to send them; they choose their own password.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3">
            <Field label="Name"><input className={inputClass} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
            <Field label="Email"><input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void invite(); }}>{busy ? "Creating..." : "Create invite link"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ShareLinkDialog share={share} onClose={() => setShare(null)} />
    </>
  );
}
