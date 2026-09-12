import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors tsconfig.json's "paths": { "@/*": ["./*"] } -- vitest doesn't read
// tsconfig path aliases on its own, so any test that imports app code via
// "@/..." (the convention used throughout /app and /lib, e.g.
// lib/supabase/server.ts, lib/types.ts) needs this resolved here too.
const alias = {
  "@": fileURLToPath(new URL(".", import.meta.url)),
};

// Two projects (vitest 4's replacement for the old `vitest.workspace.ts`
// file), same config file: `scripts/`/`lib/` tests are plain Node (no DOM,
// no React) and keep running exactly as before; `app/` component tests
// (added this phase -- scenario slot editor, owned-checkbox toggle, search
// form, basket CTA) need a DOM, hence the second `jsdom` project. Splitting
// by directory rather than forcing one environment on everything keeps the
// fast, dependency-light node tests from paying jsdom's startup cost.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          include: ["scripts/**/*.test.ts", "lib/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "jsdom",
          include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
