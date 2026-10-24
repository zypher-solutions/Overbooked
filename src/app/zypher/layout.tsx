import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ZypherShell } from "@/components/zypher/ZypherShell";

export const metadata: Metadata = { title: "Zypher Console — Overbooked" };

// Zypher staff only. Checked on the server, so the console never renders for anyone else;
// every database function it calls checks again.
export default async function ZypherLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isZypher } = await supabase.rpc("is_platform_admin");
  if (!isZypher) redirect("/");
  return <ZypherShell>{children}</ZypherShell>;
}
