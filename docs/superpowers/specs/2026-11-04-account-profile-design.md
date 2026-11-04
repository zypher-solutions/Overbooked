# Account profile and sign-out

## Intent

Make the signed-in account easy to recognize and reach, and prevent accidental sign-outs from the shared shop shell.

## Approved approach

Add a personal account page at `/account` and keep `/settings` for owner-only shop configuration. The sidebar profile entry opens a menu with exactly two choices: “Account settings” and “Sign out.” The trigger shows the user's icon, name, authenticated phone number, designation, and branch. When no phone number is on the auth account, show “Phone not set.”

Keep password changes on `/account` with the existing password rules and dialog. Selecting “Sign out” from the profile menu opens the app's existing confirmation dialog; when the cart has items, explain that the cart and booking draft will be discarded. Replace “Staff panel v2.0” with “Overbooked v0.1.0.”

## Alternatives considered

- Repurpose `/settings` for personal account details: rejected because it is shop-level configuration gated to owners, while account settings must be available to staff too.
- Keep password and sign-out actions in the sidebar: rejected because they remain disconnected from the profile icon and account details.

## Scope and constraints

Use the existing auth user phone, profile name, role, branch, and shared confirmation component. Do not add profile editing, phone verification, or database changes. The expected implementation touches `ShopShell` and adds a page under `src/app/(shop)/account/`.
