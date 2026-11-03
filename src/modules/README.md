# Business type modules

Code that belongs to ONE kind of business lives in its own folder here, so a change for one kind cannot break another.

| Module | Business | Holds |
|---|---|---|
| `clothing` | bridal, groom and other clothing rental | its own screens in `screens/` (Bookings, Inventory Search, All Rentals, Finance, Stock Locations), the dashboard, product wizard, stock cards, expenses, cart, ledger PDF, menu (`nav.ts`) |
| `vehicle` (to come) | cars and bikes | odometer, fuel, licence screens |
| `stay` (to come) | resorts | nights, guests, meal plans |

Layout of a module:
- `screens/`: whole pages only this module has. The route file in `src/app/(shop)` is one line (`export { default } from "@/modules/<name>/screens/X"`), so URLs stay flat and the code lives here.
- `components/`: pieces used by its screens or picked by a shared screen.
- `nav.ts`: its side menu.
- An entry in `registry.ts` (menu, home screen, side-menu tagline, its own screens, shared screens it replaces). Shops pick their module in `ShopContext` (`businessModule`).

Shops without a module of their own (`standard`: cars, bikes, resorts for now) use the shared screens in `src/app/(shop)` and `src/components/shop/Today.tsx`.

Rules (the first is enforced by `npm run lint`, see `eslint.config.js`):
1. A module may use shared code (`src/lib`, `src/components`) but **never another module**. Shared code goes to `src/lib` or `src/components`.
2. Shared code does not depend on a module, except at the few seams that pick one: `src/modules/registry.ts` (used by `ShopShell` and the home route),
   the one-line route files, and the mixed files below.
3. Business rules stay in the database. A module adds screens and wording, never its own copy of a money or availability rule.
4. A new module: add a template row (migration), its key to `ModuleKey` (`src/lib/shop/nav.ts`) and `MODULES` (`eslint.config.js`), how a shop is picked for it in `ShopContext`, a folder here, its entry in `registry.ts`, and a Playwright spec and a pgTAP file of its own.
5. A request from one client: first a template setting, then a per-shop feature switch (`shops.settings.features`), and only then module code
   behind a switch that is off by default. Never a branch or copy for one client.

Still mixed (to split later, one file at a time with the tests green): `src/app/(shop)/book/page.tsx`, `catalog/page.tsx`,
`catalog/import/page.tsx`, `HandoverDialogs.tsx`, `ProductEditor.tsx` and `UnitsPanel.tsx` branch on `businessModule` (or the template kind) inside shared files. Stage 2 moves those clothing parts into this module.
