"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Printer } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/shop/api";
import { errorText, fmtDateTime } from "@/lib/shop/format";
import { useAuth } from "@/lib/overbooked/AuthContext";
import { emailOwnerCode } from "@/app/actions/master";
import { CodeBoxes } from "@/components/overbooked/CodeBoxes";
import { PasswordField } from "@/components/overbooked/PasswordField";
import { Modal, Panel, ghostButtonClass, goldButtonClass, inputClass } from "./ui";

// Settings > Master password (migrations 046, 050, 052): one per shop, owner only. Recovery codes are given once. Needed to block or allow a device;
// more owner-only actions will ask for it later. Changing it needs the current one. A forgotten one is reset only with a
// recovery code (8 one-time codes shown when it is set), never with the sign-in password, so someone the owner lent
// their sign-in to cannot take it over. 5 wrong tries lock it for 15 minutes.
// Codes lost too (migration 051): the owner asks Zypher after typing a code emailed to them, Zypher phones to confirm,
// then a 24-hour wait (emailed alert, banner with Cancel here) before the owner sets a new one ("complete").
type Mode = "set" | "change" | "reset" | "codes" | "ask" | "complete";
type Result = { result: "ok" | "wrong" | "locked"; codes?: string[]; left?: number };
type Request = { requested_at: string; confirmed_at: string | null; ready_at: string | null; ready: boolean };

const TITLES: Record<Mode, string> = {
  set: "Set master password", change: "Change master password", reset: "Forgot the master password", codes: "Create recovery codes",
  ask: "Ask Zypher to reset it", complete: "Set a new master password",
};
const DESCRIPTIONS: Record<Mode, string> = {
  set: "8 to 72 characters. Keep it to yourself: it is not your sign-in password, and only you should know it.",
  change: "8 to 72 characters. Changing it needs the current one.",
  reset: "Enter one of your recovery codes. Once it is checked, you choose a new master password; that code is then used up.",
  codes: "Your shop has no recovery codes yet. Enter the master password to get them. They are given only once.",
  ask: "For when you lost the recovery codes too. We email you a code to prove it is you; then Zypher phones the shop to confirm, and after a 24-hour wait you set a new master password.",
  complete: "Zypher's check and the 24-hour wait are done. Choose a new master password; you get 8 new recovery codes.",
};

export function MasterPassword() {
  const { user } = useAuth();
  const [request, setRequest] = useState<Request | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [codeOk, setCodeOk] = useState(false); // "Forgot it?": the recovery code is checked before the new password is asked
  const [has, setHas] = useState<boolean | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [proof, setProof] = useState(""); // the current master password, or a recovery code
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    const h = await call<boolean>("has_master_password").catch(() => null);
    setHas(h);
    setLeft(h ? await call<number>("master_codes_left").catch(() => null) : null);
    setRequest(h ? await call<Request | null>("master_reset_status").catch(() => null) : null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const start = (m: Mode) => { setProof(""); setNext(""); setAgain(""); setCodeSent(false); setCodeOk(false); setMode(m); };

  const checkCode = async () => {
    if (!proof.trim()) return void toast.error("Enter a recovery code.");
    setBusy(true);
    try {
      const r = await call<string>("check_master_recovery_code", { p_code: proof });
      if (r === "locked") return void toast.error("Too many wrong tries. The master password is locked for 15 minutes.");
      if (r === "wrong") return void toast.error("That recovery code is not right, or it was used already.");
      setCodeOk(true);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // "ask": the app emails the owner a 6-digit code (migration 053); the database checks it before it takes the request
  const sendCode = async () => {
    setBusy(true);
    try {
      const { email } = await emailOwnerCode();
      setCodeSent(true);
      toast.success(`Code sent to ${email}`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const ask = async () => {
    if (!/^\d{6}$/.test(proof)) return void toast.error("Enter the 6-digit code from the email.");
    setBusy(true);
    try {
      const r = await call<string>("master_reset_request", { p_code: proof });
      if (r === "wrong") return void toast.error("That code is not right.");
      if (r === "expired") { setCodeSent(false); setProof(""); return void toast.error("That code expired or had too many wrong tries. Send a new one."); }
      toast.success("Request sent. Zypher will phone the shop to confirm it is you.");
      setMode(null);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const cancelRequest = async () => {
    try {
      await call("master_reset_cancel");
      toast.success("Request cancelled. The master password stays as it was.");
      await load();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const save = async () => {
    if (!mode) return;
    if (mode === "ask") return void ask();
    if (mode === "reset" && !codeOk) return void checkCode();
    if (mode !== "set" && mode !== "complete" && !proof) return void toast.error(mode === "reset" ? "Enter a recovery code." : "Enter the current master password.");
    if (mode !== "codes") {
      if (next.length < 8) return void toast.error("The master password is at least 8 characters.");
      if (next !== again) return void toast.error("The two new passwords are not the same.");
    }
    setBusy(true);
    try {
      const r = mode === "complete" ? { result: "ok" as const, ...(await call<{ codes: string[] }>("master_reset_complete", { p_new: next })) }
        : mode === "reset" ? await call<Result>("reset_master_password_with_code", { p_code: proof, p_new: next })
        : mode === "codes" ? await call<Result>("new_master_recovery_codes", { p_master: proof })
        : await call<Result>("set_master_password", { p_new: next, p_current: mode === "change" ? proof : null });
      if (r.result === "locked") return void toast.error("Too many wrong tries. The master password is locked for 15 minutes.");
      if (r.result === "wrong") return void toast.error(mode === "reset" ? "That recovery code is not right, or it was used already." : "That is not the master password.");
      toast.success(mode === "set" || mode === "complete" ? "Master password set" : mode === "codes" ? "Recovery codes made"
        : mode === "reset" ? `Master password reset. ${r.left ?? 0} recovery codes left.` : "Master password changed");
      setMode(null);
      if (r.codes) setCodes(r.codes);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const codesText = (codes ?? []).join("\n");
  const print = () => {
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return void toast.error("Allow pop-ups to print.");
    const d = w.document;
    d.title = "Master password recovery codes";
    d.body.style.fontFamily = "monospace";
    const add = (tag: string, text: string) => { const el = d.createElement(tag); el.textContent = text; d.body.appendChild(el); return el; };
    add("h3", "Overbooked master password recovery codes");
    add("p", "Each code works once. Keep this somewhere safe.");
    add("pre", codesText).style.cssText = "font-size:18px;line-height:1.8";
    w.print();
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Master password</p>
          <p className="text-xs text-muted-foreground">
            {has === null ? "Checking..." : has ? "Set. Needed to block or allow a device in Admin > Devices." : "Not set yet. You need it to block or allow a device."}
            {" "}Keep it to yourself; it is not your sign-in password.
            {has && left !== null ? ` ${left} of 8 recovery codes left.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {has ? <button className={ghostButtonClass} onClick={() => start("reset")}>Forgot it?</button> : null}
          {/* only shops whose master password predates recovery codes; codes are given once (migration 052) */}
          {has && left === null ? <button className={ghostButtonClass} onClick={() => start("codes")}>Create recovery codes</button> : null}
          <button className={has ? ghostButtonClass : goldButtonClass} disabled={has === null} onClick={() => start(has ? "change" : "set")}>
            {has ? "Change" : "Set master password"}
          </button>
        </div>
      </div>
      {request ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rust/40 bg-rust/10 px-4 py-3 text-sm">
          <p>
            {request.ready ? "The master password reset is unlocked. Set a new master password now."
              : request.confirmed_at ? `A master password reset was requested and confirmed by Zypher. It unlocks on ${fmtDateTime(request.ready_at)}.`
              : `You asked Zypher to reset the master password on ${fmtDateTime(request.requested_at)}. Zypher will phone the shop to confirm.`}
            {request.ready ? "" : " Not you? Cancel it."}
          </p>
          <div className="flex gap-2">
            {request.ready ? <button className={goldButtonClass} onClick={() => start("complete")}>Set new master password</button> : null}
            <button className={ghostButtonClass} onClick={() => void cancelRequest()}>Cancel request</button>
          </div>
        </div>
      ) : null}
      {has && left !== null && left <= 2 ? (
        <p role="alert" className="mt-3 rounded-lg border border-gold/40 bg-gold/5 px-4 py-3 text-sm">
          {left === 0 ? "All your recovery codes are used." : `Only ${left} recovery code${left === 1 ? "" : "s"} left.`}
          {" "}If you forget the master password with none left, use <span className="font-medium">Forgot it? → Ask Zypher</span>.
        </p>
      ) : null}

      <Modal open={!!mode} onClose={() => setMode(null)} title={mode ? TITLES[mode] : ""} description={mode ? DESCRIPTIONS[mode] : undefined}
        footer={mode === "ask" && !codeSent ? null
          : <button className={goldButtonClass} disabled={busy} onClick={() => void save()}>
              {mode === "reset" && !codeOk ? (busy ? "Checking..." : "Check code") : busy ? "Saving..." : mode === "ask" ? "Send request" : "Save"}
            </button>}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {mode === "ask" ? (
            codeSent ? (
              <div className="space-y-2">
                <p className="text-center text-sm text-muted-foreground">Enter the 6-digit code we emailed to {user?.email}</p>
                <CodeBoxes value={proof} onChange={setProof} label="6-digit code from the email" />
              </div>
            ) : (
              <button type="button" className={goldButtonClass + " w-full"} disabled={busy} onClick={() => void sendCode()}>
                {busy ? "Sending..." : `Email a code to ${user?.email ?? "me"}`}
              </button>
            )
          ) : null}
          {mode === "change" || mode === "codes"
            ? <PasswordField id="master-current" label={mode === "codes" ? "Master password" : "Current master password"} value={proof} onChange={setProof} autoComplete="off" />
            : null}
          {mode === "reset" ? (
            <input value={proof} onChange={(e) => setProof(e.target.value.toUpperCase())} aria-label="Recovery code" placeholder="Recovery code, like K7QM-3XPD"
              readOnly={codeOk} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} className={inputClass + " font-mono tracking-widest"} />
          ) : null}
          {mode === "reset" && codeOk ? <p className="text-sm text-emerald-700">Code checked. Now choose a new master password.</p> : null}
          {mode === "reset" && !codeOk && !request ? (
            <button type="button" onClick={() => start("ask")} className="text-sm font-medium text-gold hover:underline">
              Lost the recovery codes too? Ask Zypher
            </button>
          ) : null}
          {mode !== "codes" && mode !== "ask" && (mode !== "reset" || codeOk) ? <>
            <PasswordField id="master-new" label="New master password" value={next} onChange={setNext} autoComplete="off" />
            <PasswordField id="master-again" label="New master password again" value={again} onChange={setAgain} autoComplete="off" />
          </> : null}
          {/* lets Enter submit; the footer's Save sits outside the form */}
          <button type="submit" hidden />
        </form>
      </Modal>

      <Modal open={codes !== null} onClose={() => setCodes(null)} title="Your recovery codes"
        description="If you forget the master password, one of these resets it. Each works once. They are shown only now: print them or write them down, keep them somewhere safe away from this computer, and never give them to anyone."
        footer={<>
          <button type="button" className={ghostButtonClass} onClick={print}><Printer className="h-4 w-4" aria-hidden="true" /> Print</button>
          <button type="button" className={ghostButtonClass} onClick={() => navigator.clipboard.writeText(codesText).then(
            () => toast.success("Copied"), () => toast.error("Could not copy"))}><Copy className="h-4 w-4" aria-hidden="true" /> Copy</button>
          <button type="button" className={goldButtonClass} onClick={() => setCodes(null)}>I saved them</button>
        </>}>
        <ol className="grid grid-cols-2 gap-2 rounded-md border border-border bg-background p-3 font-mono text-base tracking-widest text-foreground">
          {(codes ?? []).map((c) => <li key={c}>{c}</li>)}
        </ol>
      </Modal>
    </Panel>
  );
}
