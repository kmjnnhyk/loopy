import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // deviation from brief: the spec lives at tests/e2e/dev.e2e.ts, not dev.spec.ts — Bun's
  // default `bun test` file discovery auto-picks up any *.spec.ts / *.test.ts (confirmed by
  // probing this repo), which would make `bun test` (part of `bun run check`) try to execute
  // this Playwright spec through bun:test's runner and fail. Renaming off the spec/test
  // pattern keeps it out of `bun test`; Playwright needs an explicit testMatch since its own
  // default also keys off the spec/test naming.
  testMatch: /.*\.e2e\.ts$/,
  webServer: {
    // build the browser bundle, then boot a Bun server that serves it + the fixture runtime
    command: "bun run vite build && bun tests/e2e/serve-fixture.ts",
    url: "http://localhost:5199",
    reuseExistingServer: false,
  },
  use: { baseURL: "http://localhost:5199" },
});
