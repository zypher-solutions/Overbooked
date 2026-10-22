"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { clearRentalDraft } from "./draftStorage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Profile {
  id: string;
  full_name: string;
  role: "super_admin" | "manager" | "owner" | "staff";
  branch_id: string | null;
  is_active: boolean;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const supabase = createClient();
  const [notice, setNotice] = useState<"session" | "deactivated" | null>(null);
  // True while we end the session ourselves, so SIGNED_OUT is not reported as a lost session.
  const endingOnPurpose = useRef(false);
  const userIdRef = useRef<string | null>(null);
  // True from sign-in until the account/branch check finishes, so a blocked user never sees the app shell.
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let mounted = true;

    // Loads the profile; an inactive account is signed out (this device only) with a notice.
    async function fetchProfile(userId: string) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();
      if (!mounted || !profileData) return;
      // get_my_role() is null for staff whose branch is inactive (derived lockout, see branch_lifecycle migration).
      const { data: role } = profileData.is_active === false ? { data: null } : await supabase.rpc("get_my_role");
      if (!mounted) return;
      if (profileData.is_active === false || !role) {
        endingOnPurpose.current = true;
        setNotice("deactivated");
        await supabase.auth.signOut({ scope: "local" });
        return;
      }
      setProfile(profileData as Profile);
    }

    async function loadAuth() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session && mounted) {
          setSession(session);
          setUser(session.user);
          userIdRef.current = session.user.id;
          await fetchProfile(session.user.id);
        }
      } catch (error) {
        console.error("Error loading auth:", error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    loadAuth();

    // Not async and no Supabase calls inside: awaiting here can deadlock the auth client.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (currentSession) {
        setSession(currentSession);
        setUser(currentSession.user);
        userIdRef.current = currentSession.user.id;
        
        // Re-fetch profile on sign-in
        if (event === "SIGNED_IN") {
          const uid = currentSession.user.id;
          setChecking(true);
          setTimeout(() => { void fetchProfile(uid).finally(() => setChecking(false)); }, 0);
        }
      } else {
        setSession(null);
        setUser(null);
        setProfile(null);
        userIdRef.current = null;
        if (event === "SIGNED_OUT" && !endingOnPurpose.current) setNotice("session");
      }
      setIsLoading(false);
    });

    // Pick up role / branch / active changes made while this tab was in the background.
    const onFocus = () => { if (userIdRef.current) void fetchProfile(userIdRef.current); };
    window.addEventListener("focus", onFocus);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [supabase]);

  const signOut = async () => {
    // Sign out first: if the network is down the session survives, so keep the draft and say so.
    endingOnPurpose.current = true;
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      endingOnPurpose.current = false;
      toast.error("Could not sign out. Check your connection and try again.");
      return;
    }
    localStorage.removeItem("overbooked_last_page");
    const uid = user?.id || profile?.id;
    if (uid) localStorage.removeItem(`overbooked_draft_product_${uid}`);
    clearRentalDraft(uid);
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, isLoading, signOut }}>
      {checking || notice === "deactivated" ? null : children}
      <AlertDialog open={notice !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{notice === "deactivated" ? "Account deactivated" : "Session ended"}</AlertDialogTitle>
            <AlertDialogDescription>
              {notice === "deactivated"
                ? "Your account or your branch has been deactivated. Contact the owner."
                : "Your session ended, please sign in again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* The booking draft in sessionStorage is left untouched. */}
            <AlertDialogAction onClick={() => { window.location.href = "/login"; }}>Go to sign in</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
