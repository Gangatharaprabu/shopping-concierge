import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors tsconfig.json's "paths": { "@/*": ["./*"] } -- vitest doesn't read
// tsconfig path aliases on its own, so any test that imports app code via
// "@/..." (the convention used throughout /app and /lib, e.g.
// lib/supabase/server.ts, lib/types.ts) needs this resolved here too.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["scripts/**/*.test.ts", "lib/**/*.test.ts"],
    environment: "node",
  },
});
