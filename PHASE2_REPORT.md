# Phase 2 report

## Changes per finding
- **S-3** `AuthContext.signOut` now uses `signOut({ scope: "local" })` (this device only).
- **S-4** Sign-out also removes `overbooked_draft_product_<userId>` from localStorage.
- **S-5** `onAuthStateChange` callback is no longer async; the profile fetch is deferred with `setTimeout(..., 0)`.
- **S-1 / U-02** If SIGNED_OUT arrives and we did not cause it (expired/revoked token, other tab), an AlertDialog says "Your session ended, please sign in again." with a button to /login. Booking draft in sessionStorage is not touched. `cancelBooking` (store.tsx) now checks `getUser()` when the server action fails and throws that same message if there is no user.
- **S-2** `is_active` added to Profile and fetches. An inactive user sees "Your account has been deactivated. Contact the owner." and is signed out locally. Profile is re-checked when the window regains focus (role/branch/active changes picked up).
- **U-03** `StaffManagement.tsx`: Active/Inactive toggle and role select, each with an AlertDialog confirmation; branch change also confirms. Your own row is disabled.
- **U-05** "Change password" in the sidebar user block (dialog, min 8 chars, confirm field, toasts) using `supabase.auth.updateUser`.

## Migration
`supabase/migrations/20261018000013_admin_set_staff_status.sql`, **applied** to project `gztmmlhuuqbnsnjjcohq` (name `admin_set_staff_status`).
Function `admin_set_staff_status(p_user_id, p_is_active, p_role)`: SECURITY DEFINER, active super_admin only, cannot change own role/status, cannot leave zero active super_admins (checked with the super_admin rows locked). No anon execute.
Verified read-only afterwards: function exists (authenticated can execute, anon cannot); `get_staff_emails`, `get_my_role`, `guard_profile_direct_update` still present; profiles RLS still on with the same two policies and the same trigger. No rows changed.

## Checks
`npx tsc --noEmit` clean; `npm run lint` 0 errors (5 existing warnings); `npm run build` passes. Playwright not run.

## Not verified
No browser testing. Not exercised: the new RPC being called, the session-ended and deactivated dialogs, focus refetch, change password.

## Still open
- Server-side session revocation for deactivated staff (needs a service key). Until then a deactivated user is blocked by RLS (`get_my_role` returns null) and by the focus check, but their token stays valid until it expires.
- Forgot-password email flow: not done.
- Assumption: changing someone's role does not touch their branch assignment.
