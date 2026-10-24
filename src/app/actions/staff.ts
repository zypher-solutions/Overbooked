"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ShopRole = "owner" | "manager" | "staff";

const LOGIN_LIMITS: Record<string, number | undefined> = { starter: 3 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Who is calling, in which shop. Never trusts ids sent by the browser.
async function getCaller() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session ended, please sign in again.");
  const [{ data: role }, { data: shopId }] = await Promise.all([
    supabase.rpc("get_my_role"),
    supabase.rpc("current_shop_id"),
  ]);
  return { supabase, user, role: role as string | null, shopId: shopId as string | null };
}

async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

// Creates the account (handle_new_user puts it in the invite's shop) and returns the link to share.
async function createInviteLink(input: {
  shopId: string;
  email: string;
  fullName: string;
  role: ShopRole;
  branchId: string | null;
  invitedBy: string;
}) {
  const admin = createAdminClient();
  const email = input.email.trim().toLowerCase();

  // an older unused invite for this email in this shop is replaced
  await admin.from("staff_invites").delete().eq("email", email).eq("shop_id", input.shopId).is("accepted_at", null);

  const { data: invite, error: inviteErr } = await admin
    .from("staff_invites")
    .insert({ shop_id: input.shopId, email, role: input.role, branch_id: input.branchId, invited_by: input.invitedBy })
    .select("id")
    .single();
  if (inviteErr || !invite) {
    throw new Error(inviteErr?.code === "23505"
      ? "This email already has an open invite from another shop."
      : "Could not create the invite: " + (inviteErr?.message ?? "unknown error"));
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: input.fullName.trim() } },
  });
  if (error || !data?.properties?.hashed_token) {
    await admin.from("staff_invites").delete().eq("id", invite.id);
    throw new Error(/registered|exists/i.test(error?.message ?? "")
      ? "This email already has an Overbooked account."
      : "Could not create the invite link: " + (error?.message ?? "unknown error"));
  }

  return `${await siteOrigin()}/welcome?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite`;
}

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

// Zypher console: new shop with its first branch, plus the owner's invite link.
export async function createShopWithOwner(input: {
  name: string;
  slug: string;
  tokenPrefix: string;
  plan: "starter" | "pro" | "business";
  branchName: string;
  phone: string;
  ownerName: string;
  ownerEmail: string;
}) {
  const { supabase, user, role } = await getCaller();
  if (role !== "super_admin") throw new Error("Only Zypher can create shops.");
  if (!EMAIL_RE.test(input.ownerEmail.trim())) throw new Error("Enter a valid owner email.");
  if (!input.ownerName.trim()) throw new Error("Enter the owner's name.");

  const { data: shopId, error } = await supabase.rpc("create_shop", {
    p_name: input.name,
    p_slug: input.slug,
    p_token_prefix: input.tokenPrefix,
    p_plan: input.plan,
    p_branch_name: input.branchName,
    p_phone: input.phone || null,
  });
  if (error || !shopId) throw new Error(error?.message ?? "Could not create the shop.");

  try {
    const link = await createInviteLink({
      shopId: shopId as string,
      email: input.ownerEmail,
      fullName: input.ownerName,
      role: "owner",
      branchId: null,
      invitedBy: user.id,
    });
    return { shopId: shopId as string, link };
  } catch (e: any) {
    return { shopId: shopId as string, link: null, inviteError: e?.message ?? "Could not create the owner's invite." };
  }
}

// Zypher console: invite (or re-invite) a shop's owner without switching into the shop.
export async function inviteShopOwner(input: { shopId: string; ownerName: string; ownerEmail: string }) {
  const { user, role } = await getCaller();
  if (role !== "super_admin") throw new Error("Only Zypher can invite shop owners.");
  if (!EMAIL_RE.test(input.ownerEmail.trim())) throw new Error("Enter a valid owner email.");
  const link = await createInviteLink({
    shopId: input.shopId,
    email: input.ownerEmail,
    fullName: input.ownerName,
    role: "owner",
    branchId: null,
    invitedBy: user.id,
  });
  return { link };
}
