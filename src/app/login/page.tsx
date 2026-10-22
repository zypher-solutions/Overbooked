"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { inputClass, goldButtonClass } from "@/components/overbooked/primitives";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter both email and password");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      toast.success("Login successful", { description: "Welcome back to Overbooked!" });
      router.push("/");
      router.refresh(); // Force a refresh to update server components / middleware
    } catch (err: any) {
      console.error(err);
      toast.error("Login Failed", { description: err.message || "Invalid credentials" });
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass + " pl-10 h-12"}
                  placeholder="manager@overbooked.com"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="login-password" className="text-sm font-medium text-muted-foreground block">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground/50" />
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass + " pl-10 h-12"}
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

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

          <div className="mt-8 text-center text-xs text-muted-foreground/50">
            <p>Protected by Overbooked Internal Auth System</p>
          </div>
        </div>
      </div>
    </div>
  );
}
