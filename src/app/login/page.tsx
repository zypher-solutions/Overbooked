"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { inputClass, goldButtonClass } from "@/components/overbooked/primitives";
import { PasswordField } from "@/components/overbooked/PasswordField";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Please enter both email and password");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;

      // Zypher staff and Zypher support logins must also pass two-step sign-in before the app opens for them
      const { data: needsCode } = await supabase.rpc("mfa_required");
      // anyone who switched two-step sign-in on for themselves is asked for the code too
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (needsCode || (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2")) {
        router.push("/mfa");
        router.refresh();
        return;
      }
      toast.success("Login successful", { description: "Welcome back to Overbooked!" });
      // Zypher staff start in their console
      const { data: isZypher } = await supabase.rpc("is_platform_admin");
      router.push(isZypher ? "/zypher" : "/");
      router.refresh(); // Force a refresh to update server components / middleware
    } catch (err) {
      console.error(err);
      // the same words for a wrong email and a wrong password, so the screen never says which accounts exist
      const message = err instanceof Error && /rate|too many/i.test(err.message) ? "Too many tries. Wait a few minutes and try again." : "Check your email and password.";
      toast.error("Login failed", { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Decorative background blurs */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-gold/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-rust/5 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md">
        <div className="text-center mb-8 sm:mb-10">
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight mb-2">Overbooked</h1>
          <p className="text-sm font-medium tracking-[0.2em] text-gold uppercase">Rental Studio</p>
        </div>

        <div className="glass p-6 sm:p-10 rounded-2xl shadow-glow-soft relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
          <h2 className="text-2xl font-semibold mb-6">Staff Login</h2>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="login-email" className="text-sm font-medium text-muted-foreground block">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground/50" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass + " pl-10 h-12"}
                  placeholder="manager@overbooked.com"
                  required
                />
              </div>
            </div>

            <PasswordField id="login-password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />

            <button
              type="submit"
              disabled={loading}
              className={goldButtonClass + " w-full h-12 mt-4 text-base group relative overflow-hidden"}
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              ) : (
                <span className="flex items-center justify-center">
                  Sign In
                  <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                </span>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">Forgot your password? Ask Zypher for a new link.</p>
        </div>
      </div>
    </div>
  );
}
