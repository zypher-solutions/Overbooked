# Settings page plan: a table of settings, per branch

Written 11 Nov 2026. **Not built. Waiting for the owner's approval** (`CLAUDE.md`: plan first).
Replaces the settings tabs on Branch management (launch pack part A1, built on `feature/late-returns`, not committed).

## Decisions (owner, 11 Nov 2026)
1. Settings move to their **own page**, shown as a **table**, with a **branch switch** at the top.
2. Per branch: **shop default + override**. "All branches" holds the shop's value; a branch can override any row that
   supports it; "Use shop default" removes the override. Branches never touched keep following the shop.
3. The **owner can edit the shop name** (today Zypher only).
4. "Location" means **city, state and PIN code** fields, for the shop and for each branch.

## 1. Branch management (slimmed)
Keeps only:
- **Branches** panel (add, edit, close), unchanged; the branch dialog gains City, State (list of Indian states and UTs),
  PIN code.
- **Shop details**: name (now editable), phone, email, address, city, state, PIN code, GSTIN.
- **Your Overbooked plan** (subscription panel), unchanged.
- One Save for Shop details. The tabs and the Receipts and Late returns panels move to Settings.

## 2. Settings page (new: `/settings`, menu Admin > Settings, owner only, both menus)
- Top bar: **Branch** select ("All branches (shop default)", then each open branch) and a **Search** box.
- Table, grouped by section headers (Receipts & tax, Late returns, Rules):

| Setting | Value | Applies to | Edit |
|---|---|---|---|
| Late fee per day | 200% of the agreed daily price | Shop default / **Branch A only** | pencil |

  - "Setting" is the plain name with a one-line hint under it. No internal key column (shop owners never need it).
  - "Applies to" shows, on a branch view, whether the row follows the shop or is set for that branch only.
  - **Edit** opens a small dialog with the right control (on/off switch, number, choice, time, text), its own Save, and on a
    branch view a "Use shop default" button. Each row saves on its own; no page-wide Save.
  - Phone width: the table turns into one card per setting (name, value, edit), the same data.
- Rows and whether a branch may override them:

| Section | Row | Per branch? |
|---|---|---|
| Receipts & tax | GST included in prices (%) | No: tied to the shop's GSTIN |
| Receipts & tax | SAC code | No: same reason |
| Receipts & tax | Receipt note | Yes |
| Late returns (clothing) | Charge late fees; fee type and amount; daily price basis; count days; latest return time; maximum; next-booking clash action | Yes |
| Rules (non-clothing) | Grace time; usual check-in and check-out times | Yes |
| Rules (vehicles) | Driving licence required | No: checked deep inside the hand over, which this plan does not change |

  GST %, SAC and licence show "Whole shop" on a branch view and are edited only under "All branches".

## 3. Database (migration 038)
- `branches.settings jsonb NOT NULL DEFAULT '{}'` (overrides only), and `city`, `state`, `pincode` on `shops` and `branches`.
- `_settings_check(jsonb)`: the validation now inside `update_my_shop` moved into one helper so shop and branch saves check
  the same rules. `update_my_shop` keeps its role check and behaviour; it also accepts `name`, `city`, `state`, `pincode`.
- `update_branch_settings(p_branch_id, p_set jsonb, p_clear text[])`: owner only (same role check as `update_my_shop`),
  only keys allowed per branch, same validation; `p_clear` removes overrides.
- `_branch_rule(branch, key, default)` = branch override, else shop setting, else default. Used by:
  - the late rules copied onto a new booking (by the booking's branch), and the grace time in `return_suggestions`;
  - the print page's receipt note (by the booking's branch, in the app).
- `setup_save_branch` (migration 021/033) also accepts `city`, `state`, `pincode`; nothing else in it changes.
- Activity log: shop name, city, state, PIN in `_act_shops`; branch city/state/PIN and setting overrides in `_act_branches`
  ("Set Late fee per day for Branch A to 200%", "Branch A uses the shop default for ...").
- Support logins and Zypher visits: unchanged. They reach these functions exactly as they reach `update_my_shop` today.

## 4. App
- `ShopContext`: `branchSetting(branchId, key, fallback)` next to `setting()`; branches load their `settings`.
- Booking form check-in/out defaults and the booking page's clash button order read the booking's branch.
- Print page receipt note: the booking's branch.

## 5. Checks
Database tests (override wins, clearing it falls back, non-branch keys refused per branch, staff refused, validation shared,
log entries), applied to the shared project only after you say how; browser check of both pages at desktop and phone width.

## Not in this plan
Per-branch GSTIN (a branch registered in another state), per-branch printing layouts, Rentopus-style print margin and
invoice-template rows (no such features yet).
