"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { call } from "@/lib/shop/api";
import { errorText } from "@/lib/shop/format";
import { PasswordField } from "@/components/overbooked/PasswordField";
import { Modal, Panel, ghostButtonClass, goldButtonClass } from "./ui";

// Settings > Master password (migrations 046, 047): one per shop, owner only. Needed to block or allow a device;
// more owner-only actions will ask for it later. Changing it needs the current one; a forgotten one is reset with the
// owner's own sign-in password.
type Mode = "set" | "change" | "reset";

const TITLES: Record<Mode, string> = { set: "Set master password", change: "Change master password", reset: "Reset forgotten master password" };

export function MasterPassword() {
  const [has, setHas] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [proof, setProof] = useState(""); // the current master password, or the sign-in password for a reset
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void call<boolean>("has_master_password").then(setHas, () => setHas(null)); }, []);

  const start = (m: Mode) => { setProof(""); setNext(""); setAgain(""); setMode(m); };
  const save = async () => {
    if (!mode) return;
    if (mode !== "set" && !proof) return void toast.error(mode === "reset" ? "Enter your sign-in password." : "Enter the current master password.");
    if (next.length < 6) return void toast.error("The master password is at least 6 characters.");
    if (next !== again) return void toast.error("The two new passwords are not the same.");
    setBusy(true);
    try {
      if (mode === "reset") {
        const result = await call<string>("reset_master_password", { p_login_password: proof, p_new: next });
        if (result === "wrong") return void toast.error("That is not your sign-in password.");
        if (result === "locked") return void toast.error("Too many wrong tries. Wait 15 minutes and try again.");
      } else {
        await call("set_master_password", { p_new: next, p_current: mode === "change" ? proof : null });
      }
      toast.success(mode === "set" ? "Master password set" : "Master password changed");
      setHas(true);
      setMode(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Master password</p>
          <p className="text-xs text-muted-foreground">
            {has === null ? "Checking..." : has ? "Set. Needed to block or allow a device in Admin > Devices." : "Not set yet. You need it to block or allow a device."}
            {" "}Keep it to yourself; it is not your sign-in password.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {has ? <button className={ghostButtonClass} onClick={() => start("reset")}>Forgot it?</button> : null}
          <button className={has ? ghostButtonClass : goldButtonClass} disabled={has === null} onClick={() => start(has ? "change" : "set")}>
            {has ? "Change" : "Set master password"}
          </button>
        </div>
      </div>

      <Modal open={!!mode} onClose={() => setMode(null)} title={mode ? TITLES[mode] : ""}
        description={mode === "reset"
          ? "Enter the password you sign in with to prove it is you, then choose a new master password."
          : "6 to 72 characters. Write it down: changing it later needs the current one."}
        footer={<button className={goldButtonClass} disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : "Save"}</button>}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {mode === "change" ? <PasswordField id="master-current" label="Current master password" value={proof} onChange={setProof} autoComplete="off" /> : null}
          {mode === "reset" ? <PasswordField id="master-login" label="Your sign-in password" value={proof} onChange={setProof} autoComplete="current-password" /> : null}
          <PasswordField id="master-new" label="New master password" value={next} onChange={setNext} autoComplete="off" />
          <PasswordField id="master-again" label="New master password again" value={again} onChange={setAgain} autoComplete="off" />
          {/* lets Enter submit; the footer's Save sits outside the form */}
          <button type="submit" hidden />
        </form>
      </Modal>
    </Panel>
  );
}
