# Account profile and sign-out implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make account details and actions easy to reach from the shop sidebar, and confirm every sign-out.

**Architecture:** Keep shop configuration at `/settings` and add an all-role `/account` page. The shared shop shell profile card opens a two-item menu for account settings and sign-out. Account identity comes from the existing auth and shop contexts; password updates reuse the current Supabase flow, and sign-out confirmation reuses `ConfirmDialog`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Supabase auth context, existing shop UI components.

**Spec:** `docs/superpowers/specs/2026-11-04-account-profile-design.md`

## Global Constraints

- Use the authenticated user's `phone`; show “Phone not set” when empty.
- Keep `/settings` as owner-only shop configuration.
- Always show the app's confirmation dialog before signing out from the profile menu; mention cart/booking loss when the cart is non-empty.
- Use the exact sidebar label “Overbooked v0.1.0”.
- Add no dependency and make no database change.

## Review Focus

- Missing phone, profile, or branch data must render readable fallbacks.
- Staff must be able to open `/account`; shop settings must remain owner-only.
- Canceling sign-out must preserve the session and cart; confirming must clear the cart and sign out.
- The profile entry and account page must remain usable on narrow screens and with keyboard focus.
- Password validation and save errors must retain the current behavior.

---

## File Structure

- `src/components/shop/ShopShell.tsx`: shared profile menu, confirmed sign-out flow, and application version label.
- `src/app/(shop)/account/page.tsx`: account details and password update dialog.

## Task 1: Replace the sidebar actions with an account link

**Files:**
- Modify: `src/components/shop/ShopShell.tsx`

**Interfaces:**
- Consume `profile`, `user`, and `signOut` from `useAuth`, and role/branch data from `useShop`.
- Link the profile card to `/account`; keep the route available to every shop role.

- [ ] Add a keyboard-accessible profile menu trigger showing icon, name, auth phone (or “Phone not set”), role, and branch.
- [ ] Show exactly “Account settings” and “Sign out” in the profile menu; route the first to `/account`.
- [ ] Confirm sign-out from the profile menu with the app dialog, including cart/booking loss when applicable.
- [ ] Remove inline “Change password” and “Sign out” actions and the shell's password dialog.
- [ ] Replace the conditional staff label with “Overbooked v0.1.0”.
- [ ] Inspect the shell diff and confirm only the profile footer behavior changed.

## Task 2: Add account settings and confirmed sign-out

**Files:**
- Create: `src/app/(shop)/account/page.tsx`

**Interfaces:**
- Use `useAuth`, `useShop`, `useCart`, `PasswordField`, `ConfirmDialog`, `PageHeader`, and `Panel`.
- The page is available to all roles and leaves `/settings` unchanged.

- [ ] Show account name, phone, email, designation, and assigned branch with missing-value fallbacks.
- [ ] Move the existing password validation and Supabase update flow to the account page.
- [ ] Keep password changes available on `/account` with current validation and save errors.
- [ ] Manually verify the profile menu choices, account details, password dialog, sign-out cancel/confirm states, mobile layout, and unchanged shop settings access.

## Final verification

- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `git diff --check` and review the complete diff.
