"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createUsernameLogin, emailInvite, getCaller, siteOrigin, tempPassword, type ShopRole } from "@/lib/server/invites";
import { emailError, personNameError } from "@/lib/validate";
import { loginEmail, usernameNameError } from "@/lib/username";

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

  // emailed, never shown: only someone who can open that inbox joins, so a mistyped or made-up email never gets in
  await emailInvite({
    shopId: input.shopId,
    email: input.email,
    fullName: input.fullName,
    role: input.role,
    branchId,
    invitedBy: user.id,
  });
  await supabase.rpc("log_setup_event", { p_shop_id: input.shopId, p_action: "invite_created", p_detail: { email: input.email.trim().toLowerCase(), role: input.role } });
  return { emailedTo: input.email.trim().toLowerCase() };
}

// A manager or staff member without email: username "name@shop-web-name" and a temporary password, shown once to the owner.
export async function addStaffByUsername(input: { shopId: string; name: string; fullName: string; role: "manager" | "staff"; branchId: string }) {
  const { supabase, user, role } = await getCaller();
  if (role !== "super_admin" && role !== "owner") throw new Error("Only the shop owner can add staff.");
  if (input.role !== "manager" && input.role !== "staff") throw new Error("An owner logs in with their email.");
  { const bad = usernameNameError(input.name) ?? personNameError(input.fullName, "person's name"); if (bad) throw new Error(bad); }

  const { error } = await supabase.rpc("setup_check_invite", { p_shop_id: input.shopId, p_role: input.role, p_branch_id: input.branchId });
  if (error) throw new Error(error.message);
  const { data: shop } = await createAdminClient().from("shops").select("slug").eq("id", input.shopId).single();
  if (!shop) throw new Error("Shop not found.");

  const username = `${input.name.trim().toLowerCase()}@${shop.slug}`;
  const password = tempPassword();
  await createUsernameLogin({
    shopId: input.shopId, email: loginEmail(username), username, fullName: input.fullName,
    role: input.role, branchId: input.branchId, invitedBy: user.id,
  }, password);
  await supabase.rpc("log_setup_event", { p_shop_id: input.shopId, p_action: "invite_created", p_detail: { email: username, role: input.role } });
  return { username, password };
}

// The owner (managers and staff) or a manager (staff of their branch) gives someone a new temporary password.
// The database checks who may reset whom before and after; the reset also signs that person out everywhere (migration 049).
export async function resetStaffPassword(userId: string) {
  const { supabase } = await getCaller();
  const { error: checkErr } = await supabase.rpc("staff_reset_check", { p_user_id: userId });
  if (checkErr) throw new Error(checkErr.message);

  const admin = createAdminClient();
  const password = tempPassword();
  const { data, error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) throw new Error("Could not reset the password: " + error.message);
  const { error: doneErr } = await supabase.rpc("staff_reset_done", { p_user_id: userId });
  if (doneErr) throw new Error(doneErr.message);

  const { data: person } = await admin.from("profiles").select("username").eq("id", userId).single();
  return { password, login: person?.username ?? data.user.email ?? "" };
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

  // Zypher never sees an owner's link, even before the owner's first sign-in: only the owner's inbox gets it
  const { data: target } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (mode === "email" || (role === "super_admin" && target?.role === "owner")) {
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
