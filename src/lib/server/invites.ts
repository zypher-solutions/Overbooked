import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Server-only helpers shared by the staff and Zypher server actions.

export type ShopRole = "owner" | "manager" | "staff" | "support";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Who is calling. Never trusts ids sent by the browser: the role comes from the database.
export async function getCaller() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session ended, please sign in again.");
  const { data: role } = await supabase.rpc("get_my_role");
  return { supabase, user, role: role as string | null };
}

export async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

type InviteInput = {
  shopId: string;
  email: string;
  fullName: string;
  role: ShopRole;
  branchId: string | null;
  invitedBy: string;
};

// Creates the account (handle_new_user puts it in the invite's shop) and returns the link to share.
export async function createInviteLink(input: InviteInput): Promise<string> {
  return (await makeInvite(input, "link"))!;
}

// Same, but Supabase emails the invite to the person and nobody else sees the link,
// so accepting it proves they own the address (used for shop owners).
export async function emailInvite(input: InviteInput): Promise<void> {
  await makeInvite(input, "email");
}

// A username login (src/lib/username.ts): input.email is the hidden address; the person gets a temporary password from
// the owner and must choose their own at first sign-in (profiles.must_change_password, migration 049).
export async function createUsernameLogin(input: InviteInput & { username: string }, password: string): Promise<void> {
  await makeInvite(input, { username: input.username, password });
}

// A random 12-character password that passes every password rule (upper, lower, digit, symbol), without look-alikes.
export function tempPassword() {
  // unbiased random index (rejection sampling over Web Crypto)
  const randomInt = (n: number) => {
    const max = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do crypto.getRandomValues(buf); while (buf[0] >= max);
    return buf[0] % n;
  };
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%*?"];
  const pick = (chars: string) => chars[randomInt(chars.length)];
  const out = [...sets.map(pick), ...Array.from({ length: 8 }, () => pick(sets.join("")))];
  for (let i = out.length - 1; i > 0; i--) { const j = randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join("");
}

async function makeInvite(input: InviteInput, how: "link" | "email" | { username: string; password: string }): Promise<string | null> {
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

  const meta = { data: { full_name: input.fullName.trim() } };
  // the invite email's template points at /welcome with the token (see docs/SETUP.md, "Real email")
  let token: string | undefined;
  let userId: string | undefined;
  let error: { message: string } | null;
  if (how === "email") {
    ({ error } = await admin.auth.admin.inviteUserByEmail(email, { ...meta, redirectTo: `${await siteOrigin()}/welcome` }));
  } else if (how === "link") {
    const res = await admin.auth.admin.generateLink({ type: "invite", email, options: meta });
    error = res.error;
    token = res.data?.properties?.hashed_token;
  } else {
    const res = await admin.auth.admin.createUser({ email, password: how.password, email_confirm: true, user_metadata: meta.data });
    error = res.error;
    userId = res.data?.user?.id;
  }
  if (error || (how === "link" && !token) || (typeof how === "object" && !userId)) {
    await admin.from("staff_invites").delete().eq("id", invite.id);
    const taken = typeof how === "object" ? "That username is already taken." : "This email already has an Overbooked account.";
    throw new Error(/registered|exists/i.test(error?.message ?? "")
      ? taken
      : (how === "email" ? "Could not email the invite: " : "Could not create the login: ") + (error?.message ?? "unknown error"));
  }

  if (typeof how === "object") {
    const { error: upErr } = await admin.from("profiles").update({ username: how.username, must_change_password: true }).eq("id", userId!);
    if (upErr) {
      await admin.auth.admin.deleteUser(userId!);   // a login nobody can find by its username is worse than none
      throw new Error(upErr.code === "23505" ? "That username is already taken." : "Could not save the username: " + upErr.message);
    }
    return null;
  }
  return how === "email" ? null : `${await siteOrigin()}/welcome?token_hash=${encodeURIComponent(token!)}&type=invite`;
}
