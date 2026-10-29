"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { goldButtonClass, inputClass } from "@/components/overbooked/primitives";

// Two-step sign-in with an authenticator app (TOTP). Zypher staff and Zypher support logins must pass it;
// anyone else can switch it on for themselves here (Change password > Set up two-step sign-in).
type Setup = { factorId: string; qr: string; secret: string };

export default function MfaPage() {
  const supabase = createClient();
  const [state, setState] = useState<"loading" | "verify" | "enrol">("loading");
  const [factorId, setFactorId] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const done = async () => {
    await supabase.auth.refreshSession(); // the new session carries the second step
    const { data: isZypher } = await supabase.rpc("is_platform_admin");
    window.location.href = isZypher ? "/zypher" : "/";
  };

  useEffect(() => {
    void (async () => {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") return void (window.location.href = "/");
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = factors?.totp?.[0]; // listFactors lists verified factors here
      if (verified) { setFactorId(verified.id); setState("verify"); return; }
      // drop a half-finished earlier setup, then make a fresh one
      for (const f of factors?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
      if (error || !data) { toast.error(error?.message ?? "Could not start two-step setup."); return; }
      setSetup({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setFactorId(data.id);
      setState("enrol");
    })();
  }, [supabase]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return toast.error("Enter the 6 digits from your app.");
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (error) { setCode(""); return toast.error("That code did not work. Check the time on your phone and try the next code."); }
    toast.success("Signed in with two steps.");
    await done();
  };

  const signOut = async () => { await supabase.auth.signOut({ scope: "local" }); window.location.href = "/login"; };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="mb-2 font-display text-4xl font-bold tracking-tight">Overbooked</h1>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-gold">Two-step sign-in</p>
        </div>
        <div className="glass rounded-2xl p-6 shadow-glow-soft sm:p-10">
          {state === "loading" ? (
            <p className="flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> One moment...</p>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <h2 className="flex items-center gap-2 text-2xl font-semibold"><ShieldCheck className="h-6 w-6 text-gold" /> {state === "enrol" ? "Set up your authenticator" : "Enter your code"}</h2>
              {state === "enrol" && setup ? (
                <>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy).</li>
                    <li>Scan this square, or type the key under it.</li>
                    <li>Type the 6 digits it shows.</li>
                  </ol>
                  <div className="flex justify-center rounded-lg bg-white p-3">
                    <img src={setup.qr} alt="QR code for your authenticator app" className="h-44 w-44" />
                  </div>
                  <p className="break-all rounded-md border border-border bg-muted/30 px-3 py-2 text-center font-mono text-xs" aria-label="Setup key">{setup.secret}</p>
                </>
              ) : <p className="text-sm text-muted-foreground">Open your authenticator app and type the 6 digits it shows for Overbooked.</p>}
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
                aria-label="6-digit code" placeholder="123456" autoFocus className={inputClass + " h-12 text-center font-mono text-xl tracking-[0.4em]"} />
              <button type="submit" disabled={busy} className={goldButtonClass + " h-12 w-full text-base"}>
                {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : state === "enrol" ? "Turn on and continue" : "Continue"}
              </button>
              <button type="button" onClick={signOut} className="block w-full text-center text-xs text-muted-foreground hover:text-foreground">Sign out</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
