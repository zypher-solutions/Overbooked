"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCaller } from "@/lib/server/invites";
import { sendOwnerCode } from "@/lib/server/email";

// Settings > Master password > Ask Zypher (migration 053): a 6-digit code to the owner's sign-in email, checked by
// master_reset_request. Someone lent the owner's sign-in usually does not have the owner's inbox.
export async function emailOwnerCode(): Promise<{ email: string }> {
  const { supabase, user } = await getCaller();
  // raises unless the caller is the shop's real owner (not a manager, not Zypher support)
  const { error: ownerErr } = await supabase.rpc("master_reset_status");
  if (ownerErr) throw new Error(ownerErr.message);
  if (!user.email) throw new Error("Your account has no email.");

  const admin = createAdminClient();
  const { data: prev } = await admin.from("owner_email_codes").select("sent_at").eq("user_id", user.id).maybeSingle();
  if (prev && Date.now() - new Date(prev.sent_at).getTime() < 60_000) throw new Error("Wait a minute before asking for another code.");

  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  const code = String(n[0] % 1_000_000).padStart(6, "0");   // shortcut: % is very slightly uneven; fine for a 5-try, 10-minute code
  const { error } = await admin.rpc("set_owner_email_code", { p_user: user.id, p_code: code });
  if (error) throw new Error("Could not make a code: " + error.message);
  try {
    await sendOwnerCode(user.email, code);
  } catch (e) {
    await admin.from("owner_email_codes").delete().eq("user_id", user.id);   // an unsent code must not block a retry
    throw e;
  }
  return { email: user.email };
}
