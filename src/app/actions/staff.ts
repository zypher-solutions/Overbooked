"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createInviteLink, EMAIL_RE, getCaller, siteOrigin, type ShopRole } from "@/lib/server/invites";

const LOGIN_LIMITS: Record<string, number | undefined> = { starter: 3 };

export async function inviteStaff(input: { email: string; fullName: string; role: ShopRole; branchId: string | null }) {
  const { supabase, user, role, shopId } = await getCaller();
  if (role !== "owner" && role !== "super_admin") throw new Error("Only the shop owner can invite staff.");
  if (!shopId) throw new Error("No shop selected.");
  if (!EMAIL_RE.test(input.email.trim())) throw new Error("Enter a valid email address.");
  if (!input.fullName.trim()) throw new Error("Enter the person's name.");
  if (!["owner", "manager", "staff"].includes(input.role)) throw new Error("Invalid role.");
  if (input.role !== "owner" && !input.branchId) throw new Error("Managers and staff need a branch.");

  if (input.branchId) {
    // the cookie client only sees this shop's branches
    const { data: branch } = await supabase.from("branches").select("id").eq("id", input.branchId).maybeSingle();
    if (!branch) throw new Error("Branch not found in this shop.");
  }

  const { data: shop } = await supabase.from("shops").select("plan").eq("id", shopId).single();
  const limit = LOGIN_LIMITS[shop?.plan ?? ""];
  if (limit !== undefined) {
    const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("is_active", true);
    if ((count ?? 0) >= limit) throw new Error(`Your plan allows ${limit} staff logins. Contact Zypher to upgrade.`);
  }

  const link = await createInviteLink({
    shopId,
    email: input.email,
    fullName: input.fullName,
    role: input.role,
    branchId: input.role === "owner" ? null : input.branchId,
    invitedBy: user.id,
  });
  return { link };
}

// A fresh one-hour link that lets someone (re)set their password: an invite that expired, or a
// forgotten password. Owners can do this for managers and staff; Zypher for anyone in the shop.
export async function newInviteLink(userId: string) {
  const { supabase, user, role } = await getCaller();
  if (role !== "owner" && role !== "super_admin") throw new Error("Only the shop owner can send login links.");
  if (userId === user.id) throw new Error("Use Change password for your own account.");

  // the cookie client only sees profiles of this shop
  const { data: target } = await supabase.from("profiles").select("id, role").eq("id", userId).maybeSingle();
  if (!target) throw new Error("Staff member not found in this shop.");
  if (role === "owner" && target.role === "owner") throw new Error("Only Zypher can send a login link to another owner.");

  const admin = createAdminClient();
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const email = authUser?.user?.email;
  if (!email) throw new Error("This account has no email.");

  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data?.properties?.hashed_token) throw new Error("Could not create a new link: " + (error?.message ?? "unknown error"));
  return { link: `${await siteOrigin()}/welcome?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery` };
}
