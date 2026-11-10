"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createInviteLink, getCaller, siteOrigin, type ShopRole } from "@/lib/server/invites";
import { emailError, personNameError } from "@/lib/validate";

// A shop's people are managed by its owner (Staff management in the shop app), or by Zypher while it sets a shop up.
// Every rule (who may do it, branch of this shop, plan login limit, owner takes over from Zypher) is checked again by the
// database function named below, so the browser cannot get past them. The shop id is checked there too.

export async function inviteStaff(input: { shopId: string; email: string; fullName: string; role: ShopRole; branchId: string | null }) {
  const { supabase, user, role } = await getCaller();
  if (role !== "super_admin" && role !== "owner") throw new Error("Only the shop owner can add staff.");
  { const bad = emailError(input.email) ?? personNameError(input.fullName, "person's name"); if (bad) throw new Error(bad); }

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

// A fresh one-hour link that lets someone (re)set their password: an invite that expired, or a forgotten password.
// The database decides how: shown to the caller to share, or (Zypher helping a shop's owner) emailed to the owner only.
export async function newInviteLink(shopId: string, userId: string): Promise<{ link?: string; emailedTo?: string }> {
  const { supabase, role } = await getCaller();
  if (role !== "super_admin" && role !== "owner") throw new Error("Only the shop owner can send login links.");

  const { data: mode, error: checkErr } = await supabase.rpc("setup_check_person", { p_shop_id: shopId, p_user_id: userId });
  if (checkErr) throw new Error(checkErr.message);

  const admin = createAdminClient();
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const email = authUser?.user?.email;
  if (!email) throw new Error("This account has no email.");

  if (mode === "email") {
    // the reset email's template points at /welcome with the token (see docs/SETUP.md, "Password reset email")
    const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${await siteOrigin()}/welcome` });
    if (error) throw new Error("Could not send the email: " + error.message);
    await supabase.rpc("log_setup_event", { p_shop_id: shopId, p_action: "login_email_sent", p_detail: { user_id: userId } });
    return { emailedTo: email };
  }
  if (mode !== "link") throw new Error("Could not create a new link.");

  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data?.properties?.hashed_token) throw new Error("Could not create a new link: " + (error?.message ?? "unknown error"));
  await supabase.rpc("log_setup_event", { p_shop_id: shopId, p_action: "login_link_created", p_detail: { user_id: userId } });
  return { link: `${await siteOrigin()}/welcome?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery` };
}
