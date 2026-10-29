import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Business types live in their own folder under src/modules. A module may use the shared code (src/lib, src/components) but never another module,
// so a change for one business type cannot reach another. Add a name here when a module is added.
const MODULES = ["clothing", "vehicle", "stay"];
const otherModules = (me) => MODULES.filter((m) => m !== me).flatMap((m) => [{ group: [`@/modules/${m}`, `@/modules/${m}/*`], message: "A module must not import another module. Move shared code to src/lib or src/components." }]);
// the service-role key stays on the server: only server actions and src/lib/server may reach it
const serverOnly = { group: ["@/lib/supabase/admin", "@/lib/server/*"], message: "The service-role key is server only. Use a server action in src/app/actions." };

export default tseslint.config(
  { ignores: [".next", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off", // existing code uses any widely; tighten gradually
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/lib/shop/**/*.{ts,tsx}", "src/lib/overbooked/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [serverOnly] }] },
  },
  ...MODULES.map((m) => ({
    files: [`src/modules/${m}/**/*.{ts,tsx}`],
    rules: { "no-restricted-imports": ["error", { patterns: [serverOnly, ...otherModules(m)] }] },
  })),
);
