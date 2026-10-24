import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Server-only helpers shared by the staff and Zypher server actions.

export type ShopRole = "owner" | "manager" | "staff";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Who is calling, in which shop. Never trusts ids sent by the browser.
export async function getCaller() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session ended, please sign in again.");
  const [{ data: role }, { data: shopId }] = await Promise.all([
    supabase.rpc("get_my_role"),
    supabase.rpc("current_shop_id"),
  ]);
  return { supabase, user, role: role as string | null, shopId: shopId as string | null };
}

export async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

// Creates the account (handle_new_user puts it in the invite's shop) and returns the link to share.
export async function createInviteLink(input: {
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
