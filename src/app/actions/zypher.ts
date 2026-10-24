"use server";

import { createInviteLink, EMAIL_RE, getCaller } from "@/lib/server/invites";

async function requireZypher() {
  const caller = await getCaller();
  if (caller.role !== "super_admin") throw new Error("Only Zypher can do this.");
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
  if (!EMAIL_RE.test(input.ownerEmail.trim())) throw new Error("Enter a valid owner email.");
  if (!input.ownerName.trim()) throw new Error("Enter the owner's name.");
  if (!(input.monthlyFee >= 0)) throw new Error("The monthly fee cannot be negative.");

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
    return { shopId: shopId as string, link };
  } catch (e: any) {
    return { shopId: shopId as string, link: null, inviteError: e?.message ?? "Could not create the owner's invite." };
  }
}

// Invite (or re-invite) a shop's owner without opening the shop.
export async function inviteShopOwner(input: { shopId: string; ownerName: string; ownerEmail: string }) {
  const { user } = await requireZypher();
  if (!EMAIL_RE.test(input.ownerEmail.trim())) throw new Error("Enter a valid owner email.");
  if (!input.ownerName.trim()) throw new Error("Enter the owner's name.");
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
