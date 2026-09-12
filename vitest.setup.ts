import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react's auto-cleanup-after-each-test only self-registers
// when it detects test-framework globals (afterEach etc. on `globalThis`).
// This repo's vitest config doesn't enable `test.globals` (tests import
// describe/it/expect explicitly, matching the rest of the codebase's
// existing lib/**/*.test.ts convention instead of relying on implicit
// globals), so cleanup is wired explicitly here instead.
afterEach(() => {
  cleanup();
});
