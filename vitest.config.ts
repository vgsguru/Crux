import { defineConfig } from "vitest/config";

// Standalone test config — deliberately does NOT load the app's vite plugins
// (tanstackStart/nitro) so unit tests run fast and exit cleanly.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
