"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createInviteLink, EMAIL_RE, getCaller, siteOrigin } from "@/lib/server/invites";
import { addressError, businessNameError, emailError, normalizeEmail, normalizePhone, personNameError, phoneError, prefixError, slugError } from "@/lib/validate";

async function requireZypher() {
  const caller = await getCaller();
  // not caller.role: a Zypher admin visiting a shop as support has the role 'owner' there (migration 036)
  const { data: isZypher } = await caller.supabase.rpc("is_platform_admin");
  if (!isZypher) throw new Error("Only Zypher can do this.");
  return caller;
}

// New shop from business templates (first branch, a category per type, default add-ons), plus the owner's invite link.
export async function createShopWithOwner(input: {
  name: string;
  slug: string;
  tokenPrefix: string;
  plan: "starter" | "pro" | "business";
  monthlyFee: number;
  businessTypes: string[];
  branchName: string;
  phone: string;
  email: string;
  address: string;
  ownerName: string;
  ownerEmail: string;
}) {
  const { supabase, user } = await requireZypher();
  if (!input.businessTypes.length) throw new Error("Choose at least one business type.");
  // the form checks these too; here they are checked again because a request can be made without the form
  const bad = businessNameError(input.name, "shop name") ?? slugError(input.slug) ?? prefixError(input.tokenPrefix)
    ?? businessNameError(input.branchName, "branch name", 40) ?? phoneError(input.phone) ?? emailError(input.email, false)
    ?? addressError(input.address) ?? personNameError(input.ownerName, "owner's name") ?? emailError(input.ownerEmail);
  if (bad) throw new Error(bad);
  if (!(input.monthlyFee >= 0 && input.monthlyFee <= 1_000_000)) throw new Error("The monthly fee must be between 0 and 10,00,000.");
  input = { ...input, phone: normalizePhone(input.phone), email: normalizeEmail(input.email), ownerEmail: normalizeEmail(input.ownerEmail) };

  const { data: shopId, error } = await supabase.rpc("create_shop", {
    p: {
      name: input.name,
      slug: input.slug,
      token_prefix: input.tokenPrefix,
      plan: input.plan,
      monthly_fee: input.monthlyFee,
      business_types: input.businessTypes,
      branch_name: input.branchName,
      phone: input.phone,
      email: input.email,
      address: input.address,
    },
  });
  if (error || !shopId) {
    throw new Error(error?.code === "23505"
      ? "That web name is already taken by another shop."
      : error?.message ?? "Could not create the shop.");
  }

  try {
    const link = await createInviteLink({
      shopId: shopId as string,
      email: input.ownerEmail,
      fullName: input.ownerName,
      role: "owner",
      branchId: null,
      invitedBy: user.id,
    });
    await supabase.rpc("log_setup_event", { p_shop_id: shopId as string, p_action: "shop_created", p_detail: { name: input.name, plan: input.plan, owner_email: input.ownerEmail.trim().toLowerCase() } });
    return { shopId: shopId as string, link };
  } catch (e: any) {
    return { shopId: shopId as string, link: null, inviteError: e?.message ?? "Could not create the owner's invite." };
  }
}

// Invite (or re-invite) a shop's owner without opening the shop.
export async function inviteShopOwner(input: { shopId: string; ownerName: string; ownerEmail: string }) {
  const { supabase, user } = await requireZypher();
  { const bad = emailError(input.ownerEmail) ?? personNameError(input.ownerName, "owner's name"); if (bad) throw new Error(bad); }
  // the plan's login limit is checked first, so Zypher sees a clear message instead of a database error
  const { error: limitErr } = await supabase.rpc("setup_check_invite", { p_shop_id: input.shopId, p_role: "owner", p_branch_id: null });
  if (limitErr) throw new Error(limitErr.message);
  const link = await createInviteLink({
    shopId: input.shopId,
    email: input.ownerEmail,
    fullName: input.ownerName,
    role: "owner",
    branchId: null,
    invitedBy: user.id,
  });
  await supabase.rpc("log_setup_event", { p_shop_id: input.shopId, p_action: "invite_created", p_detail: { email: input.ownerEmail.trim().toLowerCase(), role: "owner" } });
  return { link };
}

// ---- Zypher's own team (super_admin logins) ----
export interface ZypherMember { id: string; full_name: string; email: string; is_active: boolean; last_sign_in_at: string | null }

export async function listZypherTeam(): Promise<ZypherMember[]> {
  const { supabase } = await requireZypher();
  const { data: people, error } = await supabase.from("profiles").select("id, full_name, is_active").eq("role", "super_admin").order("full_name");
  if (error) throw new Error(error.message);
  const admin = createAdminClient();
  return Promise.all((people ?? []).map(async (p) => {
    const { data } = await admin.auth.admin.getUserById(p.id);
    return { ...p, email: data.user?.email ?? "", last_sign_in_at: data.user?.last_sign_in_at ?? null };
  }));
}

// a one-hour link for a new Zypher staff member; they choose their own password
export async function inviteZypherMember(input: { fullName: string; email: string }) {
  const { supabase } = await requireZypher();
  const email = input.email.trim().toLowerCase();
  { const bad = emailError(email) ?? personNameError(input.fullName, "name"); if (bad) throw new Error(bad); }
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name: input.fullName.trim() } } });
  if (error || !data?.user || !data.properties?.hashed_token) {
    throw new Error(/registered|exists/i.test(error?.message ?? "") ? "This email already has an Overbooked account." : "Could not create the invite: " + (error?.message ?? "unknown error"));
  }
  // the new account starts inactive with no shop; make it Zypher staff
  const { error: upErr } = await admin.from("profiles").update({ role: "super_admin", is_active: true, shop_id: null, branch_id: null }).eq("id", data.user.id);
  if (upErr) throw new Error("Account created, but could not make it Zypher staff: " + upErr.message);
  await supabase.rpc("log_setup_event", { p_shop_id: null, p_action: "zypher_member_invited", p_detail: { email } });
  return { link: `${await siteOrigin()}/welcome?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite` };
}

export async function setZypherMemberActive(userId: string, active: boolean) {
  const { user, supabase } = await requireZypher();
  if (userId === user.id) throw new Error("You cannot lock yourself out.");
  const { data: target } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (target?.role !== "super_admin") throw new Error("Not a Zypher staff member.");
  if (!active) {
    const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "super_admin").eq("is_active", true);
    if ((count ?? 0) <= 1) throw new Error("At least one Zypher login must stay active.");
  }
  const { error } = await createAdminClient().from("profiles").update({ is_active: active }).eq("id", userId);
  if (error) throw new Error(error.message);
  await supabase.rpc("log_setup_event", { p_shop_id: null, p_action: active ? "zypher_member_enabled" : "zypher_member_disabled", p_detail: { user_id: userId } });
}
