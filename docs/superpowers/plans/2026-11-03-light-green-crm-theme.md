# Light Green CRM Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Overbooked consistently light while preserving its green brand and using dark green only as a focused accent.

**Architecture:** Keep the existing token-driven Tailwind 4 theme. Update global light-theme tokens first, then replace the handful of direct black/neon/white-on-dark overrides that bypass them. Preserve component hierarchy, layout, interactions, and print styling.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, CSS custom properties, TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-03-light-green-crm-theme-design.md`

## Global Constraints

- Use light, softly tinted green surfaces for the page canvas, navigation, cards, and controls.
- Keep white cards distinct with gentle green-gray borders and readable dark text.
- Reserve deep green for primary actions, active navigation, and important highlights.
- Replace high-saturation neon use and near-black dashboard panels with softer, semantic green treatments.
- Set the browser color scheme to light so native controls remain light.
- Preserve the existing screen structure, behavior, labels, and semantic status colors.
- Do not rearrange, add, or remove application UI sections or components.
- Keep functional dark overlays for dialogs, drawers, and camera scanning; these are interaction layers, not a dark theme.
- Keep print documents optimized for paper output.
- Add no new dependency.

## Review Focus

- System dark preference must not darken native controls: set root `color-scheme: light` and inspect login and shop form controls.
- Sidebar default, hover, selected, and focus states must remain legible on the new light sidebar: review desktop and mobile navigation.
- Status badges and calendar states must preserve semantic meaning and text contrast: review success, warning, danger, muted, and selected states.
- Dashboard KPI cards must remain distinct without black or neon fills: review pickup, return, and overdue counts.
- Dialog and scanner overlays must retain their functional contrast while surrounding surfaces stay light: review booking dialog and scanner state.

## File Structure

- `src/styles.css`: shared light green palette, sidebar tokens, and root `color-scheme`.
- `src/components/shop/ShopShell.tsx`: shop navigation colors currently hard-coded for a dark sidebar.
- `src/components/overbooked/primitives.tsx`: primary button and muted badge colors currently bypass semantic light tokens.
- `src/modules/clothing/components/TrendzDashboard.tsx`: pickup and return KPI fills currently use black and neon.
- `src/app/manifest.ts`: mobile browser/splash surface colors.
- `src/components/zypher/ZypherShell.tsx`: align its active navigation state with the dark-green accent while retaining its token-driven light surface.
- `src/app/(shop)/layout.tsx`: verify the shop loading rail follows the new palette without structural edits.

### Task 1: Apply the Light Green Token Palette

**Files:**
- Modify: `src/styles.css`
- Modify: `src/app/manifest.ts`
- Test: `tests/theme-colors.spec.ts`

**Interfaces:** Preserve all existing semantic CSS variable names so current Tailwind utilities continue to consume the theme without component changes.

- [x] Write a failing Playwright test for light color scheme under dark OS preference, exact canvas color, and light manifest colors.
- [x] Run the light canvas regression after edits and confirm it passes under dark OS preference.
- [x] Set `:root { color-scheme: light; }`.
- [x] Set the canvas to `#F4F8F5`, foreground to `#1C2B23`, surfaces and cards to `#FFFFFF`, and secondary surfaces to `#EAF2EC`.
- [x] Preserve brand green `--gold` and `--primary` at `#0F4743`; set `--gold-soft` and `--neon` to pale sage fills (`#D5E7DD` and `#D8EADF`).
- [x] Set sidebar surface to `#F8FAF8`, sidebar text to `#1B3027`, active sidebar accent to brand green with white foreground, and hover accent to `#E4EFE8`.
- [x] Keep warning, danger, success, and indigo semantic tokens intact; update border, input, and focus-ring values to subtle green-gray values.
- [x] Soften the shared ambient card shadow to a light green-gray for the pale canvas.
- [x] Set manifest `background_color` and `theme_color` to the light canvas so the installed app chrome matches.
- [x] Run `git diff --check` and confirm existing token names remain present.

### Task 2: Bring Direct Color Overrides onto the Light Theme

**Files:**
- Modify: `src/components/shop/ShopShell.tsx`
- Modify: `src/components/overbooked/primitives.tsx`
- Modify: `src/modules/clothing/components/TrendzDashboard.tsx`
- Modify: `src/modules/clothing/screens/Bookings.tsx`
- Modify: `src/components/zypher/ZypherShell.tsx`
- Test: `tests/theme-colors.spec.ts`
- Inspect: `src/components/zypher/ZypherShell.tsx`, `src/app/(shop)/layout.tsx`

**Interfaces:** Keep existing component APIs, class composition, and interaction behavior unchanged.

- [x] Extend the Playwright test to assert computed sidebar, accent, and primary-button colors; run it and confirm the primary-button assertion fails before the component fix.
- [x] Replace shop sidebar `text-white`, `bg-white/*`, `text-neon`, and active `bg-neon` styling with sidebar semantic utilities; selected navigation uses `bg-sidebar-primary text-sidebar-primary-foreground`, and hover states use `bg-sidebar-accent`.
- [x] Change the shared primary button to use `bg-gold`; change the muted status badge from `bg-white/5` to `bg-muted`.
- [x] Use the full muted foreground token for input placeholders to preserve contrast on light fields.
- [x] Change pickup and return KPI cards from black/neon fills to white or pale sage surfaces with deep green counts; retain the rust overdue treatment.
- [x] Change the selected calendar day from neon fill to brand-green fill with primary foreground.
- [x] Change the selected booking outline from neon to the dark brand green.
- [x] Use the dark-green active state in the Zypher navigation while preserving the light token-driven sidebar.
- [x] Re-run `npx playwright test tests/theme-colors.spec.ts` and confirm all color assertions pass.
- [x] Confirm the Zypher sidebar and shop loading rail remain light without changing their structure.
- [x] Confirm modal, drawer, and camera overlays remain functional dark scrims and print templates remain paper-first.

### Task 3: Verify the Theme Across the Existing Surface

**Files:** No additional files.

- [x] Run `npm run lint`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run build -- --webpack` (the default Turbopack build currently panics in this environment while starting its CSS child process).
- [x] Review desktop and mobile app views for the light canvas, green actions, field contrast, and preserved composition; verify sidebar states through computed-color browser assertions.
- [x] Run `git diff --check` and confirm no layout, spacing, copy, behavior, or print-template changes were introduced.
