"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { emailError, normalizeEmail } from "@/lib/validate";
import { goldButtonClass, inputClass } from "@/components/overbooked/primitives";
import { PasswordField, passwordIsStrong } from "@/components/overbooked/PasswordField";

// A token works once. Signing in makes AuthProvider re-mount this page, so the result is kept per token
// for the life of the page instead of in component state.
const verifications = new Map<string, Promise<boolean>>();

// Landing page of an invite or reset link: signs the person in with the link's token, then they choose a password.
// Also: the 6-digit code from the same email (for opening the email on another device), and "?change=1" for someone
// signed in with a temporary password from their owner or manager (ShopShell sends them here).
function Welcome() {
  const params = useSearchParams();
  const supabase = createClient();
  const changing = params.has("change");
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "code">("checking");
  const [codeEmail, setCodeEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [temp, setTemp] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [saving, setSaving] = useState(false);
  // someone who already turned on two-step sign-in must give a code before Supabase lets them change the password
  const [mfaFactor, setMfaFactor] = useState<string | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    const tokenHash = params.get("token_hash");
    const type = params.get("type") === "recovery" ? "recovery" : "invite";
    if (changing) {
      void supabase.auth.getUser().then(({ data }) => {
        if (data.user) setState("ready");
        else window.location.href = "/login";
      });
      return;
    }
    if (!tokenHash) {
      setState("code");
      return;
    }
    if (!verifications.has(tokenHash)) {
      verifications.set(tokenHash, supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => !error));
    }
    let live = true;
    verifications.get(tokenHash)!.then(async (ok) => {
      if (ok) {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
          const { data: factors } = await supabase.auth.mfa.listFactors();
          if (live) setMfaFactor(factors?.totp?.[0]?.id ?? null);
        }
      }
      if (live) setState(ok ? "ready" : "invalid");
    });
    return () => { live = false; };
  }, [params, supabase, changing]);

  // the code in the invite or reset email; the email does not say which, so both are tried
  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = normalizeEmail(codeEmail);
    const bad = emailError(email) ?? (/^\d{6}$/.test(emailCode) ? null : "Enter the 6-digit code from the email.");
    if (bad) return void toast.error(bad);
    setSaving(true);
    let ok = !(await supabase.auth.verifyOtp({ email, token: emailCode, type: "invite" })).error;
    if (!ok) ok = !(await supabase.auth.verifyOtp({ email, token: emailCode, type: "recovery" })).error;
    setSaving(false);
    if (!ok) return void toast.error("That code did not work. Codes work once, for one hour.");
    setState("ready");
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (changing && !temp) return toast.error("Enter the temporary password you were given.");
    if (!passwordIsStrong(password)) return toast.error("Follow every password rule in the list.");
    if (password !== password2) return toast.error("Passwords do not match.");
    if (changing && password === temp) return toast.error("Choose a password different from the temporary one.");
    if (mfaFactor && !/^\d{6}$/.test(code)) return toast.error("Enter the 6 digits from your authenticator app.");
    setSaving(true);
    if (changing) {
      // proves this is the person who was given the temporary password, not an old session left open somewhere
      const { data } = await supabase.auth.getUser();
      const { error: tempErr } = await supabase.auth.signInWithPassword({ email: data.user?.email ?? "", password: temp });
      if (tempErr) { setSaving(false); return toast.error("The temporary password is not right."); }
    }
    if (mfaFactor) {
      const { error: codeErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfaFactor, code });
      if (codeErr) { setSaving(false); setCode(""); return toast.error("That code did not work. Try the next code."); }
      await supabase.auth.refreshSession();
      setMfaFactor(null);
    }
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return toast.error(error.message || "Could not save the password.");
    await supabase.rpc("log_account_event", { p_kind: "password_changed" }).then(() => undefined, () => undefined);
    // a reset must lock out whoever had the old password (this device stays in)
    await supabase.auth.signOut({ scope: "others" }).then(() => undefined, () => undefined);
    toast.success("Password set. Welcome!");
    const { data: needsCode } = await supabase.rpc("mfa_required");
    window.location.href = needsCode ? "/mfa" : "/";   // a full load, so the app reads the cleared "must change" flag
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl font-bold tracking-tight mb-2">Overbooked</h1>
          <p className="text-sm font-medium tracking-[0.2em] text-gold uppercase">Welcome</p>
        </div>
        <div className="glass p-6 sm:p-10 rounded-2xl shadow-glow-soft">
          {state === "checking" && (
            <p className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your invite...
            </p>
          )}
          {state === "invalid" && (
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold">This link has expired</h2>
              <p className="text-sm text-muted-foreground">Links work once and for one hour. Ask your shop owner for a new link, or use &quot;Forgot your password?&quot; on the sign-in page.</p>
              <button type="button" onClick={() => setState("code")} className="text-sm font-medium text-gold hover:underline">I have a 6-digit code</button>
            </div>
          )}
          {state === "code" && (
            <form onSubmit={submitCode} className="space-y-5">
              <h2 className="text-2xl font-semibold">Enter your code</h2>
              <p className="text-sm text-muted-foreground">Type the email the invite or reset was sent to, and the 6-digit code from that email.</p>
              <input type="email" value={codeEmail} onChange={(e) => setCodeEmail(e.target.value)} autoComplete="email" autoCapitalize="none"
                aria-label="Email" placeholder="you@email.com" className={inputClass + " h-12"} />
              <input value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric"
                autoComplete="one-time-code" aria-label="6-digit code from the email" placeholder="6-digit code" className={inputClass + " h-12 text-center font-mono tracking-[0.4em]"} />
              <button type="submit" disabled={saving} className={goldButtonClass + " w-full h-12 text-base"}>
                {saving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Continue"}
              </button>
            </form>
          )}
          {state === "ready" && (
            <form onSubmit={save} className="space-y-5">
              <h2 className="text-2xl font-semibold">Choose your password</h2>
              {changing ? (
                <>
                  <p className="text-sm text-muted-foreground">You signed in with a temporary password. Choose your own to continue; nobody else will know it.</p>
                  <PasswordField id="temp" label="Temporary password" value={temp} onChange={setTemp} autoComplete="current-password" />
                </>
              ) : null}
              <PasswordField id="pw" label="Password" value={password} onChange={setPassword} autoComplete="new-password" rules autoFocus />
              <PasswordField id="pw2" label="Confirm password" value={password2} onChange={setPassword2} autoComplete="new-password" />
              {password2 && password !== password2 ? <p className="text-xs text-rust">The two passwords are not the same yet.</p> : null}
              {mfaFactor ? (
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
                  aria-label="6-digit code from your authenticator app" placeholder="6-digit code from your authenticator app" className={inputClass + " h-12 text-center font-mono"} />
              ) : null}
              <button type="submit" disabled={saving} className={goldButtonClass + " w-full h-12 text-base"}>
                {saving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Save and continue"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense>
      <Welcome />
    </Suspense>
  );
}
