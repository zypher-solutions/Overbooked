"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { inputClass, goldButtonClass } from "@/components/overbooked/primitives";

// A token works once. Signing in makes AuthProvider re-mount this page, so the result is kept per token
// for the life of the page instead of in component state.
const verifications = new Map<string, Promise<boolean>>();

// Landing page of an invite link: signs the person in with the link's token, then they choose a password.
function Welcome() {
  const params = useSearchParams();
  const router = useRouter();
  const supabase = createClient();
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const tokenHash = params.get("token_hash");
    const type = params.get("type") === "recovery" ? "recovery" : "invite";
    if (!tokenHash) {
      setState("invalid");
      return;
    }
    if (!verifications.has(tokenHash)) {
      verifications.set(tokenHash, supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => !error));
    }
    let live = true;
    verifications.get(tokenHash)!.then((ok) => { if (live) setState(ok ? "ready" : "invalid"); });
    return () => { live = false; };
  }, [params, supabase]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters.");
    if (password !== password2) return toast.error("Passwords do not match.");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return toast.error(error.message || "Could not save the password.");
    toast.success("Password set. Welcome!");
    router.push("/");
    router.refresh();
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
              <p className="text-sm text-muted-foreground">Invite links work once and for one hour. Ask your shop owner for a new link.</p>
            </div>
          )}
          {state === "ready" && (
            <form onSubmit={save} className="space-y-5">
              <h2 className="text-2xl font-semibold">Choose your password</h2>
              {[{ id: "pw", label: "Password", value: password, set: setPassword },
                { id: "pw2", label: "Confirm password", value: password2, set: setPassword2 }].map((f) => (
                <div key={f.id} className="space-y-2">
                  <label htmlFor={f.id} className="text-sm font-medium text-muted-foreground block">{f.label}</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground/50" />
                    <input id={f.id} type="password" autoComplete="new-password" value={f.value}
                      onChange={(e) => f.set(e.target.value)} className={inputClass + " pl-10 h-12"} required />
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
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
