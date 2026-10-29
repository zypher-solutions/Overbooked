"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createInviteLink, EMAIL_RE, getCaller, siteOrigin, type ShopRole } from "@/lib/server/invites";

// Staff are set up by Zypher from the shop's page in the console. Every rule (role, branch of this shop, plan login limit)
// is checked again by the database function named below, so the browser cannot get past them.

export async function inviteStaff(input: { shopId: string; email: string; fullName: string; role: ShopRole; branchId: string | null }) {
  const { supabase, user, role } = await getCaller();
  if (role !== "super_admin") throw new Error("Only Zypher can invite staff.");
  if (!EMAIL_RE.test(input.email.trim())) throw new Error("Enter a valid email address.");
  if (!input.fullName.trim()) throw new Error("Enter the person's name.");

  const branchId = input.role === "owner" || input.role === "support" ? null : input.branchId;
  const { error } = await supabase.rpc("setup_check_invite", { p_shop_id: input.shopId, p_role: input.role, p_branch_id: branchId });
  if (error) throw new Error(error.message);

  const link = await createInviteLink({
    shopId: input.shopId,
    email: input.email,
    fullName: input.fullName,
    role: input.role,
    branchId,
    invitedBy: user.id,
  });
  await supabase.rpc("log_setup_event", { p_shop_id: input.shopId, p_action: "invite_created", p_detail: { email: input.email.trim().toLowerCase(), role: input.role } });
  return { link };
}

// A fresh one-hour link that lets someone (re)set their password: an invite that expired, or a
// forgotten password. Zypher does this for anyone in the shop, never for another Zypher admin.
export async function newInviteLink(shopId: string, userId: string) {
  const { supabase, role } = await getCaller();
  if (role !== "super_admin") throw new Error("Only Zypher can send login links.");

  const { data: targetRole, error: checkErr } = await supabase.rpc("setup_check_person", { p_shop_id: shopId, p_user_id: userId });
  if (checkErr) throw new Error(checkErr.message);

  const admin = createAdminClient();
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const email = authUser?.user?.email;
  if (!email) throw new Error("This account has no email.");

  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data?.properties?.hashed_token) throw new Error("Could not create a new link: " + (error?.message ?? "unknown error"));
  await supabase.rpc("log_setup_event", { p_shop_id: shopId, p_action: "login_link_created", p_detail: { user_id: userId, role: targetRole } });
  return { link: `${await siteOrigin()}/welcome?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery` };
}
