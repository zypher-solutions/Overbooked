# Light Green CRM Theme

## Intent

Make Overbooked feel fully light and easier to use throughout a CRM workday while preserving its existing green identity and keeping dark green as a restrained accent.

## Goals

- Use light, softly tinted green surfaces for the page canvas, navigation, cards, and controls.
- Keep white cards distinct with gentle green-gray borders and readable dark text.
- Reserve deep green for primary actions, active navigation, and important highlights.
- Replace high-saturation neon use and near-black dashboard panels with softer, semantic green treatments.
- Set the browser color scheme to light so native controls remain light.
- Preserve the existing screen structure, behavior, labels, and semantic status colors.

## Non-goals and constraints

- Do not rearrange, add, or remove application UI sections or components.
- Keep functional dark overlays for dialogs, drawers, and camera scanning; these are interaction layers, not a dark theme.
- Keep print documents optimized for paper output.
- Add no new dependency.

## Approaches considered

1. **Soft sage green (selected):** pale sage canvas, white surfaces and sidebars, dark pine actions, and muted green selection states. This preserves the current brand while reducing visual intensity for day-to-day CRM use.
2. **Warm studio:** ivory canvas and pale green accents with the same dark pine actions. This would feel warmer, but would move the platform away from its established cool-green identity.
3. **Crisp office:** white canvas, gray-green borders, and dark teal actions. This would feel more formal and less welcoming.

## Implementation scope

Update shared tokens and the few direct color exceptions in `src/styles.css`, `src/components/shop/ShopShell.tsx`, `src/modules/clothing/components/TrendzDashboard.tsx`, and `src/components/overbooked/primitives.tsx`. Check the Zypher shell, shop layout background, and app manifest for token-driven colors that should follow the light palette. Leave the component hierarchy and spacing unchanged.

## Expected outcome

Every app route has a light canvas and light navigation. Dark green remains visible in primary and active states, with muted sage carrying secondary emphasis.
