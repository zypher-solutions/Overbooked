"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Printer } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/shop/api";
import { errorText } from "@/lib/shop/format";
import { PasswordField } from "@/components/overbooked/PasswordField";
import { Modal, Panel, ghostButtonClass, goldButtonClass, inputClass } from "./ui";

// Settings > Master password (migrations 046, 050): one per shop, owner only. Needed to block or allow a device;
// more owner-only actions will ask for it later. Changing it needs the current one. A forgotten one is reset only with a
// recovery code (8 one-time codes shown when it is set), never with the sign-in password, so someone the owner lent
// their sign-in to cannot take it over. 5 wrong tries lock it for 15 minutes.
type Mode = "set" | "change" | "reset" | "codes";
type Result = { result: "ok" | "wrong" | "locked"; codes?: string[]; left?: number };

const TITLES: Record<Mode, string> = {
  set: "Set master password", change: "Change master password", reset: "Forgot the master password", codes: "New recovery codes",
};
const DESCRIPTIONS: Record<Mode, string> = {
  set: "8 to 72 characters. Keep it to yourself: it is not your sign-in password, and only you should know it.",
  change: "8 to 72 characters. Changing it needs the current one.",
  reset: "Enter one of your recovery codes (each works once), then choose a new master password.",
  codes: "Enter the master password. You get 8 new codes and the old ones stop working.",
};

export function MasterPassword() {
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
  }, []);
  useEffect(() => { void load(); }, [load]);

  const start = (m: Mode) => { setProof(""); setNext(""); setAgain(""); setMode(m); };
  const save = async () => {
    if (!mode) return;
    if (mode !== "set" && !proof) return void toast.error(mode === "reset" ? "Enter a recovery code." : "Enter the current master password.");
    if (mode !== "codes") {
      if (next.length < 8) return void toast.error("The master password is at least 8 characters.");
      if (next !== again) return void toast.error("The two new passwords are not the same.");
    }
    setBusy(true);
    try {
      const r = mode === "reset" ? await call<Result>("reset_master_password_with_code", { p_code: proof, p_new: next })
        : mode === "codes" ? await call<Result>("new_master_recovery_codes", { p_master: proof })
        : await call<Result>("set_master_password", { p_new: next, p_current: mode === "change" ? proof : null });
      if (r.result === "locked") return void toast.error("Too many wrong tries. The master password is locked for 15 minutes.");
      if (r.result === "wrong") return void toast.error(mode === "reset" ? "That recovery code is not right, or it was used already." : "That is not the master password.");
      toast.success(mode === "set" ? "Master password set" : mode === "codes" ? "New recovery codes made"
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
          {has ? <button className={ghostButtonClass} onClick={() => start("codes")}>New recovery codes</button> : null}
          <button className={has ? ghostButtonClass : goldButtonClass} disabled={has === null} onClick={() => start(has ? "change" : "set")}>
            {has ? "Change" : "Set master password"}
          </button>
        </div>
      </div>
      {has && left !== null && left <= 2 ? (
        <p role="alert" className="mt-3 rounded-lg border border-gold/40 bg-gold/5 px-4 py-3 text-sm">
          {left === 0 ? "You have no recovery codes. If you forget the master password you cannot reset it yourself." : `Only ${left} recovery code${left === 1 ? "" : "s"} left.`}
          {" "}Use <span className="font-medium">New recovery codes</span> to make a fresh set.
        </p>
      ) : null}

      <Modal open={!!mode} onClose={() => setMode(null)} title={mode ? TITLES[mode] : ""} description={mode ? DESCRIPTIONS[mode] : undefined}
        footer={<button className={goldButtonClass} disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : "Save"}</button>}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {mode === "change" || mode === "codes"
            ? <PasswordField id="master-current" label={mode === "codes" ? "Master password" : "Current master password"} value={proof} onChange={setProof} autoComplete="off" />
            : null}
          {mode === "reset" ? (
            <input value={proof} onChange={(e) => setProof(e.target.value.toUpperCase())} aria-label="Recovery code" placeholder="Recovery code, like K7QM-3XPD"
              autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} className={inputClass + " font-mono tracking-widest"} />
          ) : null}
          {mode !== "codes" ? <>
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
