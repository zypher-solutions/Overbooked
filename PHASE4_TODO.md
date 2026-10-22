# Phase 4 to-do (left over from Phase 3)

Repo rules still apply: branch `development`, no new dependencies, no refactors, never read .env files, no push or merge unless the owner says so. Supabase project gztmmlhuuqbnsnjjcohq holds test data only. Do not run Playwright (it writes to the database). Finish with `npx tsc --noEmit`, `npm run lint` (5 existing warnings) and `npm run build`, a `PHASE4_REPORT.md`, and a local commit ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## A. Owner decisions needed first (ask in the first message)
1. Categories: when a category has products, should we (a) keep the current block ("move products first"), or (b) add a "Move products to..." choice in the delete flow? If (b): when moving, keep each product's old SKU (safe, existing rentals use it, but the SKU prefix no longer matches the category) or regenerate it (risks breaking links)? Current behavior: editing a product's category never changes its SKU (`AddProduct.tsx` ~line 310, SKU field is read-only).
2. Categories: add an "inactive" status? Needs a new database column and migration, so it needs approval.
3. Make the database refuse the orphaning too (`products.category_id` is ON DELETE SET NULL today; change to RESTRICT)? Needs a migration.
4. Branch delete: deleting a branch with staff assigned currently succeeds and sets their `branch_id` to null (sidebar then shows "Loading Branch..."). Block it, or warn?

## B. Not browser-tested in Phase 3 (needs a super_admin login; the pane login is an owner)
- Branch delete dialog (`BranchManagement.tsx`).
- Admin tools: delete payment, delete rental (`AdminTools.tsx`), and delete booking. These open a dialog on top of another dialog.
- Error pages `app/error.tsx` and `app/global-error.tsx` (force a crash in dev to see them).
- Focus/online refetch throttle (once per 30 s) in `store.tsx`.
- Products delete: Confirm path (only Cancel was tested; deleting a product with history should deactivate it).
- Offline banner with a real network cut (only simulated with events).

## C. Small items
- `AllProducts.tsx` has no clickable cards (`onOpen` unused), so nothing was made keyboard-operable there; check whether that is intended.
- The 400 for the `placehold.co` "No Image" placeholder goes through `next/image` and fails; check `next.config.mjs` remote patterns or use a local placeholder.
- `.claude/settings.local.json` still mentions the deleted `lib/error-page.ts` and `lib/error-capture.ts` (untracked, harmless).
- Security review of commits `d1e3472` and `6efa4b8` did not complete (network); it will run on push.

## D. Anything else on the audit list (U-xx / S-x) not done in Phases 1 to 3
Check ROADMAP.md and PHASE1_REPORT.md to PHASE3_REPORT.md for what is still open.
