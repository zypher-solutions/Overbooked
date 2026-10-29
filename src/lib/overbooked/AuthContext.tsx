"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { setShopBrand } from "./brand";
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
  role: "super_admin" | "manager" | "owner" | "staff" | "support";
  branch_id: string | null;
  is_active: boolean;
  shop_id: string | null;
  active_shop_id: string | null;
}

export interface Shop {
  id: string;
  name: string;
  slug: string;
  token_prefix: string;
  plan: "starter" | "pro" | "business";
  status: "active" | "suspended";
  paid_until: string | null;
  monthly_fee: number;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  timezone: string;
  business_types: string[];
  /** policies and feature switches: grace_minutes, check_in_time, check_out_time, require_licence, features */
  settings: Record<string, any>;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** The shop being worked in: the user's own shop, or for Zypher staff the shop they switched into. */
  shop: Shop | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  /** Zypher staff only: work inside another shop (null = no shop). Reloads the app. */
  switchShop: (shopId: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// the booking form keeps a draft per shop in this tab (see app/(shop)/book)
function clearBookingDrafts() {
  try {
    Object.keys(sessionStorage).filter((k) => k.startsWith("ob_booking_")).forEach((k) => sessionStorage.removeItem(k));
  } catch { /* storage unavailable */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const supabase = createClient();
  const [notice, setNotice] = useState<"session" | "deactivated" | "paused" | null>(null);
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
      const shopId = profileData.role === "super_admin" ? profileData.active_shop_id : profileData.shop_id;
      const { data: shopData } = shopId
        ? await supabase.from("shops").select("*").eq("id", shopId).maybeSingle()
        : { data: null };
      if (!mounted) return;
      // a suspended shop locks out its people; Zypher staff can still open it
      if (profileData.role !== "super_admin" && shopData?.status === "suspended") {
        endingOnPurpose.current = true;
        setNotice("paused");
        await supabase.auth.signOut({ scope: "local" });
        return;
      }
      // get_my_role() is null for staff whose branch is inactive (derived lockout, see branch_lifecycle migration).
      const { data: role } = profileData.is_active === false ? { data: null } : await supabase.rpc("get_my_role");
      if (!mounted) return;
      if (profileData.is_active === false || !role) {
        endingOnPurpose.current = true;
        setNotice("deactivated");
        await supabase.auth.signOut({ scope: "local" });
        return;
      }
      setShopBrand(shopData?.name);
      setShop((shopData as Shop) ?? null);
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
        setShop(null);
        setShopBrand(null);
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
    clearBookingDrafts();
    window.location.href = "/login";
  };

  const switchShop = async (shopId: string | null) => {
    const { error } = await supabase.rpc("switch_shop", { p_shop_id: shopId });
    if (error) {
      toast.error(error.message || "Could not switch shop.");
      return;
    }
    // half-filled bookings belong to the shop being left
    clearBookingDrafts();
    // opening a shop is for setup only: branches, staff, stock locations
    window.location.href = shopId ? "/branches" : "/zypher";
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, shop, isLoading, signOut, switchShop }}>
      {checking || notice === "deactivated" || notice === "paused" ? null : children}
      <AlertDialog open={notice !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {notice === "deactivated" ? "Account deactivated" : notice === "paused" ? "Account paused" : "Session ended"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {notice === "deactivated"
                ? "Your account or your branch has been deactivated. Contact the owner."
                : notice === "paused"
                  ? "Your shop's Overbooked account is paused. Please contact Zypher."
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
