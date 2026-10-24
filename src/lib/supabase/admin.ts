import { createClient } from "@supabase/supabase-js";

// Service-role client: skips every security rule. Only for server actions, and only after
// the caller has been checked with the normal (cookie) client. Never import from client code.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
