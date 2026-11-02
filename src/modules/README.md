# Business type modules

Code that belongs to ONE kind of business lives in its own folder here, so a change for one kind cannot break another.

| Module | Business | Holds |
|---|---|---|
| `clothing` | bridal, groom and other clothing rental | the TRENDZ screens: dashboard, product wizard, stock cards, cart, ledger PDF, menu (`nav.ts`) |
| `vehicle` (to come) | cars and bikes | odometer, fuel, licence screens |
| `stay` (to come) | resorts | nights, guests, meal plans |

Rules (the first is enforced by `npm run lint`, see `eslint.config.js`):
1. A module may use shared code (`src/lib`, `src/components`) but **never another module**. Shared code goes to `src/lib` or `src/components`.
2. Shared code does not depend on a module, except at the few seams that pick one: `src/lib/shop/nav.ts` is picked in `ShopShell`,
   and the route files in `src/app/(shop)` choose the screen by the shop's business type.
3. Business rules stay in the database. A module adds screens and wording, never its own copy of a money or availability rule.
4. A new business type: add a template row (migration), a module folder, its menu, and a Playwright spec and a pgTAP file of its own.
5. A request from one client: first a template setting, then a per-shop feature switch (`shops.settings.features`), and only then module code
   behind a switch that is off by default. Never a branch or copy for one client.

Still mixed (to split later, one file at a time with the tests green): `src/app/(shop)/book/page.tsx`, `catalog/page.tsx`,
`catalog/import/page.tsx`, `HandoverDialogs.tsx`, `ProductEditor.tsx` and `UnitsPanel.tsx` branch on the business type inside shared files.
